// backend/server.js - HYBRID VERSION (ACRCloud + Custom Matcher)
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
require('dotenv').config();

const { resend, sendWelcomeEmail } = require('./lib/email');
const {
  JWT_SECRET,
  isMongoConnected,
  authenticateToken,
  requireAdminSecret,
  getAnonymousId,
  checkSearchLimit,
} = require('./lib/auth-middleware');
const {
  getSpotifyToken,
  getSpotifyTrack,
  getSpotifyTrackByName,
  findMostPopularVersion,
} = require('./lib/spotify');
const {
  isGenericTitle,
  cleanTitleForComparison,
  calculateSimilarity,
  rankACRResults,
  combineWithSpotify,
} = require('./lib/ranking');
const { identifyAudio } = require('./lib/acr');
const { withRetry } = require('./lib/http');

// Import models
const User = require('./models/User');
const AnonymousSearch = require('./models/AnonymousSearch');

const app = express();
// Configure multer for larger audio files (50MB limit)
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB
  }
});

// CORS configuration - allow all origins for file uploads
app.use(cors({ 
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Request logging middleware - log all incoming requests
app.use((req, res, next) => {
  console.log(`📥 [${new Date().toISOString()}] ${req.method} ${req.path}`);
  console.log(`   Origin: ${req.headers.origin || 'none'}`);
  console.log(`   User-Agent: ${req.headers['user-agent']?.substring(0, 50) || 'none'}`);
  next();
});

// Increase body size limit for audio file uploads (50MB)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// =========================
// STRIPE PAYMENT SETUP
// =========================
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
} else {
  console.log('⚠️  Stripe not configured - payment features disabled');
}

// Stripe Price IDs for subscriptions (must match UI pricing below).
// Set in Stripe Dashboard or override via env so checkout and subscription updates charge the correct amount.
const STRIPE_PRICE_AVID_MONTHLY = process.env.STRIPE_PRICE_AVID_MONTHLY || 'price_1Srsq3ImpMKWmAgdgibsqCvl';
const STRIPE_PRICE_AVID_YEARLY  = process.env.STRIPE_PRICE_AVID_YEARLY || 'price_1SrsuZImpMKWmAgdKDuftnOV';
const STRIPE_PRICE_UNLIMITED_MONTHLY = process.env.STRIPE_PRICE_UNLIMITED_MONTHLY || 'price_1Srss2ImpMKWmAgd5XUPpJhc';
const STRIPE_PRICE_UNLIMITED_YEARLY  = process.env.STRIPE_PRICE_UNLIMITED_YEARLY || 'price_1SrsvCImpMKWmAgdpBrILeVj';

// Subscription plan definitions, keyed by user tier. Single source of truth for
// pricing used in checkout, subscription updates, and webhook plan detection.
const SUBSCRIPTION_PLANS = {
  avid: {
    name: 'Avid Listener',
    description: '100 searches per month',
    monthlyPrice: 300, // $3.00 in cents
    yearlyPrice: 3000, // $30.00 in cents
    monthlyPriceId: STRIPE_PRICE_AVID_MONTHLY,
    yearlyPriceId: STRIPE_PRICE_AVID_YEARLY,
  },
  unlimited: {
    name: 'Eat, Breath, Music',
    description: 'Unlimited searches',
    monthlyPrice: 500, // $5.00 in cents
    yearlyPrice: 5000, // $50.00 in cents
    monthlyPriceId: STRIPE_PRICE_UNLIMITED_MONTHLY,
    yearlyPriceId: STRIPE_PRICE_UNLIMITED_YEARLY,
  },
};

// Cached Stripe product + price ids per plan — used for subscription updates so existing accounts get correct pricing
const _cachedPlanProductIds = {};
const _cachedPlanPriceIds = { avid: {}, unlimited: {} };

/** Get or create a Stripe Price for the given plan/interval/amount. Returns price id. */
async function getOrCreatePlanPriceId(plan, interval, unitAmount) {
  if (!stripe) throw new Error('Stripe not configured');
  const planConfig = SUBSCRIPTION_PLANS[plan];
  if (!planConfig) throw new Error(`Unknown plan: ${plan}`);

  if (_cachedPlanPriceIds[plan][interval]) return _cachedPlanPriceIds[plan][interval];

  if (!_cachedPlanProductIds[plan]) {
    const product = await stripe.products.create({
      name: planConfig.name,
      description: planConfig.description,
    });
    _cachedPlanProductIds[plan] = product.id;
    console.log(`✅ Created Stripe product for ${planConfig.name}: ${_cachedPlanProductIds[plan]}`);
  }

  const price = await stripe.prices.create({
    product: _cachedPlanProductIds[plan],
    currency: 'usd',
    unit_amount: unitAmount,
    recurring: { interval },
  });
  _cachedPlanPriceIds[plan][interval] = price.id;
  console.log(`✅ Created Stripe price: $${(unitAmount / 100).toFixed(2)}/${interval} (${planConfig.name}) → ${price.id}`);
  return price.id;
}

/**
 * If a subscription is managed by a subscription schedule (e.g. a previously
 * scheduled downgrade), Stripe blocks direct updates and cancellation. Releasing
 * the schedule detaches it — the subscription keeps its current price — so we can
 * manage it directly again. Releasing also drops any pending scheduled change,
 * which is the desired behavior when the user upgrades or cancels.
 * Returns true if a schedule was released.
 */
async function releaseSubscriptionSchedule(subscription) {
  if (!subscription || !subscription.schedule) return false;
  const scheduleId = typeof subscription.schedule === 'string'
    ? subscription.schedule
    : subscription.schedule.id;
  await stripe.subscriptionSchedules.release(scheduleId);
  console.log(`🔓 Released subscription schedule ${scheduleId} for ${subscription.id}`);
  return true;
}

/** Returns the tier ('avid' | 'unlimited' | null) matching a given Stripe price, by id or amount. */
function planForStripePrice(priceId, unitAmount) {
  for (const [tier, plan] of Object.entries(SUBSCRIPTION_PLANS)) {
    if (
      priceId === plan.monthlyPriceId || priceId === plan.yearlyPriceId ||
      priceId === _cachedPlanPriceIds[tier]?.month || priceId === _cachedPlanPriceIds[tier]?.year ||
      unitAmount === plan.monthlyPrice || unitAmount === plan.yearlyPrice
    ) {
      return tier;
    }
  }
  return null;
}

async function validateStripePlanPrices() {
  if (!stripe) return;
  for (const [tier, plan] of Object.entries(SUBSCRIPTION_PLANS)) {
    try {
      const [monthly, yearly] = await Promise.all([
        stripe.prices.retrieve(plan.monthlyPriceId),
        stripe.prices.retrieve(plan.yearlyPriceId),
      ]);
      const okMonthly = monthly.unit_amount === plan.monthlyPrice && monthly.recurring?.interval === 'month';
      const okYearly = yearly.unit_amount === plan.yearlyPrice && yearly.recurring?.interval === 'year';
      if (!okMonthly) {
        console.warn(`⚠️  Stripe ${plan.name} monthly price (${plan.monthlyPriceId}) is not $${(plan.monthlyPrice / 100).toFixed(2)}/month (current: ${monthly.unit_amount} cents). Subscription updates now use API-created price.`);
      }
      if (!okYearly) {
        console.warn(`⚠️  Stripe ${plan.name} yearly price (${plan.yearlyPriceId}) is not $${(plan.yearlyPrice / 100).toFixed(2)}/year (current: ${yearly.unit_amount} cents). Subscription updates now use API-created price.`);
      }
    } catch (e) {
      console.warn(`⚠️  Could not validate Stripe ${tier} prices:`, e.message);
    }
  }
}

// Signup endpoint
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password, usedAnonymousSearch } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    if (!isMongoConnected()) {
      return res.status(503).json({ error: 'Database not available. Please try again later.' });
    }
    
    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      console.log(`⚠️  Signup attempt for existing user: ${email}`);
      return res.status(400).json({ error: 'User already exists' });
    }
    
    const userCount = await User.countDocuments();
    console.log(`📝 Creating new user: ${email} (${userCount} existing users)`);

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // If user used an anonymous search, set searchCount to 1 (so they have 2/3 left)
    // Otherwise, set to 0 (so they have 3/3 left)
    const initialSearchCount = usedAnonymousSearch ? 1 : 0;
    const remainingSearches = 3 - initialSearchCount;

    // Create new user - always start on free tier
    const newUser = new User({
      email: email.toLowerCase(),
      password: hashedPassword,
      searchCount: initialSearchCount,
      tier: 'free' // Always start on free tier
    });

    await newUser.save();
    console.log(`✅ User created: ${newUser._id}`);

    // Generate JWT token
    const token = jwt.sign(
      { userId: newUser._id.toString(), email: newUser.email },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    // Send welcome email (don't wait for it)
    console.log(`📧 Triggering welcome email for ${newUser.email}...`);
    sendWelcomeEmail(newUser.email, remainingSearches).catch(err => {
      console.error('📧 Welcome email promise rejection:', err.message);
    });

    res.json({
      success: true,
      token,
      user: {
        id: newUser._id.toString(),
        email: newUser.email,
        searchCount: newUser.searchCount,
        tier: newUser.tier
      }
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (!isMongoConnected()) {
      return res.status(503).json({ error: 'Database not available. Please try again later.' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      const userCount = await User.countDocuments();
      console.log(`⚠️  Login attempt for non-existent user: ${email}`);
      console.log(`   Total users in database: ${userCount}`);
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    console.log(`🔐 Login attempt for user: ${email} (found in database)`);

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id.toString(), email: user.email },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user._id.toString(),
        email: user.email,
        searchCount: user.searchCount || 0,
        tier: user.tier || 'free', // Default to free if not set
        nickname: user.nickname || null,
        bookmarks: user.bookmarks || [],
        recentSearches: user.recentSearches || []
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Failed to login' });
  }
});

// Google OAuth - Initiate login
app.get('/api/auth/google', (req, res) => {
  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || `https://${req.get('host')}/api/auth/google/callback`;
  
  console.log('🔐 Google OAuth redirect URI:', REDIRECT_URI);
  
  if (!GOOGLE_CLIENT_ID) {
    return res.status(500).json({ error: 'Google OAuth not configured' });
  }

  const scope = 'openid email profile';
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${GOOGLE_CLIENT_ID}&` +
    `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
    `response_type=code&` +
    `scope=${encodeURIComponent(scope)}&` +
    `access_type=online&` +
    `prompt=select_account`;

  res.redirect(authUrl);
});

// Google OAuth - Callback
app.get('/api/auth/google/callback', async (req, res) => {
  try {
    const { code } = req.query;
    const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
    const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || `https://${req.get('host')}/api/auth/google/callback`;
    const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
    
    console.log('🔐 Google OAuth callback - redirect URI:', REDIRECT_URI);

    if (!code) {
      return res.redirect(`${FRONTEND_URL}?auth_error=no_code`);
    }

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return res.redirect(`${FRONTEND_URL}?auth_error=not_configured`);
    }

    // Exchange code for tokens
    const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code'
    });

    const { access_token, id_token } = tokenResponse.data;

    // Get user info from Google
    const userInfoResponse = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${access_token}`
      }
    });

    const { email, id: googleId, name, picture } = userInfoResponse.data;

    if (!email) {
      return res.redirect(`${FRONTEND_URL}?auth_error=no_email`);
    }

    if (!isMongoConnected()) {
      return res.redirect(`${FRONTEND_URL}?auth_error=database_error`);
    }

    // Check if user exists
    let user = await User.findOne({ 
      $or: [
        { email: email.toLowerCase() },
        { googleId: googleId }
      ]
    });

    if (user) {
      // Update existing user with Google ID if they don't have it
      if (!user.googleId) {
        user.googleId = googleId;
        await user.save();
      }
    } else {
      // Create new user
      const userCount = await User.countDocuments();
      console.log(`📝 Creating new Google OAuth user: ${email} (${userCount} existing users)`);

      const initialSearchCount = 0; // New signups start with 3/3 searches
      
      user = new User({
        email: email.toLowerCase(),
        googleId: googleId,
        password: crypto.randomBytes(32).toString('hex'), // Random password for OAuth users
        searchCount: initialSearchCount,
        tier: 'free'
      });

      await user.save();
      console.log(`✅ Google OAuth user created: ${user._id}`);
      // Send welcome email for new Google signups (don't wait)
      const remainingSearches = 3 - initialSearchCount;
      console.log(`📧 Triggering welcome email for ${user.email}...`);
      sendWelcomeEmail(user.email, remainingSearches).catch(err => {
        console.error('📧 Welcome email promise rejection:', err.message);
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id.toString(), email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    // Redirect to frontend with token
    console.log('🔐 Google OAuth success - redirecting to:', `${FRONTEND_URL}?google_auth_success=true&token=${token.substring(0, 20)}...`);
    res.redirect(`${FRONTEND_URL}?google_auth_success=true&token=${token}`);
  } catch (error) {
    console.error('Google OAuth error:', error);
    const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${FRONTEND_URL}?auth_error=oauth_failed`);
  }
});

