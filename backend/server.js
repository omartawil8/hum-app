// backend/server.js - HYBRID VERSION (ACRCloud + Custom Matcher)
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const FormData = require('form-data');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
require('dotenv').config();

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

// Stripe Price IDs for subscriptions (must match UI: $3/month, $30/year for Avid Listener)
// Set in Stripe Dashboard or override via env so checkout and subscription updates charge the correct amount.
const STRIPE_PRICE_AVID_MONTHLY = process.env.STRIPE_PRICE_AVID_MONTHLY || 'price_1Srsq3ImpMKWmAgdgibsqCvl';
const STRIPE_PRICE_AVID_YEARLY  = process.env.STRIPE_PRICE_AVID_YEARLY || 'price_1SrsuZImpMKWmAgdKDuftnOV';
const STRIPE_PRICE_UNLIMITED_MONTHLY = process.env.STRIPE_PRICE_UNLIMITED_MONTHLY || 'price_1Srss2ImpMKWmAgd5XUPpJhc';
const STRIPE_PRICE_UNLIMITED_YEARLY  = process.env.STRIPE_PRICE_UNLIMITED_YEARLY || 'price_1SrsvCImpMKWmAgdpBrILeVj';

// Cached Stripe product + prices for Avid Listener ($3/mo, $30/yr) — used for subscription updates so existing accounts get correct pricing
let _cachedAvidProductId = null;
let _cachedAvidPriceMonthlyId = null;
let _cachedAvidPriceYearlyId = null;

/** Get or create a Stripe Price for Avid Listener with the given amount and interval. Returns price id. */
async function getOrCreateAvidPriceId(interval, unitAmount) {
  if (!stripe) throw new Error('Stripe not configured');
  if (interval === 'month' && _cachedAvidPriceMonthlyId) return _cachedAvidPriceMonthlyId;
  if (interval === 'year' && _cachedAvidPriceYearlyId) return _cachedAvidPriceYearlyId;

  if (!_cachedAvidProductId) {
    const product = await stripe.products.create({
      name: 'Avid Listener',
      description: '100 searches per month',
    });
    _cachedAvidProductId = product.id;
    console.log(`✅ Created Stripe product for Avid Listener: ${_cachedAvidProductId}`);
  }

  const price = await stripe.prices.create({
    product: _cachedAvidProductId,
    currency: 'usd',
    unit_amount: unitAmount,
    recurring: { interval },
  });
  if (interval === 'month') _cachedAvidPriceMonthlyId = price.id;
  else _cachedAvidPriceYearlyId = price.id;
  console.log(`✅ Created Stripe price: $${(unitAmount / 100).toFixed(2)}/${interval} → ${price.id}`);
  return price.id;
}

async function validateStripeAvidPrices() {
  if (!stripe) return;
  try {
    const [monthly, yearly] = await Promise.all([
      stripe.prices.retrieve(STRIPE_PRICE_AVID_MONTHLY),
      stripe.prices.retrieve(STRIPE_PRICE_AVID_YEARLY),
    ]);
    const okMonthly = monthly.unit_amount === 300 && monthly.recurring?.interval === 'month';
    const okYearly = yearly.unit_amount === 3000 && yearly.recurring?.interval === 'year';
    if (!okMonthly) {
      console.warn(`⚠️  Stripe Avid monthly price (${STRIPE_PRICE_AVID_MONTHLY}) is not $3/month (current: ${monthly.unit_amount} cents). Subscription updates now use API-created $3 price.`);
    }
    if (!okYearly) {
      console.warn(`⚠️  Stripe Avid yearly price (${STRIPE_PRICE_AVID_YEARLY}) is not $30/year (current: ${yearly.unit_amount} cents). Subscription updates now use API-created $30 price.`);
    }
  } catch (e) {
    console.warn('⚠️  Could not validate Stripe Avid prices:', e.message);
  }
}

// =========================
// AUTHENTICATION & USER STORAGE
// =========================
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Check if MongoDB is connected
function isMongoConnected() {
  return mongoose.connection.readyState === 1;
}

// Middleware to verify JWT token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    req.user = null;
    return next();
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      req.user = null;
      return next();
    }
    req.user = user;
    next();
  });
}

// Track anonymous searches by IP or device ID
function getAnonymousId(req) {
  // Use IP address as anonymous identifier
  // Try multiple ways to get IP (handles proxies, etc.)
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded 
    ? forwarded.split(',')[0].trim() 
    : req.connection.remoteAddress 
    || req.socket.remoteAddress
    || req.ip
    || 'unknown';
  return ip;
}

// Check search limits
async function checkSearchLimit(req, res, next) {
  const ANONYMOUS_LIMIT = 1; // 1 free search without login
  const FREE_SEARCH_LIMIT = 3; // Total free searches (1 anonymous + 2 authenticated)

  if (!isMongoConnected()) {
    // Fallback: allow request if MongoDB not connected (will fail gracefully)
    console.warn('⚠️  MongoDB not connected - allowing request (may fail)');
    return next();
  }

  if (req.user) {
    // Authenticated user - check their search count (total of 3 free searches)
    try {
      const user = await User.findById(req.user.userId);
      if (user) {
        const searchCount = user.searchCount || 0;
        if (user.tier === 'free' && searchCount >= FREE_SEARCH_LIMIT) {
          return res.status(403).json({
            success: false,
            error: 'Search limit reached',
            message: 'You have reached your free search limit. Please upgrade to continue.',
            requiresUpgrade: true
          });
        }
        // Avid tier: 100 searches per month (we'll implement monthly reset later)
        if (user.tier === 'avid' && searchCount >= 100) {
          return res.status(403).json({
            success: false,
            error: 'Search limit reached',
            message: 'You have reached your monthly search limit. Please upgrade to Avid Listener.',
            requiresUpgrade: true
          });
        }
      }
    } catch (error) {
      console.error('Error checking user search limit:', error);
      return res.status(500).json({ error: 'Failed to check search limit' });
    }
  } else {
    // Anonymous user - check anonymous search count
    try {
      const anonymousId = getAnonymousId(req);
      let anonymousSearch = await AnonymousSearch.findOne({ ipAddress: anonymousId });
      
      if (!anonymousSearch) {
        anonymousSearch = new AnonymousSearch({ ipAddress: anonymousId, searchCount: 0 });
      }
      
      if (anonymousSearch.searchCount >= ANONYMOUS_LIMIT) {
        return res.status(403).json({
          success: false,
          error: 'Login required',
          message: 'You have used your free search. Please create an account or login to continue.',
          requiresLogin: true
        });
      }
    } catch (error) {
      console.error('Error checking anonymous search limit:', error);
      // Allow the request to proceed if database check fails
    }
  }
  next();
}