// Check auth status endpoint
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  if (!req.user) {
    return res.json({ authenticated: false });
  }

  if (!isMongoConnected()) {
    return res.json({ authenticated: false });
  }

  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.json({ authenticated: false });
    }

    // Backfill subscriptionStartedAt for existing subscribers who upgraded before this field existed
    if (user.tier === 'avid' && !user.subscriptionStartedAt) {
      user.subscriptionStartedAt = new Date();
      await user.save();
    }

    res.json({
      authenticated: true,
      user: {
        id: user._id.toString(),
        email: user.email,
        searchCount: user.searchCount || 0,
        tier: user.tier || 'free', // Default to free if not set
        nickname: user.nickname || null,
        icon: user.icon || null,
        subscriptionStartedAt: user.subscriptionStartedAt || null,
        bookmarks: user.bookmarks || [],
        recentSearches: user.recentSearches || []
      }
    });
  } catch (error) {
    console.error('Error checking auth status:', error);
    res.json({ authenticated: false });
  }
});

// Update nickname endpoint
app.put('/api/user/nickname', authenticateToken, async (req, res) => {
  try {
    if (!isMongoConnected()) {
      return res.status(503).json({ error: 'Database not available' });
    }

    const { nickname } = req.body;
    const user = await User.findById(req.user.userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Validate nickname length
    if (nickname && nickname.length > 16) {
      return res.status(400).json({ error: 'Nickname must be 16 characters or less' });
    }

    user.nickname = nickname && nickname.trim() ? nickname.trim() : null;
    await user.save();

    res.json({ success: true, nickname: user.nickname });
  } catch (error) {
    console.error('Error updating nickname:', error);
    res.status(500).json({ error: 'Failed to update nickname' });
  }
});

// Update user icon endpoint
app.put('/api/user/icon', authenticateToken, async (req, res) => {
  try {
    if (!isMongoConnected()) {
      return res.status(503).json({ error: 'Database not available' });
    }

    const { icon } = req.body;
    const user = await User.findById(req.user.userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.icon = icon && icon.trim() ? icon.trim() : null;
    await user.save();

    res.json({ success: true, icon: user.icon });
  } catch (error) {
    console.error('Error updating icon:', error);
    res.status(500).json({ error: 'Failed to update icon' });
  }
});

// Update bookmarks endpoint
app.put('/api/user/bookmarks', authenticateToken, async (req, res) => {
  try {
    if (!isMongoConnected()) {
      return res.status(503).json({ error: 'Database not available' });
    }

    const { bookmarks } = req.body;
    const user = await User.findById(req.user.userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!Array.isArray(bookmarks)) {
      return res.status(400).json({ error: 'Bookmarks must be an array' });
    }

    user.bookmarks = bookmarks;
    await user.save();

    res.json({ success: true, bookmarks: user.bookmarks });
  } catch (error) {
    console.error('Error updating bookmarks:', error);
    res.status(500).json({ error: 'Failed to update bookmarks' });
  }
});

// Update recent searches endpoint
app.put('/api/user/recent-searches', authenticateToken, async (req, res) => {
  try {
    if (!isMongoConnected()) {
      return res.status(503).json({ error: 'Database not available' });
    }

    const { recentSearches } = req.body;
    const user = await User.findById(req.user.userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!Array.isArray(recentSearches)) {
      return res.status(400).json({ error: 'Recent searches must be an array' });
    }

    // Limit to last 8 searches
    user.recentSearches = recentSearches.slice(-8);
    await user.save();

    res.json({ success: true, recentSearches: user.recentSearches });
  } catch (error) {
    console.error('Error updating recent searches:', error);
    res.status(500).json({ error: 'Failed to update recent searches' });
  }
});

// Reset search count endpoint (for debugging)
app.post('/api/user/reset-search-count', authenticateToken, async (req, res) => {
  try {
    if (!isMongoConnected()) {
      return res.status(503).json({ error: 'Database not available' });
    }

    const user = await User.findById(req.user.userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.searchCount = 0;
    await user.save();

    res.json({ success: true, searchCount: 0 });
  } catch (error) {
    console.error('Error resetting search count:', error);
    res.status(500).json({ error: 'Failed to reset search count' });
  }
});

// Check anonymous search status endpoint
app.get('/api/auth/anonymous-status', async (req, res) => {
  const ANONYMOUS_LIMIT = 1;
  
  if (!isMongoConnected()) {
    // Fallback: assume no anonymous search used if DB not available
    return res.json({
      hasAnonymousSearch: true,
      anonymousCount: 0
    });
  }

  try {
    const anonymousId = getAnonymousId(req);
    let anonymousSearch = await AnonymousSearch.findOne({ ipAddress: anonymousId });
    
    const anonymousCount = anonymousSearch ? anonymousSearch.searchCount : 0;
    
    res.json({
      hasAnonymousSearch: anonymousCount < ANONYMOUS_LIMIT,
      anonymousCount: anonymousCount
    });
  } catch (error) {
    console.error('Error checking anonymous status:', error);
    res.json({
      hasAnonymousSearch: true,
      anonymousCount: 0
    });
  }
});

// =========================
// SMART LYRICS SEARCH (Natural Flow)
// =========================
app.post('/api/search-lyrics', authenticateToken, checkSearchLimit, async (req, res) => {
  console.log('🔍 /api/search-lyrics endpoint reached');
  console.log('   Lyrics:', req.body?.lyrics?.substring(0, 50) || 'NO LYRICS');
  console.log('   User:', req.user ? req.user.userId : 'anonymous');
  try {
    const { lyrics } = req.body;
    
    if (!lyrics || lyrics.trim().length === 0) {
      return res.status(400).json({ error: 'No lyrics provided' });
    }

    console.log(`\n🔍 Searching for: "${lyrics}"`);
    
    // Step 1: Search Google for lyrics (Light mode = cheaper!)
    console.log('🌐 Searching Google via Scrapingdog (Light mode)...');
    
    const scrapingdogResponse = await withRetry(() => axios.get('https://api.scrapingdog.com/google', {
      params: {
        api_key: '693680181b73bc56d9ed3b5b',
        query: `${lyrics} lyrics`,  // No quotes = more flexible matching
        results: '10',
        country: 'us',
        page: '0'
      },
      timeout: 8000
    }));
    
    if (!scrapingdogResponse.data || !scrapingdogResponse.data.organic_results) {
      console.log('   ❌ No search results from Scrapingdog');
      return res.json({
        success: false,
        message: 'Could not search for lyrics'
      });
    }
    
    const organicResults = scrapingdogResponse.data.organic_results;
    console.log(`   ✅ Found ${organicResults.length} search results`);
    
    // Step 2: Extract songs from lyrics sites (Genius, AZLyrics, etc.)
    const lyricsSites = organicResults.filter(result => 
      result.link && (
        result.link.includes('genius.com') ||
        result.link.includes('azlyrics.com') ||
        result.link.includes('lyrics.com') ||
        result.link.includes('musixmatch.com') ||
        result.link.includes('metrolyrics.com') ||
        result.link.includes('songlyrics.com')
      )
    );
    
    console.log(`   📄 Found ${lyricsSites.length} lyrics pages`);
    
    if (lyricsSites.length === 0) {
      return res.json({
        success: false,
        message: 'No song lyrics found for this search'
      });
    }
    
    // Step 3: Parse song titles and artists from results
    console.log('🎵 Extracting song info...');
    const songs = [];
    
    for (const result of lyricsSites.slice(0, 8)) {
      const title = result.title || '';
      const snippet = result.snippet || '';
      
      // Common patterns:
      // "Song Title - Artist Lyrics | Site"
      // "Song Title by Artist - Lyrics"
      // "Artist – Song Title Lyrics"
      
      let songTitle = null;
      let artist = null;
      
      // Pattern 1: "Artist – Song Lyrics | Genius"
      let match = title.match(/^(.+?)\s*[–—-]\s*(.+?)\s+(Lyrics|Song)/i);
      if (match) {
        artist = match[1].trim();
        songTitle = match[2].trim();
      }
      
      // Pattern 2: "Song by Artist Lyrics"
      if (!match) {
        match = title.match(/^(.+?)\s+by\s+(.+?)\s*[-–—]?\s*(Lyrics|Song|$)/i);
        if (match) {
          songTitle = match[1].trim();
          artist = match[2].trim();
        }
      }
      
      // Pattern 3: "Song - Artist Lyrics"
      if (!match) {
        match = title.match(/^(.+?)\s*[-–—]\s*(.+?)\s+(Lyrics|Song)/i);
        if (match) {
          songTitle = match[1].trim();
          artist = match[2].trim();
        }
      }
      
      if (songTitle && artist) {
        // Clean up common suffixes
        songTitle = songTitle.replace(/\s*(Lyrics|Song|Official).*$/i, '').trim();
        artist = artist.replace(/\s*(Lyrics|Song|Official).*$/i, '').trim();
        
        // Avoid duplicates
        const isDuplicate = songs.some(s => 
          calculateSimilarity(s.songTitle, songTitle) > 0.85 &&
          calculateSimilarity(s.artist, artist) > 0.85
        );
        
        if (!isDuplicate) {
          songs.push({
            songTitle,
            artist,
            source: result.link.includes('genius') ? 'Genius' :
                   result.link.includes('azlyrics') ? 'AZLyrics' :
                   result.link.includes('musixmatch') ? 'Musixmatch' : 'Web'
          });
          
          console.log(`   ✅ Found: "${songTitle}" by ${artist} (${songs[songs.length - 1].source})`);
        }
      }
    }
    
    if (songs.length === 0) {
      console.log('   ⚠️ Could not parse any songs from results');
      return res.json({
        success: false,
        message: 'Could not identify songs from search results'
      });
    }
    
    console.log(`\n🎯 Extracted ${songs.length} unique songs`);
    
    // Clean song title for better Spotify matching
    function cleanSongTitle(title) {
      return title
        .replace(/\s*\(.*?(Remix|Edit|Version|Feat\.|ft\.|featuring).*?\)/gi, '') // Remove (Remix), (Edited Version), (Feat. X)
        .replace(/\s*\[.*?\]/g, '') // Remove [Explicit], [Clean], etc.
        .replace(/\s*-\s*.*?(Remix|Edit|Version)/gi, '') // Remove "- Remix", "- Edited Version"
        .replace(/\s+/g, ' ') // Normalize spaces
        .trim();
    }
    
    // Step 4: Search Spotify for each song (in parallel for speed)
    console.log('🎵 Searching Spotify (parallel)...');
    
    const token = await getSpotifyToken();
    
    // Create parallel search promises
    const spotifySearches = songs.slice(0, 5).map(async (song, i) => {
      const cleanedTitle = cleanSongTitle(song.songTitle);
      const searchQuery = `${cleanedTitle} ${song.artist}`;
      
      console.log(`   ${i + 1}. Searching: "${searchQuery}"`);
      
      try {
        // Use Spotify's field search for better accuracy
        const fieldQuery = `track:"${cleanedTitle}" artist:"${song.artist}"`;
        
        const spotifyResponse = await axios.get('https://api.spotify.com/v1/search', {
          params: {
            q: fieldQuery,
            type: 'track',
            limit: 5
          },
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        
        if (spotifyResponse.data.tracks.items && spotifyResponse.data.tracks.items.length > 0) {
          const tracks = spotifyResponse.data.tracks.items;
          
          // Pick most popular
          const track = tracks.reduce((best, current) => 
            current.popularity > best.popularity ? current : best
          );
          
          console.log(`      ✅ Found: "${track.name}" by ${track.artists[0].name} (${track.popularity}/100)`);
          
          return {
            title: track.name,
            artist: track.artists[0].name,
            album: track.album.name,
            confidence: 0, // Will be assigned after sorting by popularity
            source: song.source.toLowerCase(),
            spotify: {
              title: track.name,
              artist: track.artists[0].name,
              album: track.album.name,
              album_art: track.album.images[0]?.url || '',
              popularity: track.popularity,
              preview_url: track.preview_url,
              external_url: track.external_urls.spotify,
              uri: track.uri,
              id: track.id
            }
          };
        } else {
          console.log(`      ❌ No Spotify match`);
          return null;
        }
      } catch (err) {
        console.log(`      ❌ Error: ${err.message}`);
        return null;
      }
    });
    
    // Wait for all searches to complete
    const searchResults = await Promise.all(spotifySearches);
    const results = searchResults.filter(r => r !== null);
    
    if (results.length === 0) {
      return res.json({
        success: false,
        message: 'No songs found on Spotify'
      });
    }
    
    // Sort by Spotify popularity (descending)
    console.log('\n📊 Sorting by popularity...');
    results.sort((a, b) => {
      const popA = a.spotify?.popularity || 0; // YouTube results get 0 popularity
      const popB = b.spotify?.popularity || 0;
      return popB - popA;
    });
    
    // Reassign confidence based on new sorted order
    results.forEach((song, index) => {
      // YouTube-only results get slightly lower confidence
      const baseConfidence = index === 0 ? 95 : index === 1 ? 85 : index === 2 ? 75 : 65;
      song.confidence = song.spotify ? baseConfidence : Math.max(baseConfidence - 10, 50);
    });
    
    console.log(`✨ Returning ${results.length} results (sorted by popularity)`);
    const topMatch = results[0];
    const source = topMatch.spotify ? `Spotify: ${topMatch.spotify.popularity}/100` : 'YouTube';
    console.log(`   Top match: "${topMatch.title}" by ${topMatch.artist} (${source}, Confidence: ${topMatch.confidence}%)`);
    
    // Increment search count
    if (isMongoConnected()) {
      try {
        if (req.user) {
          await User.findByIdAndUpdate(req.user.userId, {
            $inc: { searchCount: 1 }
          });
        } else {
          const anonymousId = getAnonymousId(req);
          await AnonymousSearch.findOneAndUpdate(
            { ipAddress: anonymousId },
            { $inc: { searchCount: 1 }, $set: { lastSearchAt: new Date() } },
            { upsert: true, new: true }
          );
        }
      } catch (error) {
        console.error('Error updating search count:', error);
      }
    }
    
    return res.json({
      success: true,
      songs: results,
      search_method: 'natural_web_search'
    });
    
  } catch (error) {
    console.error('❌ Lyrics search error:', error.message);
    return res.status(500).json({ 
      error: 'Failed to search lyrics',
      details: error.message 
    });
  }
});

// Endpoint to find original version of a song (for replacing covers/remixes)
app.post('/api/find-original', authenticateToken, async (req, res) => {
  try {
    const { title, artist } = req.body;
    
    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }
    
    const original = await findMostPopularVersion(title);
    
    if (original) {
      return res.json({
        success: true,
        song: {
          title: original.title,
          artist: original.artist,
          album: original.album,
          confidence: 0, // Will be recalculated
          spotify: original.spotify
        }
      });
    }
    
    return res.json({
      success: false,
      message: 'Could not find original version'
    });
  } catch (error) {
    console.error('❌ Error finding original:', error);
    res.status(500).json({ error: 'Failed to find original version' });
  }
});

// =========================
// MAIN HYBRID ENDPOINT
// =========================
// IMPORTANT: upload.single('audio') must come FIRST to parse the file before other middlewares
app.post('/api/identify', upload.single('audio'), authenticateToken, checkSearchLimit, async (req, res) => {
  console.log('🎤 /api/identify endpoint reached');
  console.log('   File received:', req.file ? `${req.file.size} bytes` : 'NO FILE');
  console.log('   User:', req.user ? req.user.userId : 'anonymous');
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    console.log('🎤 Received audio file:', req.file.size, 'bytes');
    console.log('🔄 Running ACRCloud identification...');
    
    let acrResult;
    try {
      acrResult = await identifyAudio(req.file.buffer);
    console.log('📊 ACRCloud status:', acrResult.status?.code === 0 ? 'SUCCESS' : 'NO MATCH');
    } catch (acrError) {
      console.error('❌ ACRCloud error:', acrError.message);
      console.error('   Stack:', acrError.stack);
      // Continue with empty result instead of crashing
      acrResult = {
        status: { code: -1, msg: 'ACRCloud API error' },
        metadata: {}
      };
    }
    
    // Log ACRCloud's raw response structure for debugging
    if (acrResult.status.code === 0) {
      console.log('\n🔍 ACRCloud Raw Response:');
      console.log(`   Music matches: ${acrResult.metadata?.music?.length || 0}`);
      console.log(`   Humming matches: ${acrResult.metadata?.humming?.length || 0}`);
      if (acrResult.metadata?.music && acrResult.metadata.music.length > 0) {
        console.log(`   First 10 song titles:`);
        acrResult.metadata.music.slice(0, 10).forEach((song, i) => {
          console.log(`      ${i + 1}. "${song.title}" - ${song.artists?.[0]?.name || 'Unknown'}`);
        });
      }
    }
    
    // Training data saving disabled
    // saveTrainingData(req.file.buffer, acrResult);
    
    // Process ACRCloud results
    if (acrResult.status.code === 0 && (acrResult.metadata?.music?.length > 0 || acrResult.metadata?.humming?.length > 0)) {
      const matches = acrResult.metadata.music || acrResult.metadata.humming;
      
      console.log(`\n📊 ACRCloud returned ${matches.length} total matches`);
      
      const rankedMatches = rankACRResults(matches);
      
      console.log('\n📊 TOP 3 RANKED MATCHES (before language filter):');
      rankedMatches.slice(0, 3).forEach((match, i) => {
        console.log(`  ${i + 1}. "${match.title}" - ${match.artists?.[0]?.name || 'Unknown'}`);
        console.log(`     Score: ${match.adjustedScore.toFixed(2)} | ISRC: ${match.external_ids?.isrc || 'none'}`);
      });
      
      // Cap how many matches we enrich with Spotify lookups to bound API calls/latency
      const MAX_SPOTIFY_ENRICHMENT_MATCHES = 10;
      const matchesToEnrich = rankedMatches.slice(0, MAX_SPOTIFY_ENRICHMENT_MATCHES);
      console.log(`\n🎵 Fetching Spotify data for top ${matchesToEnrich.length} of ${rankedMatches.length} matches...`);

      const spotifyPromises = matchesToEnrich.map(async (match) => {
        let spotifyData = null;
        
        if (match.external_ids?.isrc) {
          spotifyData = await getSpotifyTrack(match.external_ids.isrc);
        }
        
        if (!spotifyData && match.title && match.artists?.[0]?.name) {
          spotifyData = await getSpotifyTrackByName(match.title, match.artists[0].name);
        }
        
        return {
          ...match,
          spotify: spotifyData
        };
      });
      
      let matchesWithSpotify = await Promise.all(spotifyPromises);
      
      matchesWithSpotify.forEach((match, i) => {
        if (match.spotify) {
          console.log(`  ✅ #${i + 1}: "${match.title}" - Spotify popularity: ${match.spotify.popularity}/100`);
        } else {
          console.log(`  ❌ #${i + 1}: "${match.title}" - No Spotify data`);
        }
      });
      
      // NEW: Replace obvious covers AND low-popularity versions with the most popular "canonical" version
      //      BEFORE final ranking. This helps map things like random "Hey Jude" covers to The Beatles version.
      console.log('\n🔄 Checking for more popular canonical versions (covers + low-popularity matches)...');
      const replacementPromises = matchesWithSpotify.map(async (match) => {
        if (!match.title) return match;

        const currentPopularity = match.spotify?.popularity || 0;

        // Skip if already very popular – likely the canonical version
        if (currentPopularity >= 75) {
          return match;
        }
        
        const titleLower = (match.title || '').toLowerCase();
        const artistLower = (match.artists?.[0]?.name || '').toLowerCase();

        // 1) Detect obvious covers/remixes
        const isCoverRemix = titleLower.includes('cover') || 
                            titleLower.includes('remix') || 
                            titleLower.includes('tribute') ||
                            titleLower.includes('acoustic') ||
                            artistLower.includes('cover');
        
        // 2) Detect "reasonably specific" titles for canonical replacement
        //    - at least two words after cleaning
        //    - total length >= 6 characters
        const cleanedForLength = cleanTitleForComparison(match.title);
        const titleWords = cleanedForLength.split(/\s+/).filter(Boolean);
        const isReasonablySpecificTitle = titleWords.length >= 2 && cleanedForLength.length >= 6;
        
        // If it's not an obvious cover/remix AND the title is very generic (e.g. "Intro"),
        // don't attempt replacement to avoid weird jumps.
        if (!isCoverRemix && !isReasonablySpecificTitle) {
          return match;
        }
        
        // Try to find a more popular canonical version on Spotify
        const mostPopular = await findMostPopularVersion(match.title);
        if (mostPopular && mostPopular.popularity > (match.spotify?.popularity || 0)) {
          const cleanMatchTitle = cleanTitleForComparison(match.title);
          const cleanPopularTitle = cleanTitleForComparison(mostPopular.title);
          const similarity = calculateSimilarity(cleanMatchTitle, cleanPopularTitle);

          // For explicit covers/remixes we can be a bit looser;
          // for generic "Hey Jude" style titles, require a tighter match and bigger popularity gap.
          const requiredSimilarity = isCoverRemix ? 0.75 : 0.90;
          const requiredGap = isCoverRemix ? 10 : 20;
          
          if (
            similarity >= requiredSimilarity &&
            mostPopular.popularity >= currentPopularity + requiredGap &&
            mostPopular.popularity >= 50 // don't jump to an obscure version
          ) {
            console.log(
              `   🔄 Replacing "${match.title}" (${currentPopularity}/100)` +
              ` with canonical "${mostPopular.title}" (${mostPopular.popularity}/100)` +
              (isCoverRemix ? ' [cover/remix detected]' : ' [canonical popularity upgrade]')
            );
            
            // Get Spotify data for the original
            let originalSpotify = await getSpotifyTrackByName(mostPopular.title, mostPopular.artist);
            
            return {
              ...match,
              title: mostPopular.title,
              artists: [{ name: mostPopular.artist }],
              album: { name: mostPopular.album },
              spotify: originalSpotify || {
                title: mostPopular.title,
                artist: mostPopular.artist,
                album: mostPopular.album,
                popularity: mostPopular.popularity,
                id: mostPopular.spotifyId,
                external_urls: { spotify: `https://open.spotify.com/track/${mostPopular.spotifyId}` }
              },
              external_ids: { ...match.external_ids, isrc: mostPopular.isrc },
              wasReplaced: true
            };
          }
        }
        
        return match;
      });
      
      matchesWithSpotify = await Promise.all(replacementPromises);
      
      console.log('\n📈 Applying Spotify popularity boosts and language penalties...');
      let finalMatches = combineWithSpotify(matchesWithSpotify);
      
      finalMatches.sort((a, b) => b.finalScore - a.finalScore);
      
      console.log('\n🏆 FINAL RANKING (after Spotify boost):');
      finalMatches.slice(0, 3).forEach((match, i) => {
        const spotifyInfo = match.spotify ? ` | Spotify: ${match.spotify.popularity}/100` : ' | No Spotify data';
        console.log(`  ${i + 1}. "${match.title}" - ${match.artists?.[0]?.name}`);
        console.log(`     Final Score: ${match.finalScore.toFixed(2)}${spotifyInfo}`);
      });

      // NEW: If the current winner has no Spotify data but similar versions do,
      // prefer the version with the highest Spotify popularity.
      let winner = finalMatches[0];
      if (!winner.spotify || !winner.spotify.popularity) {
        const winnerCleanTitle = cleanTitleForComparison(winner.title || '');

        const candidatesWithSpotify = finalMatches
          .filter(match => match.spotify && match.spotify.popularity)
          .map(match => {
            const cleaned = cleanTitleForComparison(match.title || '');
            const similarity = calculateSimilarity(winnerCleanTitle, cleaned);
            return { match, similarity };
          })
          // Require very similar titles so we don't jump to a different song
          .filter(entry => entry.similarity >= 0.9);

        if (candidatesWithSpotify.length > 0) {
          // Pick the one with the highest Spotify popularity
          candidatesWithSpotify.sort(
            (a, b) => (b.match.spotify.popularity || 0) - (a.match.spotify.popularity || 0)
          );

          const best = candidatesWithSpotify[0].match;

          if (best !== winner) {
            console.log('\n🏅 Promoting Spotify-backed version over ACR-only winner:');
            console.log(
              `   Original winner: "${winner.title}" by ${winner.artists?.[0]?.name} (no Spotify data)`
            );
            console.log(
              `   New winner: "${best.title}" by ${best.artists?.[0]?.name} (Spotify popularity ${best.spotify.popularity}/100)`
            );

            // Move the Spotify-backed candidate to the front, preserving order of others
            finalMatches = [best, ...finalMatches.filter(m => m !== best)];
            winner = finalMatches[0];
          }
        }
      }
      
      // NEW: Check if the winner might be a cover - search for most popular version
      
      // NEW: Skip auto-replacement for generic nursery rhyme titles
      if (isGenericTitle(winner.title)) {
        console.log(`\n⚠️  GENERIC TITLE DETECTED: "${winner.title}"`);
        console.log(`   Skipping auto-replacement to avoid wrong version (e.g., reggaeton vs traditional)`);
        console.log(`   Keeping ACRCloud's original match: "${winner.title}" by ${winner.artists?.[0]?.name}\n`);
      } else {
        const mostPopular = await findMostPopularVersion(winner.title);
        
        if (mostPopular && mostPopular.artist.toLowerCase() !== winner.artists?.[0]?.name?.toLowerCase()) {
          // Different artist - probably found the original!
          const popularityDiff = mostPopular.popularity - (winner.spotify?.popularity || 0);
          
          // 🔧 FIX: Clean BOTH titles before comparing!
          const cleanWinnerTitle = cleanTitleForComparison(winner.title);
          const cleanCandidateTitle = cleanTitleForComparison(mostPopular.title);
          const titleSimilarity = calculateSimilarity(cleanWinnerTitle, cleanCandidateTitle);
          
          console.log(`\n🔍 Checking if we should replace winner:`);
          console.log(`   Current: "${winner.title}" by ${winner.artists?.[0]?.name} (${winner.spotify?.popularity || 0}/100)`);
          console.log(`   Candidate: "${mostPopular.title}" by ${mostPopular.artist} (${mostPopular.popularity}/100)`);
          console.log(`   🧹 Cleaned current: "${cleanWinnerTitle}"`);
          console.log(`   🧹 Cleaned candidate: "${cleanCandidateTitle}"`);
          console.log(`   📊 Title similarity: ${(titleSimilarity * 100).toFixed(0)}%`);
          console.log(`   📊 Popularity difference: +${popularityDiff}`);
          
          // Only replace if titles are VERY similar (85%+) AND popularity is significantly better (20+ points)
          if (popularityDiff >= 20 && titleSimilarity >= 0.85) {
            console.log(`   ✅ REPLACING! (similarity ${(titleSimilarity * 100).toFixed(0)}% >= 85% AND popularity +${popularityDiff} >= +20)\n`);
            
            // Create new winner entry
            const newWinner = {
              title: mostPopular.title,
              artists: [{ name: mostPopular.artist }],
              album: { name: mostPopular.album },
              adjustedScore: 1.0,
              finalScore: 1.0,
              spotify: mostPopular.spotify,
              external_ids: { isrc: mostPopular.isrc },
              wasReplaced: true,
              originalWinner: winner.title + ' - ' + winner.artists?.[0]?.name
            };
            
            // Insert at the beginning
            finalMatches = [newWinner, ...finalMatches];
          } else {
            console.log(`   ❌ NOT REPLACING (similarity ${(titleSimilarity * 100).toFixed(0)}% < 85% OR popularity +${popularityDiff} < +20)\n`);
          }
        }
      }
      
      console.log(`\n✨ FINAL WINNER: "${finalMatches[0].title}" by ${finalMatches[0].artists?.[0]?.name} (${Math.round(finalMatches[0].finalScore * 100)}%)\n`);
      
      // Build response - PREFER SPOTIFY METADATA when available
      const topResults = finalMatches.slice(0, 5).map(match => ({
        title: match.spotify?.title || match.title,
        artist: match.spotify?.artist || match.artists?.[0]?.name || 'Unknown Artist',
        album: match.spotify?.album || match.album?.name || '',
        releaseDate: match.release_date || '',
        duration: match.duration_ms || 0,
        confidence: Math.round(match.finalScore * 100),
        externalIds: {
          spotify: match.external_ids?.spotify || null,
          youtube: match.external_metadata?.youtube?.vid || null,
          isrc: match.external_ids?.isrc || null
        },
        spotify: match.spotify || null,
        source: 'acrcloud',
        wasAutoReplaced: match.wasReplaced || false
      }));
      
      // Increment search count
      if (isMongoConnected()) {
        try {
          if (req.user) {
            await User.findByIdAndUpdate(req.user.userId, {
              $inc: { searchCount: 1 }
            });
          } else {
            const anonymousId = getAnonymousId(req);
            await AnonymousSearch.findOneAndUpdate(
              { ipAddress: anonymousId },
              { $inc: { searchCount: 1 }, $set: { lastSearchAt: new Date() } },
              { upsert: true, new: true }
            );
          }
        } catch (error) {
          console.error('Error updating search count:', error);
        }
      }
      
      const response = {
        success: true,
        songs: topResults,
        primary_source: 'acrcloud'
      };
      
      res.json(response);
      
    } else {
      // ACRCloud failed - no match found
      res.json({
        success: false,
        message: acrResult.status.msg || 'No match found.'
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to identify audio',
      details: error.message 
    });
  }
});

// =========================
// FEEDBACK ENDPOINT
// =========================
app.post('/api/feedback', upload.single('audio'), async (req, res) => {
  try {
    const { songId, title, artist } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    console.log(`📚 User feedback: Correct song is "${title}" (${songId})`);
    
    const timestamp = Date.now();
    const filename = `feedback_${timestamp}.webm`;
    const dir = path.join(__dirname, 'training-data', 'humming');
    
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    const filepath = path.join(dir, filename);
    await fs.promises.writeFile(filepath, req.file.buffer);
    console.log(`💾 Saved feedback audio: ${filename}`);
    
    res.json({ success: true, message: 'Thanks for the feedback!' });
    
  } catch (error) {
    console.error('❌ Feedback error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to record feedback' 
    });
  }
});

// =========================
// GENERAL FEEDBACK ENDPOINT (requires sign-in; sends to hummmteam@gmail.com from registered user)
// =========================
app.post('/api/general-feedback', authenticateToken, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'You must sign in to give feedback' });
    }

    const { feedback, songTitle, songArtist, timestamp } = req.body;
    
    if (!feedback || feedback.length > 500) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid feedback' 
      });
    }

    const user = await User.findById(req.user.userId);
    if (!user || !user.email) {
      return res.status(401).json({ success: false, error: 'You must sign in to give feedback' });
    }

    const fromEmail = user.email;
    console.log(`📝 General feedback from ${fromEmail}:`);
    console.log(`   Feedback: ${feedback}`);
    console.log(`   Song: ${songTitle} - ${songArtist}`);
    console.log(`   Time: ${timestamp}`);

    // Respond immediately so the client doesn't hang; send email in background
    res.json({
      success: true,
      message: 'Feedback received!'
    });

    // Send feedback email. Prefer Resend (HTTPS, no SMTP timeout on Render).
    // If feedback contains a Spotify track link, fetch track and show album art thumbnail in email.
    // FEEDBACK_EMAIL_TO defaults to hummmteam@gmail.com. Until you verify a domain in Resend, set it to
    // your Resend account email (e.g. omar.tawil10@gmail.com) so Resend allows sending.
    const sendFeedbackEmail = async () => {
      const to = process.env.FEEDBACK_EMAIL_TO || 'hummmteam@gmail.com';
      const subject = `hüm App Feedback - ${new Date().toLocaleDateString()}`;

      let thumbnailHtml = '';
      const spotifyTrackMatch = feedback.match(/open\.spotify\.com\/track\/([a-zA-Z0-9]+)/);
      if (spotifyTrackMatch) {
        try {
          const token = await getSpotifyToken();
          if (token) {
            const trackRes = await axios.get(
              `https://api.spotify.com/v1/tracks/${spotifyTrackMatch[1]}`,
              { headers: { 'Authorization': `Bearer ${token}` }, timeout: 5000 }
            );
            const t = trackRes.data;
            const art = t.album?.images?.[0]?.url;
            const name = (t.name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            const artist = (t.artists?.[0]?.name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            const url = t.external_urls?.spotify || `https://open.spotify.com/track/${spotifyTrackMatch[1]}`;
            if (art) {
              thumbnailHtml = `
                <div style="margin:16px 0; padding:12px; background:#f5f5f5; border-radius:12px; max-width:320px;">
                  <a href="${url}" style="text-decoration:none; color:inherit;">
                    <img src="${art}" alt="" width="120" height="120" style="border-radius:8px; display:block; margin-bottom:8px;" />
                    <p style="margin:0; font-weight:600; font-size:14px;">${name}</p>
                    <p style="margin:4px 0 0 0; font-size:13px; color:#666;">${artist}</p>
                    <p style="margin:8px 0 0 0; font-size:12px; color:#1DB954;">Open in Spotify →</p>
                  </a>
                </div>
              `;
            }
          }
        } catch (e) {
          // ignore; email still sends without thumbnail
        }
      }

      const escape = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const html = `
        <h2>New Feedback from hüm App</h2>
        <p><strong>From:</strong> ${escape(fromEmail)}</p>
        <p><strong>Feedback:</strong></p>
        <p>${escape(feedback)}</p>
        ${thumbnailHtml}
        <hr>
        <p><strong>Song Context:</strong> ${escape(songTitle)} - ${escape(songArtist)}</p>
        <p><strong>Timestamp:</strong> ${new Date(timestamp).toLocaleString()}</p>
      `;

      if (resend) {
        try {
          const from = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
          const { data, error } = await resend.emails.send({
            from: `hüm feedback <${from}>`,
            to,
            replyTo: fromEmail,
            subject,
            html
          });
          if (error) throw new Error(error.message);
          console.log('   ✅ Feedback email sent to', to, '(Resend)');
        } catch (err) {
          console.log('   ❌ Resend feedback email failed:', err.message);
        }
        return;
      }

      const emailUser = process.env.FEEDBACK_EMAIL_USER;
      const emailPass = process.env.FEEDBACK_EMAIL_PASSWORD;
      if (!emailUser || !emailPass) {
        console.log('   ⚠️  Feedback email NOT SENT: set RESEND_API_KEY (recommended) or FEEDBACK_EMAIL_USER + FEEDBACK_EMAIL_PASSWORD. Resend avoids SMTP timeouts on Render.');
        return;
      }
      try {
        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: { user: emailUser, pass: emailPass },
          connectionTimeout: 10000
        });
        await transporter.sendMail({
          from: emailUser,
          to,
          replyTo: fromEmail,
          subject,
          html
        });
        console.log('   ✅ Email sent to', to, '(Gmail SMTP)');
      } catch (emailError) {
        console.log('   ❌ Feedback email FAILED:', emailError.message);
        if (emailError.message && emailError.message.includes('timeout')) {
          console.log('   💡 Gmail SMTP often times out on Render. Add RESEND_API_KEY and use Resend for feedback emails instead.');
        }
      }
    };
    sendFeedbackEmail().catch((e) => console.error('Feedback email error:', e.message));
    
  } catch (error) {
    console.error('❌ General feedback error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to send feedback' 
    });
  }
});