// Send welcome email function
async function sendWelcomeEmail(email, remainingSearches) {
  try {
    const { Resend } = require('resend');
    
    if (!process.env.RESEND_API_KEY) {
      console.error('   ⚠️  EMAIL NOT CONFIGURED - Welcome email skipped');
      console.error('   📧 Missing: RESEND_API_KEY');
      console.error('   💡 Set this environment variable in your deployment platform (Render)');
      console.error('   📖 Get your API key from: https://resend.com/api-keys');
      return;
    }

    console.log(`   📧 Attempting to send welcome email to: ${email}`);
    console.log(`   📧 Using Resend email service`);

    const resend = new Resend(process.env.RESEND_API_KEY);

    const welcomeHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
              line-height: 1.7;
              color: #1a1a1a;
              max-width: 560px;
              margin: 0 auto;
              padding: 40px 20px;
              background: #f5f5f5;
            }
            .container {
              background: white;
              border-radius: 12px;
              padding: 48px 40px;
              box-shadow: 0 2px 8px rgba(0,0,0,0.08);
            }
            .header {
              margin-bottom: 32px;
            }
            h1 {
              color: #1a1a1a;
              margin: 0 0 8px 0;
              font-size: 28px;
              font-weight: 600;
              letter-spacing: -0.5px;
            }
            .subtitle {
              color: #666;
              font-size: 16px;
              margin: 0;
              font-weight: 400;
            }
            .content {
              margin: 32px 0;
            }
            p {
              color: #333;
              font-size: 16px;
              margin: 0 0 20px 0;
            }
            .highlight-box {
              background: #f8f9fa;
              border-left: 3px solid #667eea;
              padding: 20px;
              border-radius: 6px;
              margin: 28px 0;
            }
            .highlight-box p {
              margin: 0;
              color: #1a1a1a;
              font-size: 15px;
            }
            .cta {
              margin: 32px 0;
              text-align: center;
            }
            .button {
              display: inline-block;
              background: #1a1a1a;
              color: white;
              padding: 14px 28px;
              text-decoration: none;
              border-radius: 8px;
              font-weight: 500;
              font-size: 15px;
            }
            .button:hover {
              background: #333;
            }
            .signature {
              margin-top: 40px;
              padding-top: 32px;
              border-top: 1px solid #e5e5e5;
            }
            .signature p {
              margin: 8px 0;
              color: #666;
              font-size: 15px;
            }
            .signature .name {
              color: #1a1a1a;
              font-weight: 500;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>hey 👋</h1>
              <p class="subtitle">welcome to hüm</p>
            </div>
            
            <div class="content">
              <p>thanks for signing up! we're a small team building something we think is pretty cool.</p>
              
              <p>you've got <strong>${remainingSearches} free searches</strong> to start with. hum a tune, type some lyrics, or just sing whatever's stuck in your head - we'll figure it out.</p>
              
              <div class="highlight-box">
                <p>💡 tip: hum as clearly as you can. we're still improving, but so far we're doing pretty well!</p>
              </div>
              
              <p>if you run into any issues or have ideas, just hit reply. we actually read these emails.</p>
              
              <div class="cta">
                <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}" class="button">start humming →</a>
              </div>
            </div>
            
            <div class="signature">
              <p class="name">omar</p>
              <p>founder, hüm</p>
            </div>
          </div>
        </body>
      </html>
    `;

    // Get the "from" email address - use RESEND_FROM_EMAIL if set, otherwise use a default
    // Resend free tier only allows sending to account owner's email unless domain is verified
    // For production, verify a domain and set RESEND_FROM_EMAIL to use that domain
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
    
    const { data, error } = await resend.emails.send({
      from: `omar from hüm <${fromEmail}>`,
      to: email,
      subject: 'hey, welcome to hüm 👋',
      html: welcomeHtml,
      text: `hey 👋\n\nthanks for signing up! you've got ${remainingSearches} free searches to start with.\n\nhum a tune, type some lyrics, or just sing whatever's stuck in your head - we'll figure it out.\n\nstart at ${process.env.FRONTEND_URL || 'http://localhost:5173'}\n\n- omar, founder`
    });

    if (error) {
      // Check if it's the domain verification error
      if (error.message.includes('You can only send testing emails to your own email address')) {
        throw new Error(`Resend domain not verified. To send emails to ${email}, you need to verify a domain in Resend. See: https://resend.com/domains`);
      }
      throw new Error(`Resend API error: ${error.message}`);
    }

    console.log(`   ✅ Welcome email successfully sent to ${email}`);
    console.log(`   📧 Email ID: ${data?.id || 'N/A'}`);
  } catch (emailError) {
    console.error(`   ❌❌❌ FAILED TO SEND WELCOME EMAIL ❌❌❌`);
    console.error(`   📧 Recipient: ${email}`);
    console.error(`   ❌ Error: ${emailError.message}`);
    
    if (emailError.message.includes('API key') || emailError.message.includes('Unauthorized')) {
      console.error(`   ⚠️  RESEND API KEY INVALID`);
      console.error(`   💡 Check that RESEND_API_KEY is set correctly in Render environment variables`);
      console.error(`   📖 Get your API key from: https://resend.com/api-keys`);
    } else if (emailError.message.includes('domain') || emailError.message.includes('not verified') || emailError.message.includes('You can only send testing emails')) {
      console.error(`   ⚠️  RESEND DOMAIN NOT VERIFIED`);
      console.error(`   📧 Resend free tier only allows sending to your account email (${process.env.RESEND_ACCOUNT_EMAIL || 'the email you signed up with'})`);
      console.error(`   💡 To send to other emails, verify a domain:`);
      console.error(`      1. Go to https://resend.com/domains`);
      console.error(`      2. Add and verify your domain (add DNS records)`);
      console.error(`      3. Set RESEND_FROM_EMAIL in Render to use your verified domain`);
      console.error(`      4. Example: RESEND_FROM_EMAIL=hello@yourdomain.com`);
    } else if (emailError.message.includes('rate limit') || emailError.message.includes('quota')) {
      console.error(`   ⚠️  RATE LIMIT EXCEEDED - Too many emails sent`);
      console.error(`   💡 Resend free tier: 3,000 emails/month`);
    }
    
    // Don't fail the signup if email fails
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
// SPOTIFY INTEGRATION
// =========================
let spotifyToken = null;
let spotifyTokenExpiry = 0;

async function getSpotifyToken() {
  if (spotifyToken && Date.now() < spotifyTokenExpiry) {
    return spotifyToken;
  }

  try {
    const response = await axios.post(
      'https://accounts.spotify.com/api/token',
      'grant_type=client_credentials',
      {
        headers: {
          'Authorization': 'Basic ' + Buffer.from(
            process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET
          ).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    spotifyToken = response.data.access_token;
    spotifyTokenExpiry = Date.now() + (response.data.expires_in * 1000) - 60000;
    
    return spotifyToken;
  } catch (error) {
    console.error('❌ Spotify token error:', error.message);
    return null;
  }
}

async function getSpotifyTrack(isrc) {
  // Per-process in-memory cache to avoid duplicate lookups across a single request burst
  if (!global.__humSpotifyIsrcCache) {
    global.__humSpotifyIsrcCache = new Map();
  }

  if (!isrc) return null;

  if (global.__humSpotifyIsrcCache.has(isrc)) {
    return global.__humSpotifyIsrcCache.get(isrc);
  }

  try {
    const token = await getSpotifyToken();
    if (!token) return null;

    const response = await axios.get(
      `https://api.spotify.com/v1/search?q=isrc:${isrc}&type=track&limit=1`,
      {
        headers: { 'Authorization': `Bearer ${token}` }
      }
    );

    if (response.data.tracks.items.length > 0) {
      const track = response.data.tracks.items[0];
      const result = {
        id: track.id,
        title: track.name,
        artist: track.artists[0].name,
        artistId: track.artists[0].id,
        album: track.album.name,
        popularity: track.popularity,
        preview_url: track.preview_url,
        external_url: track.external_urls.spotify,
        album_art: track.album.images[0]?.url
      };
      
      global.__humSpotifyIsrcCache.set(isrc, result);
      return result;
    }
    
    return null;
  } catch (error) {
    console.error('❌ Spotify search error:', error.message);
    return null;
  }
}

async function getSpotifyTrackByName(title, artist) {
  if (!global.__humSpotifyNameCache) {
    global.__humSpotifyNameCache = new Map();
  }

  try {
    const token = await getSpotifyToken();
    if (!token) return null;

    const cleanTitle = (title || '').replace(/[()[\]]/g, '').trim();
    const cleanArtist = (artist || '').replace(/[()[\]]/g, '').trim();

    if (!cleanTitle || !cleanArtist) return null;

    const cacheKey = `${cleanTitle.toLowerCase()}|${cleanArtist.toLowerCase()}`;
    if (global.__humSpotifyNameCache.has(cacheKey)) {
      return global.__humSpotifyNameCache.get(cacheKey);
    }
    
    const query = `track:${cleanTitle} artist:${cleanArtist}`;
    
    const response = await axios.get(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=1`,
      {
        headers: { 'Authorization': `Bearer ${token}` }
      }
    );

    if (response.data.tracks.items.length > 0) {
      const track = response.data.tracks.items[0];
      const result = {
        id: track.id,
        title: track.name,
        artist: track.artists[0].name,
        artistId: track.artists[0].id,
        album: track.album.name,
        popularity: track.popularity,
        preview_url: track.preview_url,
        external_url: track.external_urls.spotify,
        album_art: track.album.images[0]?.url
      };
      
      global.__humSpotifyNameCache.set(cacheKey, result);
      return result;
    }
    
    return null;
  } catch (error) {
    console.error('❌ Spotify search by name error:', error.message);
    return null;
  }
}

async function getSpotifyArtistInfo(artistId) {
  try {
    const token = await getSpotifyToken();
    if (!token) return null;

    const response = await axios.get(
      `https://api.spotify.com/v1/artists/${artistId}`,
      {
        headers: { 'Authorization': `Bearer ${token}` }
      }
    );

    if (response.data) {
      return {
        genres: response.data.genres || [],
        // Spotify doesn't have explicit "origin country", but we can infer from genres
      };
    }
    
    return null;
  } catch (error) {
    console.error('❌ Spotify artist info error:', error.message);
    return null;
  }
}

// NEW: Find the most popular version of a song on Spotify (catches unlabeled covers!)
async function findMostPopularVersion(songTitle) {
  if (!global.__humSpotifyCanonicalCache) {
    global.__humSpotifyCanonicalCache = new Map();
  }

  try {
    const token = await getSpotifyToken();
    if (!token) return null;

    // Clean the title - remove everything in parentheses/brackets
    const cleanTitle = (songTitle || '')
      .replace(/\s*[\(\[].*?[\)\]]\s*/g, '')
      .replace(/\s*-\s*(remix|mix|edit|acoustic|live|remaster).*$/i, '')
      .trim();

    if (!cleanTitle) return null;

    const cacheKey = cleanTitle.toLowerCase();
    if (global.__humSpotifyCanonicalCache.has(cacheKey)) {
      return global.__humSpotifyCanonicalCache.get(cacheKey);
    }
    
    console.log(`\n🔍 Searching Spotify for most popular version of: "${cleanTitle}"`);
    
    const response = await axios.get(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(cleanTitle)}&type=track&limit=20`,
      {
        headers: { 'Authorization': `Bearer ${token}` }
      }
    );

    if (response.data.tracks.items.length > 0) {
      const tracks = response.data.tracks.items;
      
      // Filter out variations
      const variationKeywords = [
        'remix', 'mix)', 'edit', 'acoustic', 'live', 'live at', 
        'remaster', 'remastered', 'radio edit', 'extended', 'club',
        'instrumental', 'karaoke', 'cover', 'tribute', 'version',
        'sped up', 'slowed', 'reverb', 'nightcore'
      ];
      
      const originalTracks = tracks.filter(track => {
        const trackTitle = track.name.toLowerCase();
        const titleMatch = trackTitle.includes(cleanTitle.toLowerCase()) || 
                          cleanTitle.toLowerCase().includes(trackTitle.slice(0, Math.max(1, trackTitle.length - 5)));
        if (!titleMatch) return false;
        
        const isVariation = variationKeywords.some(keyword => trackTitle.includes(keyword));
        return !isVariation;
      });
      
      if (originalTracks.length === 0) {
        console.log(`   ⚠️  No clear original found, using most popular overall`);
        const mostPopular = tracks[0];
        const fallback = {
          title: mostPopular.name,
          artist: mostPopular.artists[0].name,
          popularity: mostPopular.popularity,
          album: mostPopular.album.name,
          spotify: {
            id: mostPopular.id,
            title: mostPopular.name,
            artist: mostPopular.artists[0].name,
            album: mostPopular.album.name,
            popularity: mostPopular.popularity,
            preview_url: mostPopular.preview_url,
            external_url: mostPopular.external_urls.spotify,
            album_art: mostPopular.album.images[0]?.url
          },
          isrc: mostPopular.external_ids?.isrc
        };
        global.__humSpotifyCanonicalCache.set(cacheKey, fallback);
        return fallback;
      }
      
      // Sort by popularity
      originalTracks.sort((a, b) => b.popularity - a.popularity);
      const mostPopular = originalTracks[0];
      
      console.log(`   ✅ Most popular: "${mostPopular.name}" by ${mostPopular.artists[0].name} (${mostPopular.popularity}/100)`);
      
      const result = {
        title: mostPopular.name,
        artist: mostPopular.artists[0].name,
        popularity: mostPopular.popularity,
        album: mostPopular.album.name,
        spotify: {
          id: mostPopular.id,
          title: mostPopular.name,
          artist: mostPopular.artists[0].name,
          album: mostPopular.album.name,
          popularity: mostPopular.popularity,
          preview_url: mostPopular.preview_url,
          external_url: mostPopular.external_urls.spotify,
          album_art: mostPopular.album.images[0]?.url
        },
        isrc: mostPopular.external_ids?.isrc
      };

      global.__humSpotifyCanonicalCache.set(cacheKey, result);
      return result;
    }
    
    return null;
  } catch (error) {
    console.error('❌ Error finding most popular version:', error.message);
    return null;
  }
}

// =========================
// GENERIC TITLE DETECTION
// =========================
function isGenericTitle(title) {
  const genericTitles = [
    'happy birthday',
    'twinkle twinkle little star',
    'twinkle twinkle',
    'old macdonald',
    'mary had a little lamb',
    'abc song',
    'row row row your boat',
    'the wheels on the bus',
    'itsy bitsy spider',
    'baa baa black sheep',
    'london bridge',
    'ring around the rosie',
    'humpty dumpty',
    'head shoulders knees and toes',
    'if you\'re happy and you know it',
  ];
  
  const cleanTitle = title.toLowerCase().trim();
  return genericTitles.some(generic => cleanTitle.includes(generic));
}

// =========================
// TITLE SIMILARITY HELPERS
// =========================

// 🔧 FIX: NEW function to clean titles before comparison
function cleanTitleForComparison(title) {
  if (!title || typeof title !== 'string') {
    return '';
  }
  
  let cleaned = title
    // Remove everything in parentheses and brackets
    .replace(/\s*[\(\[].*?[\)\]]\s*/g, '')
    // Remove common variation indicators at the end
    .replace(/\s*-\s*(remix|mix|edit|acoustic|live|remaster|demo|version|made popular by|backing|karaoke|instrumental|tribute|cover).*$/i, '')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  
  // Safety: If cleaning removed everything, return original (lowercased)
  if (cleaned.length === 0) {
    return title.toLowerCase().trim();
  }
  
  return cleaned;
}

function levenshtein(a, b) {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

function calculateSimilarity(str1, str2) {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  
  // Exact match
  if (s1 === s2) return 1.0;
  
  // One contains the other completely
  if (s1.includes(s2) || s2.includes(s1)) {
    const longer = Math.max(s1.length, s2.length);
    const shorter = Math.min(s1.length, s2.length);
    return shorter / longer;
  }
  
  // Calculate Levenshtein-based similarity
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  
  if (longer.length === 0) return 1.0;
  
  const editDistance = levenshtein(s1, s2);
  return (longer.length - editDistance) / longer.length;
}


// =========================
// SMART RANKING LOGIC
// =========================
function rankACRResults(acrMatches) {
  return acrMatches.map(match => {
    let score = match.score || 0;
    
    const title = (match.title || '').toLowerCase();
    const artist = (match.artists?.[0]?.name || '').toLowerCase();
    const label = (match.label || '').toLowerCase();
    const combined = title + ' ' + artist + ' ' + label;
    
    const hasAsianChars = /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf\uac00-\ud7a3]/.test(combined);
    const hasArabicChars = /[\u0600-\u06ff]/.test(combined);
    const hasCyrillicChars = /[\u0400-\u04ff]/.test(combined);
    
    const nonEnglishIndicators = [
      'feat.', 'feat', 'с участием', 'con', 'avec', 'mit',
      'version', 'versión', 'versione'
    ];
    
    if (hasAsianChars || hasArabicChars || hasCyrillicChars) {
      score -= 0.55; // Slightly stronger penalty for clearly non-English matches
    } else {
      // Small positive bias for titles that look purely English
      score += 0.05;
    }
    
    const hasNonEnglishIndicator = nonEnglishIndicators.some(indicator => 
      combined.includes(indicator.toLowerCase())
    );
    
    if (hasNonEnglishIndicator) {
      score -= 0.15;
    }
    
    if (title.includes('cover') || title.includes('tribute') ||
        artist.includes('cover') || artist.includes('tribute')) {
      score -= 0.25;
    }
    
    if (title.includes('instrumental') || title.includes('karaoke') ||
        artist.includes('instrumental') || artist.includes('karaoke')) {
      score -= 0.30;
    }
    
    if (title.includes('live') || title.includes('live at')) {
      score -= 0.20;
    }
    
    if (title.includes('acoustic') || title.includes('remix')) {
      score -= 0.15;
    }
    
    const majorLabels = [
      'universal', 'sony', 'warner', 'columbia', 'atlantic', 
      'capitol', 'republic', 'interscope', 'rca', 'epic'
    ];
    
    if (majorLabels.some(major => label.includes(major))) {
      score += 0.10;
    }
    
    if (label.includes('karaoke') || label.includes('tribute') ||
        label.includes('sound alike') || label.includes('backing')) {
      score -= 0.30;
    }
    
    return {
      ...match,
      adjustedScore: Math.max(0, Math.min(1, score)),
      hasNonEnglishChars: hasAsianChars || hasArabicChars || hasCyrillicChars
    };
  });
}

function combineWithSpotify(rankedMatches) {
  // Find max popularity to normalize boosts
  const maxPopularity = Math.max(...rankedMatches
    .filter(m => m.spotify?.popularity)
    .map(m => m.spotify.popularity), 0);
  
  // Calculate title clusters (consensus boost)
  // If multiple results have similar titles, it's a strong signal
  const titleClusters = new Map();
  
  rankedMatches.forEach((match, index) => {
    const cleanedTitle = cleanTitleForComparison(match.title);
    let foundCluster = false;
    
    // Check if this title belongs to an existing cluster
    for (const [clusterKey, clusterData] of titleClusters.entries()) {
      const similarity = calculateSimilarity(cleanedTitle, clusterKey);
      if (similarity >= 0.75) { // 75% similarity threshold
        clusterData.count++;
        clusterData.matches.push(index);
        foundCluster = true;
        break;
      }
    }
    
    // Create new cluster if no match found
    if (!foundCluster) {
      titleClusters.set(cleanedTitle, {
        count: 1,
        matches: [index],
        key: cleanedTitle
      });
    }
  });
  
  // Log clusters
  console.log('\n🔗 Title clusters (consensus detection):');
  for (const [key, cluster] of titleClusters.entries()) {
    if (cluster.count > 1) {
      console.log(`   "${key}": ${cluster.count} similar matches`);
    }
  }
  
  return rankedMatches.map((match, index) => {
    let finalScore = match.adjustedScore;
    
    // Language penalty (apply again in final scoring for extra weight)
    const title = (match.title || '').toLowerCase();
    const artist = (match.artists?.[0]?.name || '').toLowerCase();
    const combined = title + ' ' + artist;
    
    const hasCyrillicChars = /[\u0400-\u04ff]/.test(combined);
    const hasAsianChars = /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf\uac00-\ud7a3]/.test(combined);
    const hasArabicChars = /[\u0600-\u06ff]/.test(combined);
    
    // Additional language weighting in final scoring
    if (hasCyrillicChars || hasAsianChars || hasArabicChars) {
      const languagePenalty = -0.30; // Slightly stronger final penalty for non-English
      finalScore += languagePenalty;
      console.log(`   🌍 Language penalty for "${match.title}": ${languagePenalty.toFixed(2)} (non-English)`);
    } else if (combined.trim().length > 0) {
      // Small bonus for clearly English-looking titles/artists
      const languageBonus = 0.05;
      finalScore += languageBonus;
      console.log(`   🇬🇧 Language bonus for "${match.title}": +${languageBonus.toFixed(2)} (English bias)`);
    }
    
    // Spotify popularity boost
    if (match.spotify && match.spotify.popularity) {
      // Non-linear boost: higher popularity gets exponentially more weight
      // Formula: (popularity/100)^1.5 * 0.80
      // This gives 84/100 → +0.61, 37/100 → +0.18 (bigger gap)
      const normalizedPop = match.spotify.popularity / 100;
      const popularityBoost = Math.pow(normalizedPop, 1.5) * 0.80;
      finalScore += popularityBoost;
      
      console.log(`   📈 Spotify boost for "${match.title}": +${popularityBoost.toFixed(2)} (popularity: ${match.spotify.popularity}/100)`);
    }
    
    // Consensus boost: if multiple results have similar titles, boost them
    const cleanedTitle = cleanTitleForComparison(match.title);
    for (const [clusterKey, clusterData] of titleClusters.entries()) {
      if (clusterData.matches.includes(index) && clusterData.count > 1) {
        // More matches = stronger signal
        // Formula: (clusterSize - 1) * 0.10, capped at 0.30
        const consensusBoost = Math.min((clusterData.count - 1) * 0.10, 0.30);
        finalScore += consensusBoost;
        console.log(`   🎯 Consensus boost for "${match.title}": +${consensusBoost.toFixed(2)} (${clusterData.count} similar matches)`);
        break;
      }
    }
    
    return {
      ...match,
      finalScore: Math.max(0, Math.min(1, finalScore)) // Ensure score stays in valid range
    };
  });
}

// =========================
// ACRCLOUD IDENTIFICATION
// =========================
async function identifyAudio(audioBuffer) {
  // Check if ACR Cloud credentials are configured
  if (!process.env.ACR_ACCESS_KEY || !process.env.ACR_ACCESS_SECRET || !process.env.ACR_HOST) {
    console.error('❌ ACR Cloud credentials not configured!');
    throw new Error('ACR Cloud API credentials are missing. Please check environment variables.');
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const stringToSign = `POST\n/v1/identify\n${process.env.ACR_ACCESS_KEY}\naudio\n1\n${timestamp}`;
  
  const signature = crypto
    .createHmac('sha1', process.env.ACR_ACCESS_SECRET)
    .update(Buffer.from(stringToSign, 'utf-8'))
    .digest()
    .toString('base64');

  const formData = new FormData();
  formData.append('sample', audioBuffer, {
    filename: 'audio.webm',
    contentType: 'audio/webm'
  });
  formData.append('access_key', process.env.ACR_ACCESS_KEY);
  formData.append('sample_bytes', audioBuffer.length);
  formData.append('timestamp', timestamp);
  formData.append('signature', signature);
  formData.append('data_type', 'audio');
  formData.append('signature_version', '1');

  console.log('   📡 Calling ACR Cloud API...');
  console.log('   🔑 Access Key:', process.env.ACR_ACCESS_KEY ? 'Set' : 'MISSING');
  console.log('   🔑 Access Secret:', process.env.ACR_ACCESS_SECRET ? 'Set' : 'MISSING');
  console.log('   🌐 Host:', process.env.ACR_HOST || 'MISSING');

  try {
  const response = await axios.post(
    `https://${process.env.ACR_HOST}/v1/identify`,
    formData,
      { 
        headers: formData.getHeaders(),
        timeout: 30000 // 30 second timeout
      }
  );

    console.log('   ✅ ACR Cloud API responded');
  return response.data;
  } catch (error) {
    console.error('   ❌ ACR Cloud API error:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', error.response.data);
    }
    throw error;
  }
}

// =========================
// SAVE TRAINING DATA
// =========================
function saveTrainingData(audioBuffer, acrResult) {
  const timestamp = Date.now();
  const filename = `humming_${timestamp}.webm`;
  
  const resultData = {
    timestamp,
    filename,
    acr_success: acrResult.status?.code === 0,
    acr_result: acrResult.status?.code === 0 ? {
      song: acrResult.metadata?.music?.[0] || acrResult.metadata?.humming?.[0]
    } : null
  };
  
  const resultsPath = path.join(__dirname, 'training-data', 'results.json');
  let allResults = [];
  
  if (fs.existsSync(resultsPath)) {
    const fileContent = fs.readFileSync(resultsPath, 'utf8');
    allResults = JSON.parse(fileContent);
  }
  
  allResults.push(resultData);
  fs.writeFileSync(resultsPath, JSON.stringify(allResults, null, 2));
  
  console.log(`💾 Saved results (no audio file)`);
}

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
    
    const scrapingdogResponse = await axios.get('https://api.scrapingdog.com/google', {
      params: {
        api_key: '693680181b73bc56d9ed3b5b',
        query: `${lyrics} lyrics`,  // No quotes = more flexible matching
        results: '10',
        country: 'us',
        page: '0'
      },
      timeout: 8000
    });
    
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
      
      console.log(`\n🎵 Fetching Spotify data for ALL ${rankedMatches.length} matches...`);
      
      // Process ALL matches, not just top 5
      const spotifyPromises = rankedMatches.map(async (match) => {
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
    fs.writeFileSync(filepath, req.file.buffer);
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
    // FEEDBACK_EMAIL_TO defaults to hummmteam@gmail.com. Until you verify a domain in Resend, set it to
    // your Resend account email (e.g. omar.tawil10@gmail.com) so Resend allows sending.
    const sendFeedbackEmail = async () => {
      const html = `
        <h2>New Feedback from hüm App</h2>
        <p><strong>From:</strong> ${fromEmail}</p>
        <p><strong>Feedback:</strong></p>
        <p>${feedback}</p>
        <hr>
        <p><strong>Song Context:</strong> ${songTitle} - ${songArtist}</p>
        <p><strong>Timestamp:</strong> ${new Date(timestamp).toLocaleString()}</p>
      `;
      const subject = `hüm App Feedback - ${new Date().toLocaleDateString()}`;
      const to = process.env.FEEDBACK_EMAIL_TO || 'hummmteam@gmail.com';

      if (process.env.RESEND_API_KEY) {
        try {
          const { Resend } = require('resend');
          const resend = new Resend(process.env.RESEND_API_KEY);
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
  if (process.env.RESEND_API_KEY) {
    try {
      const { Resend } = require('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);
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

    const { plan, billingPeriod = 'monthly' } = req.body; // 'avid', 'monthly' or 'yearly'
    
    if (!plan || plan !== 'avid') {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    if (billingPeriod && !['monthly', 'yearly'].includes(billingPeriod)) {
      return res.status(400).json({ error: 'Invalid billing period' });
    }

    const planDetails = {
      avid: {
        name: 'Avid Listener',
        monthlyPrice: 300, // $3.00 in cents
        yearlyPrice: 3000, // $30.00 in cents
        description: '100 searches per month'
      }
    };

    const selectedPlan = planDetails[plan];
    const interval = billingPeriod === 'yearly' ? 'year' : 'month';
    
    if (!isMongoConnected()) {
      return res.status(503).json({ error: 'Database not available' });
    }
    
    const user = await User.findById(req.user.userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (plan !== 'avid') {
      return res.status(400).json({ error: 'Pricing configuration not found for this plan' });
    }

    // If user already has an active Stripe subscription, update it to the correct $3/$30 price (same as UI)
    if (user.stripeSubscriptionId) {
      console.log(`🔄 Updating existing subscription for user ${user.email} to plan ${plan} (${billingPeriod}) — using $3/$30 pricing`);

      const subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
      if (!subscription || !subscription.items || !subscription.items.data.length) {
        return res.status(400).json({ error: 'Existing subscription not found or has no items' });
      }

      const currentItem = subscription.items.data[0];
      const currentInterval = currentItem.price?.recurring?.interval; // 'month' or 'year'

      if (!currentInterval) {
        return res.status(400).json({ error: 'Current subscription has no interval information' });
      }

      // Prevent monthly ↔ yearly switches unless we explicitly support them
      if ((currentInterval === 'month' && billingPeriod === 'yearly') ||
          (currentInterval === 'year' && billingPeriod === 'monthly')) {
        return res.status(400).json({ error: 'Switching between monthly and yearly plans is not supported yet.' });
      }

      // Use get-or-create price so existing accounts get $3/month or $30/year, not Dashboard prices
      const unitAmount = billingPeriod === 'yearly' ? selectedPlan.yearlyPrice : selectedPlan.monthlyPrice;
      const targetPriceId = await getOrCreateAvidPriceId(interval, unitAmount);

      const updated = await stripe.subscriptions.update(user.stripeSubscriptionId, {
        cancel_at_period_end: false,
        proration_behavior: 'create_prorations',
        items: [{
          id: currentItem.id,
          price: targetPriceId,
        }],
      });

      // Optionally, you could immediately invoice the prorated amount here.
      // For now, we let Stripe include it on the next invoice.

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
      });
    }

    // No existing subscription: create checkout with price_data so amount always matches UI ($3/month, $30/year)
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
              metadata: { plan: 'avid', amount_cents: String(unitAmount) },
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
          let plan = user.tier;
          // Avid = $3/mo (300) or $30/yr (3000), including API-created prices
          const amount = priceObj.unit_amount;
          const isAvidPrice = priceId === STRIPE_PRICE_AVID_MONTHLY || priceId === STRIPE_PRICE_AVID_YEARLY ||
            priceId === _cachedAvidPriceMonthlyId || priceId === _cachedAvidPriceYearlyId ||
            amount === 300 || amount === 3000;
          if (isAvidPrice) plan = 'avid';
          user.tier = plan;
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
    
    if (!plan || plan !== 'avid') {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    const planDetails = {
      avid: {
        name: 'Avid Listener',
        price: '3.00',
        description: '100 searches per month'
      }
    };

    const selectedPlan = planDetails[plan];
    
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

    res.json({
      tier: user.tier || 'free',
      subscriptionStatus: user.stripeSubscriptionId ? 'active' : null,
      hasActiveSubscription: !!user.stripeSubscriptionId
    });
  } catch (error) {
    console.error('Payment status error:', error);
    res.status(500).json({ error: 'Failed to get payment status' });
  }
});

// Cancel subscription
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

    // Cancel the subscription in Stripe
    try {
      await stripe.subscriptions.cancel(user.stripeSubscriptionId);
      
      // Update user in database
      user.tier = 'free';
      user.stripeSubscriptionId = null;
      await user.save();
      
      console.log(`✅ User ${user.email} subscription canceled`);
      
      res.json({
        success: true,
        message: 'Subscription canceled successfully',
        tier: 'free'
      });
    } catch (stripeError) {
      console.error('Stripe cancellation error:', stripeError);
      res.status(500).json({ error: 'Failed to cancel subscription with Stripe' });
    }
  } catch (error) {
    console.error('Cancel subscription error:', error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

// Send welcome email to existing user (admin endpoint)
app.post('/api/admin/send-welcome-email', async (req, res) => {
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
app.post('/api/admin/delete-user', async (req, res) => {
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
app.post('/api/admin/test-email', async (req, res) => {
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
      validateStripeAvidPrices().catch(() => {});
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