// Test feedback email config (requires sign-in). Uses Resend if set, else Gmail SMTP.
app.post('/api/feedback-email-test', authenticateToken, async (req, res) => {
  const to = process.env.FEEDBACK_EMAIL_TO || 'hummmteam@gmail.com';
  if (resend) {
    try {
      const from = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
      const { error } = await resend.emails.send({
        from: `hüm feedback <${from}>`,
        to,
        subject: 'hüm feedback email test',
        text: 'If you got this, feedback emails are working.'
      });
      if (error) throw new Error(error.message);
      return res.json({ success: true, message: `Test email sent via Resend to ${to} — check inbox and spam.` });
    } catch (err) {
      return res.json({ success: false, error: err.message });
    }
  }
  const emailUser = process.env.FEEDBACK_EMAIL_USER;
  const emailPass = process.env.FEEDBACK_EMAIL_PASSWORD;
  if (!emailUser || !emailPass) {
    return res.json({ success: false, error: 'Set RESEND_API_KEY (recommended) or FEEDBACK_EMAIL_USER + FEEDBACK_EMAIL_PASSWORD' });
  }
  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: emailUser, pass: emailPass },
      connectionTimeout: 10000
    });
    await transporter.sendMail({
      from: emailUser,
      to,
      subject: 'hüm feedback email test',
      text: 'If you got this, feedback emails are working.'
    });
    res.json({ success: true, message: `Test email sent via Gmail to ${to}.` });
  } catch (err) {
    const hint = err.message && err.message.includes('timeout')
      ? ' Gmail SMTP often times out on Render. Add RESEND_API_KEY and use Resend instead.'
      : (err.message && (err.message.includes('Invalid login') || err.message.includes('Username and Password not accepted')) ? ' Use a Gmail App Password.' : '');
    res.json({ success: false, error: err.message + hint });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Public: get track by Spotify ID (for share links - no auth required)
app.get('/api/track/:spotifyTrackId', async (req, res) => {
  try {
    const { spotifyTrackId } = req.params;
    if (!spotifyTrackId || !/^[a-zA-Z0-9]+$/.test(spotifyTrackId)) {
      return res.status(400).json({ error: 'Invalid track ID' });
    }
    const token = await getSpotifyToken();
    if (!token) {
      return res.status(503).json({ error: 'Spotify not configured' });
    }
    const response = await axios.get(
      `https://api.spotify.com/v1/tracks/${spotifyTrackId}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const track = response.data;
    res.json({
      id: track.id,
      title: track.name,
      artist: track.artists?.[0]?.name || 'Unknown',
      album: track.album?.name || '',
      popularity: track.popularity ?? 0,
      preview_url: track.preview_url || null,
      external_url: track.external_urls?.spotify || null,
      album_art: track.album?.images?.[0]?.url || null,
    });
  } catch (err) {
    if (err.response?.status === 404) {
      return res.status(404).json({ error: 'Track not found' });
    }
    console.error('Track lookup error:', err.message);
    res.status(500).json({ error: 'Failed to fetch track' });
  }
});

// =========================
// PAYMENT ENDPOINTS
// =========================

// Create Stripe Checkout Session
app.post('/api/payments/create-checkout-session', authenticateToken, async (req, res) => {
  try {
    if (!stripe) {
      return res.status(503).json({ error: 'Payment system not configured' });
    }

    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { plan, billingPeriod = 'monthly' } = req.body; // 'avid' | 'unlimited', 'monthly' or 'yearly'

    if (!plan || !SUBSCRIPTION_PLANS[plan]) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    if (billingPeriod && !['monthly', 'yearly'].includes(billingPeriod)) {
      return res.status(400).json({ error: 'Invalid billing period' });
    }

    const selectedPlan = SUBSCRIPTION_PLANS[plan];
    const interval = billingPeriod === 'yearly' ? 'year' : 'month';

    if (!isMongoConnected()) {
      return res.status(503).json({ error: 'Database not available' });
    }

    const user = await User.findById(req.user.userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // If user already has an active Stripe subscription, update it to the correct price for the selected plan/period
    if (user.stripeSubscriptionId) {
      console.log(`🔄 Updating existing subscription for user ${user.email} to plan ${plan} (${billingPeriod})`);

      const subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
      if (!subscription || !subscription.items || !subscription.items.data.length) {
        return res.status(400).json({ error: 'Existing subscription not found or has no items' });
      }

      const currentItem = subscription.items.data[0];
      const currentInterval = currentItem.price?.recurring?.interval; // 'month' or 'year'

      if (!currentInterval) {
        return res.status(400).json({ error: 'Current subscription has no interval information' });
      }

      // Use get-or-create price so existing accounts get the correct plan pricing, not Dashboard prices
      const unitAmount = billingPeriod === 'yearly' ? selectedPlan.yearlyPrice : selectedPlan.monthlyPrice;
      const targetPriceId = await getOrCreatePlanPriceId(plan, interval, unitAmount);
      const currentFullPrice = currentItem.price?.unit_amount || 0;

      // Same exact plan + interval. If the subscription is set to cancel at period
      // end, re-selecting it means "resubscribe" — clear the cancellation so it
      // renews normally. Otherwise it's a genuine no-op.
      if (plan === user.tier && interval === currentInterval) {
        if (subscription.cancel_at_period_end) {
          await releaseSubscriptionSchedule(subscription);
          await stripe.subscriptions.update(user.stripeSubscriptionId, {
            cancel_at_period_end: false,
          });
          console.log(`♻️ Reactivated subscription for ${user.email} (cleared cancel_at_period_end)`);
          return res.json({ success: true, reactivated: true, tier: user.tier, interval: billingPeriod });
        }
        return res.json({ success: true, upgraded: false, noChange: true, tier: user.tier });
      }

      // Immediate vs. scheduled, refund-safe rule: applying a change immediately
      // with always_invoice proration is only safe (never a net refund) when the
      // new period's price is at least the current period's price — the credit for
      // unused current time can't exceed the current full price. Anything cheaper
      // (a tier downgrade, OR a yearly→monthly switch where a big prepaid balance
      // would otherwise be refunded) is deferred to the period end with no refund:
      // a subscription schedule keeps the current plan until period end, then
      // rotates onto the target plan. The customer.subscription.updated webhook
      // flips the stored tier when the new phase starts.
      const isImmediate = unitAmount >= currentFullPrice;

      if (!isImmediate) {
        const periodStart = subscription.current_period_start
          || subscription.items?.data?.[0]?.current_period_start;
        const periodEnd = subscription.current_period_end
          || subscription.items?.data?.[0]?.current_period_end;
        if (!periodStart || !periodEnd) {
          return res.status(400).json({ error: 'Could not determine the current billing period' });
        }

        let scheduleId = subscription.schedule;
        if (!scheduleId) {
          const schedule = await stripe.subscriptionSchedules.create({
            from_subscription: user.stripeSubscriptionId,
          });
          scheduleId = schedule.id;
        }

        await stripe.subscriptionSchedules.update(scheduleId, {
          end_behavior: 'release',
          phases: [
            {
              items: [{ price: currentItem.price.id, quantity: 1 }],
              start_date: periodStart,
              end_date: periodEnd,
            },
            {
              items: [{ price: targetPriceId, quantity: 1 }],
              iterations: 1,
            },
          ],
        });

        const effectiveDate = new Date(periodEnd * 1000).toISOString();
        console.log(`🗓️ Scheduled plan change for ${user.email}: ${user.tier}/${currentInterval} → ${plan}/${interval} at ${effectiveDate}`);

        return res.json({
          success: true,
          downgradeScheduled: true,
          tier: user.tier,
          targetTier: plan,
          targetInterval: billingPeriod,
          effectiveDate,
        });
      }

      // If a downgrade was previously scheduled, the subscription is schedule-managed
      // and can't be updated directly — release the schedule first (this also cancels
      // the pending downgrade, which is correct since the user is now upgrading).
      await releaseSubscriptionSchedule(subscription);

      // 'always_invoice' charges the prorated difference immediately: Stripe credits
      // the unused time on the old plan and bills only the gap, so upgrading mid-cycle
      // never double-charges.
      const updated = await stripe.subscriptions.update(user.stripeSubscriptionId, {
        cancel_at_period_end: false,
        proration_behavior: 'always_invoice',
        items: [{
          id: currentItem.id,
          price: targetPriceId,
        }],
      });

      user.tier = plan;
      if (updated.current_period_start) {
        user.subscriptionStartedAt = new Date(updated.current_period_start * 1000);
      } else {
        user.subscriptionStartedAt = new Date();
      }
      await user.save();

      console.log(`✅ Subscription updated for ${user.email}: ${updated.id}`);
      return res.json({
        success: true,
        upgraded: true,
        tier: user.tier,
        interval: billingPeriod,
      });
    }

    // No existing subscription: create checkout with price_data so amount always matches the UI
    const unitAmount = parseInt(billingPeriod === 'yearly' ? selectedPlan.yearlyPrice : selectedPlan.monthlyPrice, 10);
    const displayPrice = (unitAmount / 100).toFixed(2);
    const displayLabel = interval === 'year' ? `$${displayPrice}/year` : `$${displayPrice}/month`;
    console.log(`💳 Creating Checkout with price_data: ${displayLabel} (${unitAmount} cents)`);
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${selectedPlan.name} — ${displayLabel}`,
              description: selectedPlan.description || undefined,
              metadata: { plan, amount_cents: String(unitAmount) },
            },
            unit_amount: unitAmount,
            recurring: { interval },
          },
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}?payment=canceled`,
      client_reference_id: user._id.toString(),
      customer_email: user.email,
      metadata: {
        userId: user._id.toString(),
        plan: plan,
      },
    });

    console.log(`✅ Checkout session created: ${session.id} for user ${user.email}`);
    res.json({ 
      success: true, 
      sessionId: session.id,
      url: session.url,
      amountCents: unitAmount,
      displayPrice: displayLabel,
    });
  } catch (error) {
    console.error('Stripe checkout error:', error);
    const errorMessage = error.message || 'Failed to create checkout session';
    console.error('Error details:', {
      message: errorMessage,
      type: error.type,
      code: error.code,
      statusCode: error.statusCode
    });
    res.status(500).json({ 
      error: errorMessage,
      details: error.type || 'Unknown error'
    });
  }
});

// Stripe webhook handler (for subscription events)
// Note: This endpoint should be configured in Stripe dashboard
// The webhook URL should be: https://yourdomain.com/api/payments/webhook
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) {
    return res.status(503).send('Payment system not configured');
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('⚠️  STRIPE_WEBHOOK_SECRET not configured');
    return res.status(500).send('Webhook secret not configured');
  }

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata?.userId;
    const plan = session.metadata?.plan;

    if (userId && plan && isMongoConnected()) {
      try {
        const user = await User.findById(userId);
        if (user) {
          user.tier = plan;
          user.searchCount = 0; // Reset search count for new subscription
          user.stripeSubscriptionId = session.subscription;
          user.subscriptionStartedAt = new Date();
          // Capture Stripe customer ID for future use
          if (session.customer) {
            user.stripeCustomerId = session.customer;
          }
          await user.save();
          console.log(`✅ User ${user.email} subscribed to ${plan} tier`);
        }
      } catch (error) {
        console.error('Error updating user tier:', error);
      }
    }
  } else if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    if (isMongoConnected()) {
      try {
        const user = await User.findOne({ stripeSubscriptionId: subscription.id });
        if (user) {
          user.tier = 'free';
          user.stripeSubscriptionId = null;
          user.subscriptionStartedAt = null;
          await user.save();
          console.log(`⚠️ User ${user.email} subscription canceled, downgraded to free`);
        }
      } catch (error) {
        console.error('Error downgrading user:', error);
      }
    }
  } else if (event.type === 'customer.subscription.updated') {
    const subscription = event.data.object;
    if (isMongoConnected()) {
      try {
        const user = await User.findOne({ stripeSubscriptionId: subscription.id });
        if (user && subscription.items && subscription.items.data.length) {
          const priceObj = subscription.items.data[0].price;
          const priceId = priceObj.id;
          const amount = priceObj.unit_amount;
          const matchedPlan = planForStripePrice(priceId, amount);
          user.tier = matchedPlan || user.tier;
          if (subscription.current_period_start) {
            user.subscriptionStartedAt = new Date(subscription.current_period_start * 1000);
          }
          await user.save();
          console.log(`🔄 Updated user ${user.email} tier to ${user.tier} from subscription update`);
        }
      } catch (error) {
        console.error('Error handling subscription update:', error);
      }
    }
  }

  res.json({ received: true });
});

// Create PayPal Order
app.post('/api/payments/create-paypal-order', authenticateToken, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { plan } = req.body;

    if (!plan || !SUBSCRIPTION_PLANS[plan]) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    const selectedPlan = SUBSCRIPTION_PLANS[plan];


    if (!isMongoConnected()) {
      return res.status(503).json({ error: 'Database not available' });
    }
    
    const user = await User.findById(req.user.userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // For now, return a simple redirect URL
    // In production, you'd integrate with PayPal SDK
    // This is a placeholder - you'll need to set up PayPal SDK
    const paypalUrl = `https://www.paypal.com/checkoutnow?token=PLACEHOLDER&userId=${user._id.toString()}&plan=${plan}`;
    
    res.json({
      success: true,
      approvalUrl: paypalUrl,
      message: 'PayPal integration coming soon. For now, please use Stripe checkout.'
    });
  } catch (error) {
    console.error('PayPal order error:', error);
    res.status(500).json({ error: 'Failed to create PayPal order' });
  }
});

// Manual payment verification (for testing without webhooks)
// In production, webhooks handle this automatically
app.post('/api/payments/verify-payment', authenticateToken, async (req, res) => {
  try {
    if (!stripe) {
      return res.status(503).json({ error: 'Payment system not configured' });
    }

    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { sessionId } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID required' });
    }

    // Verify the session with Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    
    if (session.payment_status === 'paid' && session.metadata?.userId && session.metadata?.plan) {
      if (!isMongoConnected()) {
        return res.status(503).json({ error: 'Database not available' });
      }
      
      try {
        const user = await User.findById(session.metadata.userId);
        if (user) {
          user.tier = session.metadata.plan;
          user.searchCount = 0;
          user.stripeSubscriptionId = session.subscription;
          user.subscriptionStartedAt = new Date();
          await user.save();
          
          console.log(`✅ User ${user.email} upgraded to ${session.metadata.plan} tier`);
          
          res.json({
            success: true,
            message: 'Payment verified and account upgraded',
            tier: user.tier
          });
        } else {
          res.status(404).json({ error: 'User not found' });
        }
      } catch (error) {
        console.error('Error verifying payment:', error);
        res.status(500).json({ error: 'Failed to verify payment' });
      }
    } else {
      res.status(400).json({ error: 'Payment not completed or invalid session' });
    }
  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(500).json({ error: 'Failed to verify payment' });
  }
});

// Get payment status
app.get('/api/payments/status', authenticateToken, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!isMongoConnected()) {
      return res.status(503).json({ error: 'Database not available' });
    }
    
    const user = await User.findById(req.user.userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Surface pending changes so the UI can show "active until X" (cancel) or
    // "switches to <plan> on X" (scheduled downgrade)
    let cancelAtPeriodEnd = false;
    let currentPeriodEnd = null;
    let currentInterval = null; // 'month' | 'year'
    let pendingPlanTier = null;
    let pendingPlanInterval = null; // 'month' | 'year'
    let pendingPlanDate = null;
    if (user.stripeSubscriptionId && stripe) {
      try {
        const subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
        cancelAtPeriodEnd = !!subscription.cancel_at_period_end;
        const periodEnd = subscription.current_period_end
          || subscription.items?.data?.[0]?.current_period_end;
        currentPeriodEnd = periodEnd ? new Date(periodEnd * 1000).toISOString() : null;
        currentInterval = subscription.items?.data?.[0]?.price?.recurring?.interval || null;

        // A scheduled plan change attaches a subscription schedule whose next phase
        // holds the target price. Find that phase and report what/when it switches.
        // Skip this entirely if the subscription is canceling at period end — the
        // plan is ending and moving to free, so any "switches to X" note is moot.
        if (subscription.schedule && !cancelAtPeriodEnd) {
          const scheduleId = typeof subscription.schedule === 'string'
            ? subscription.schedule
            : subscription.schedule.id;
          const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
          const nowSec = Math.floor(Date.now() / 1000);
          const upcoming = (schedule.phases || []).find((p) => p.start_date > nowSec);
          const nextPriceId = upcoming?.items?.[0]?.price;
          if (nextPriceId) {
            let unitAmount;
            let nextInterval;
            try {
              const price = await stripe.prices.retrieve(nextPriceId);
              unitAmount = price.unit_amount;
              nextInterval = price.recurring?.interval;
            } catch {}
            const tier = planForStripePrice(nextPriceId, unitAmount);
            // Report any genuine change — a different tier OR a different interval
            if (tier && (tier !== user.tier || (nextInterval && nextInterval !== currentInterval))) {
              pendingPlanTier = tier;
              pendingPlanInterval = nextInterval || null;
              pendingPlanDate = new Date(upcoming.start_date * 1000).toISOString();
            }
          }
        }
      } catch (e) {
        console.warn('Could not retrieve subscription for status:', e.message);
      }
    }

    res.json({
      tier: user.tier || 'free',
      subscriptionStatus: user.stripeSubscriptionId ? 'active' : null,
      hasActiveSubscription: !!user.stripeSubscriptionId,
      cancelAtPeriodEnd,
      currentPeriodEnd,
      currentInterval,
      pendingPlanTier,
      pendingPlanInterval,
      pendingPlanDate
    });
  } catch (error) {
    console.error('Payment status error:', error);
    res.status(500).json({ error: 'Failed to get payment status' });
  }
});

// Cancel subscription
// Cancel a pending scheduled plan change (release the subscription schedule)
// without canceling the subscription itself. The user stays on their current plan.
app.post('/api/payments/cancel-pending-change', authenticateToken, async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ error: 'Payment system not configured' });
    const user = await User.findById(req.user.userId);
    if (!user || !user.stripeSubscriptionId) {
      return res.status(404).json({ error: 'No active subscription found' });
    }
    const subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
    const released = await releaseSubscriptionSchedule(subscription);
    if (!released) {
      return res.status(400).json({ error: 'No pending plan change to cancel' });
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('Cancel pending change error:', error);
    return res.status(500).json({ error: error.message || 'Failed to cancel pending change' });
  }
});

app.post('/api/payments/cancel-subscription', authenticateToken, async (req, res) => {
  try {
    if (!stripe) {
      return res.status(503).json({ error: 'Payment system not configured' });
    }

    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!isMongoConnected()) {
      return res.status(503).json({ error: 'Database not available' });
    }
    
    const user = await User.findById(req.user.userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.stripeSubscriptionId) {
      return res.status(400).json({ error: 'No active subscription to cancel' });
    }

    // Cancel at period end: no refund, but the user keeps their tier until the
    // billing period runs out. The customer.subscription.deleted webhook fires
    // at that point and downgrades them to free.
    try {
      // A scheduled downgrade attaches a subscription schedule, which blocks direct
      // cancellation. Release it first (this also drops the pending downgrade) so we
      // can set cancel_at_period_end on the subscription itself.
      const existing = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
      await releaseSubscriptionSchedule(existing);

      const subscription = await stripe.subscriptions.update(user.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });

      const periodEnd = subscription.current_period_end
        || subscription.items?.data?.[0]?.current_period_end
        || null;
      const accessUntil = periodEnd ? new Date(periodEnd * 1000).toISOString() : null;

      console.log(`✅ User ${user.email} subscription set to cancel at period end (${accessUntil || 'unknown date'})`);

      res.json({
        success: true,
        message: 'Subscription will cancel at the end of the billing period',
        tier: user.tier,
        accessUntil,
      });
    } catch (stripeError) {
      console.error('Stripe cancellation error:', stripeError);

      // If Stripe has no record of this subscription (wrong key, test/live
      // mismatch, or a stale/manually-set id), there's nothing to keep them on —
      // treat them as already canceled and reset to free so they aren't stuck.
      if (stripeError?.code === 'resource_missing') {
        user.tier = 'free';
        user.stripeSubscriptionId = null;
        await user.save();
        return res.status(409).json({
          error: 'We could not find this subscription in Stripe, so your account was reset to the free tier. If you were charged, contact support.',
          reset: true,
        });
      }

      res.status(500).json({ error: stripeError?.message || 'Failed to cancel subscription with Stripe' });
    }
  } catch (error) {
    console.error('Cancel subscription error:', error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

// Send welcome email to existing user (admin endpoint)
app.post('/api/admin/send-welcome-email', requireAdminSecret, async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    if (!isMongoConnected()) {
      return res.status(503).json({ error: 'Database not available' });
    }
    
    const user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const remainingSearches = 3 - (user.searchCount || 0);
    await sendWelcomeEmail(user.email, remainingSearches);
    
    res.json({
      success: true,
      message: `Welcome email sent to ${user.email}`
    });
  } catch (error) {
    console.error('Send welcome email error:', error);
    res.status(500).json({ error: 'Failed to send welcome email' });
  }
});

// Delete user by email (admin endpoint)
app.post('/api/admin/delete-user', requireAdminSecret, async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    if (!isMongoConnected()) {
      return res.status(503).json({ error: 'Database not available' });
    }
    
    const user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await User.deleteOne({ email: email.toLowerCase() });
    console.log(`🗑️  User deleted: ${email}`);
    
    res.json({
      success: true,
      message: `User ${email} has been deleted`
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Test Resend email configuration (admin endpoint)
app.post('/api/admin/test-email', requireAdminSecret, async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Check if Resend is configured
    if (!process.env.RESEND_API_KEY) {
      return res.status(400).json({ 
        error: 'RESEND_API_KEY not configured',
        message: 'Set RESEND_API_KEY in Render environment variables',
        help: 'Get your API key from: https://resend.com/api-keys'
      });
    }

    const remainingSearches = 3;
    await sendWelcomeEmail(email, remainingSearches);
    
    res.json({
      success: true,
      message: `Test welcome email sent to ${email}. Check your inbox (and spam folder).`
    });
  } catch (error) {
    console.error('Test email error:', error);
    res.status(500).json({ 
      error: 'Failed to send test email',
      details: error.message 
    });
  }
});

// Connect to MongoDB
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/hum-app';

mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('✅ Connected to MongoDB');
    
    // Start server after MongoDB connection
const PORT = process.env.PORT || 3001;
    app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎵 hüm backend running on port ${PORT}`);
      console.log(`   🌐 Listening on 0.0.0.0 (all interfaces)`);
  console.log(`   ✅ Lyrics search: Scrapingdog → Spotify (field search)`);
  console.log(`   ✅ Humming: ACRCloud + Spotify enrichment`);
      console.log(`   📡 CORS enabled for all origins`);
      console.log(`   💾 Using MongoDB for persistent storage`);
      const feedbackTo = process.env.FEEDBACK_EMAIL_TO || 'hummmteam@gmail.com';
      if (process.env.RESEND_API_KEY) {
        console.log(`   📧 Feedback emails: via Resend → ${feedbackTo}`);
      } else if (process.env.FEEDBACK_EMAIL_USER && process.env.FEEDBACK_EMAIL_PASSWORD) {
        console.log(`   📧 Feedback emails: via Gmail SMTP → ${feedbackTo}`);
      } else {
        console.log(`   ⚠️  Feedback emails: disabled (set RESEND_API_KEY in Render to enable; avoids SMTP timeout)`);
      }
      validateStripePlanPrices().catch(() => {});
    });
  })
  .catch((error) => {
    console.error('❌ MongoDB connection error:', error);
    console.error('   Make sure MONGODB_URI is set in environment variables');
    console.error('   Falling back to file-based storage (users will be lost on restart)');
    
    // Fallback: start server anyway (will use file-based storage)
    const PORT = process.env.PORT || 3001;
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🎵 hüm backend running on port ${PORT} (file-based storage - NOT PERSISTENT)`);
      console.log(`   ⚠️  WARNING: Users will be lost on restart without MongoDB!`);
      if (!process.env.FEEDBACK_EMAIL_USER || !process.env.FEEDBACK_EMAIL_PASSWORD) {
        console.log(`   ⚠️  Feedback emails disabled. Set FEEDBACK_EMAIL_USER + FEEDBACK_EMAIL_PASSWORD in Render.`);
      }
    });
});