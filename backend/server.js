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
require('dotenv').config();

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

// =========================
// AUTHENTICATION & USER STORAGE
// =========================
const USERS_FILE = path.join(__dirname, 'users.json');
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Initialize users file if it doesn't exist
if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, JSON.stringify({ users: [], anonymousSearches: {} }, null, 2));
}

function getUsersData() {
  try {
    const data = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return { users: [], anonymousSearches: {} };
  }
}

function saveUsersData(data) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
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
function checkSearchLimit(req, res, next) {
  const data = getUsersData();
  const ANONYMOUS_LIMIT = 1; // 1 free search without login
  const FREE_SEARCH_LIMIT = 5; // Total free searches (1 anonymous + 4 authenticated)

  if (req.user) {
    // Authenticated user - check their search count (total of 5 free searches)
    const user = data.users.find(u => u.id === req.user.userId);
    if (user) {
      const searchCount = user.searchCount || 0;
      if (searchCount >= FREE_SEARCH_LIMIT) {
        return res.status(403).json({
          success: false,
          error: 'Search limit reached',
          message: 'You have reached your free search limit. Please upgrade to continue.',
          requiresUpgrade: true
        });
      }
    }
  } else {
    // Anonymous user - check anonymous search count
    const anonymousId = getAnonymousId(req);
    const anonymousCount = data.anonymousSearches[anonymousId] || 0;
    if (anonymousCount >= ANONYMOUS_LIMIT) {
      return res.status(403).json({
        success: false,
        error: 'Login required',
        message: 'You have used your free search. Please create an account or login to continue.',
        requiresLogin: true
      });
    }
  }
  next();
}

// Send welcome email function
async function sendWelcomeEmail(email, remainingSearches) {
  try {
    const nodemailer = require('nodemailer');
    
    if (!process.env.FEEDBACK_EMAIL_USER || !process.env.FEEDBACK_EMAIL_PASSWORD) {
      console.log('   ⚠️  Email not configured - skipping welcome email');
      return;
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.FEEDBACK_EMAIL_USER,
        pass: process.env.FEEDBACK_EMAIL_PASSWORD
      }
    });

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
                <p>💡 tip: the clearer you hum, the better the results. but honestly, even our messy hums work pretty well.</p>
              </div>
              
              <p>if you run into any issues or have ideas, just hit reply. we actually read these emails.</p>
              
              <div class="cta">
                <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}" class="button">start humming →</a>
              </div>
            </div>
            
            <div class="signature">
              <p class="name">omar</p>
              <p>co-founder, hüm</p>
            </div>
          </div>
        </body>
      </html>
    `;

    const mailOptions = {
      from: `"omar from hüm" <${process.env.FEEDBACK_EMAIL_USER}>`,
      to: email,
      subject: 'hey, welcome to hüm 👋',
      html: welcomeHtml,
      text: `hey 👋\n\nthanks for signing up! you've got ${remainingSearches} free searches to start with.\n\nhum a tune, type some lyrics, or just sing whatever's stuck in your head - we'll figure it out.\n\nstart at http://localhost:5173\n\n- omar, co-founder`
    };

    await transporter.sendMail(mailOptions);
    console.log(`   ✅ Welcome email sent to ${email}`);
  } catch (emailError) {
    console.log(`   ⚠️  Failed to send welcome email: ${emailError.message}`);
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

    const data = getUsersData();
    
    // Check if user already exists
    if (data.users.find(u => u.email === email.toLowerCase())) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // If user used an anonymous search, set searchCount to 1 (so they have 4/5 left)
    // Otherwise, set to 0 (so they have 5/5 left)
    const initialSearchCount = usedAnonymousSearch ? 1 : 0;
    const remainingSearches = 5 - initialSearchCount;

    // Create new user - always start on free tier
    const newUser = {
      id: crypto.randomUUID(),
      email: email.toLowerCase(),
      password: hashedPassword,
      searchCount: initialSearchCount,
      tier: 'free', // Always start on free tier
      createdAt: new Date().toISOString()
    };

    data.users.push(newUser);
    saveUsersData(data);

    // Generate JWT token
    const token = jwt.sign(
      { userId: newUser.id, email: newUser.email },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    // Send welcome email (don't wait for it)
    sendWelcomeEmail(newUser.email, remainingSearches).catch(err => {
      console.error('Welcome email error:', err);
    });

    res.json({
      success: true,
      token,
      user: {
        id: newUser.id,
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

    const data = getUsersData();
    const user = data.users.find(u => u.email === email.toLowerCase());

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        searchCount: user.searchCount || 0,
        tier: user.tier || 'free' // Default to free if not set
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Failed to login' });
  }
});

// Check auth status endpoint
app.get('/api/auth/me', authenticateToken, (req, res) => {
  if (!req.user) {
    return res.json({ authenticated: false });
  }

  const data = getUsersData();
  const user = data.users.find(u => u.id === req.user.userId);

  if (!user) {
    return res.json({ authenticated: false });
  }

  res.json({
    authenticated: true,
    user: {
      id: user.id,
      email: user.email,
      searchCount: user.searchCount || 0,
      tier: user.tier || 'free' // Default to free if not set
    }
  });
});

// Check anonymous search status endpoint
app.get('/api/auth/anonymous-status', (req, res) => {
  const data = getUsersData();
  const anonymousId = getAnonymousId(req);
  const anonymousCount = data.anonymousSearches[anonymousId] || 0;
  const ANONYMOUS_LIMIT = 1;
  
  res.json({
    hasAnonymousSearch: anonymousCount < ANONYMOUS_LIMIT,
    anonymousCount: anonymousCount
  });
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
      return {
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
    }
    
    return null;
  } catch (error) {
    console.error('❌ Spotify search error:', error.message);
    return null;
  }
}

async function getSpotifyTrackByName(title, artist) {
  try {
    const token = await getSpotifyToken();
    if (!token) return null;

    const cleanTitle = title.replace(/[()[\]]/g, '').trim();
    const cleanArtist = artist.replace(/[()[\]]/g, '').trim();
    
    const query = `track:${cleanTitle} artist:${cleanArtist}`;
    
    const response = await axios.get(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=1`,
      {
        headers: { 'Authorization': `Bearer ${token}` }
      }
    );

    if (response.data.tracks.items.length > 0) {
      const track = response.data.tracks.items[0];
      return {
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
  try {
    const token = await getSpotifyToken();
    if (!token) return null;

    // Clean the title - remove everything in parentheses/brackets
    const cleanTitle = songTitle
      .replace(/\s*[\(\[].*?[\)\]]\s*/g, '')
      .replace(/\s*-\s*(remix|mix|edit|acoustic|live|remaster).*$/i, '')
      .trim();
    
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
        return {
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
      }
      
      // Sort by popularity
      originalTracks.sort((a, b) => b.popularity - a.popularity);
      const mostPopular = originalTracks[0];
      
      console.log(`   ✅ Most popular: "${mostPopular.name}" by ${mostPopular.artists[0].name} (${mostPopular.popularity}/100)`);
      
      return {
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
      score -= 0.40;
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
  return rankedMatches.map(match => {
    let finalScore = match.adjustedScore;
    
    if (match.spotify && match.spotify.popularity) {
      const popularityBoost = (match.spotify.popularity / 100) * 0.50;
      finalScore += popularityBoost;
      
      console.log(`   📈 Spotify boost for "${match.title}": +${popularityBoost.toFixed(2)} (popularity: ${match.spotify.popularity}/100)`);
    }
    
    return {
      ...match,
      finalScore: Math.min(1, finalScore)
    };
  });
}

// =========================
// ACRCLOUD IDENTIFICATION
// =========================
async function identifyAudio(audioBuffer) {
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

  const response = await axios.post(
    `https://${process.env.ACR_HOST}/v1/identify`,
    formData,
    { headers: formData.getHeaders() }
  );

  return response.data;
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
    const data = getUsersData();
    if (req.user) {
      const user = data.users.find(u => u.id === req.user.userId);
      if (user) {
        user.searchCount = (user.searchCount || 0) + 1;
        saveUsersData(data);
      }
    } else {
      const anonymousId = getAnonymousId(req);
      data.anonymousSearches[anonymousId] = (data.anonymousSearches[anonymousId] || 0) + 1;
      saveUsersData(data);
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
    
    const acrResult = await identifyAudio(req.file.buffer);
    
    console.log('📊 ACRCloud status:', acrResult.status?.code === 0 ? 'SUCCESS' : 'NO MATCH');
    
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
      
      const matchesWithSpotify = await Promise.all(spotifyPromises);
      
      matchesWithSpotify.forEach((match, i) => {
        if (match.spotify) {
          console.log(`  ✅ #${i + 1}: "${match.title}" - Spotify popularity: ${match.spotify.popularity}/100`);
        } else {
          console.log(`  ❌ #${i + 1}: "${match.title}" - No Spotify data`);
        }
      });
      
      console.log('\n📈 Applying Spotify popularity boosts...');
      let finalMatches = combineWithSpotify(matchesWithSpotify);
      
      finalMatches.sort((a, b) => b.finalScore - a.finalScore);
      
      console.log('\n🏆 FINAL RANKING (after Spotify boost):');
      finalMatches.slice(0, 3).forEach((match, i) => {
        const spotifyInfo = match.spotify ? ` | Spotify: ${match.spotify.popularity}/100` : ' | No Spotify data';
        console.log(`  ${i + 1}. "${match.title}" - ${match.artists?.[0]?.name}`);
        console.log(`     Final Score: ${match.finalScore.toFixed(2)}${spotifyInfo}`);
      });
      
      // NEW: Check if the winner might be a cover - search for most popular version
      const winner = finalMatches[0];
      
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
      const data = getUsersData();
      if (req.user) {
        const user = data.users.find(u => u.id === req.user.userId);
        if (user) {
          user.searchCount = (user.searchCount || 0) + 1;
          saveUsersData(data);
        }
      } else {
        const anonymousId = getAnonymousId(req);
        data.anonymousSearches[anonymousId] = (data.anonymousSearches[anonymousId] || 0) + 1;
        saveUsersData(data);
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
// GENERAL FEEDBACK ENDPOINT
// =========================
app.post('/api/general-feedback', async (req, res) => {
  try {
    const { feedback, songTitle, songArtist, timestamp } = req.body;
    
    if (!feedback || feedback.length > 500) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid feedback' 
      });
    }

    console.log(`📝 General feedback received:`);
    console.log(`   Feedback: ${feedback}`);
    console.log(`   Song: ${songTitle} - ${songArtist}`);
    console.log(`   Time: ${timestamp}`);

    // Try to send email using nodemailer if configured
    try {
      const nodemailer = require('nodemailer');
      
      // Create transporter - using Gmail as an example
      // User needs to set up app password in Gmail settings
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.FEEDBACK_EMAIL_USER,
          pass: process.env.FEEDBACK_EMAIL_PASSWORD
        }
      });

      const mailOptions = {
        from: process.env.FEEDBACK_EMAIL_USER,
        to: 'omar.tawil10@gmail.com',
        subject: `hüm App Feedback - ${new Date().toLocaleDateString()}`,
        html: `
          <h2>New Feedback from hüm App</h2>
          <p><strong>Feedback:</strong></p>
          <p>${feedback}</p>
          <hr>
          <p><strong>Song Context:</strong> ${songTitle} - ${songArtist}</p>
          <p><strong>Timestamp:</strong> ${new Date(timestamp).toLocaleString()}</p>
        `
      };

      await transporter.sendMail(mailOptions);
      console.log('   ✅ Email sent successfully');
    } catch (emailError) {
      console.log('   ⚠️  Email not configured or failed:', emailError.message);
      console.log('   💡 To enable emails, set FEEDBACK_EMAIL_USER and FEEDBACK_EMAIL_PASSWORD in .env');
    }

    res.json({ 
      success: true, 
      message: 'Feedback received!' 
    });
    
  } catch (error) {
    console.error('❌ General feedback error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to send feedback' 
    });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
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

    const { plan } = req.body; // 'avid' or 'unlimited'
    
    if (!plan || !['avid', 'unlimited'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    const planDetails = {
      avid: {
        name: 'Avid Listener',
        price: 100, // $1.00 in cents
        description: '100 searches per month'
      },
      unlimited: {
        name: 'Eat, Breath, Music',
        price: 400, // $4.00 in cents
        description: 'Unlimited searches'
      }
    };

    const selectedPlan = planDetails[plan];
    const data = getUsersData();
    const user = data.users.find(u => u.id === req.user.userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'], // Stripe supports Apple Pay, Google Pay automatically
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: selectedPlan.name,
              description: selectedPlan.description,
            },
            recurring: {
              interval: 'month',
            },
            unit_amount: selectedPlan.price,
          },
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}?payment=canceled`,
      client_reference_id: user.id,
      customer_email: user.email,
      metadata: {
        userId: user.id,
        plan: plan,
      },
    });

    res.json({ 
      success: true, 
      sessionId: session.id,
      url: session.url 
    });
  } catch (error) {
    console.error('Stripe checkout error:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
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

    if (userId && plan) {
      const data = getUsersData();
      const user = data.users.find(u => u.id === userId);
      
      if (user) {
        user.tier = plan;
        user.searchCount = 0; // Reset search count for new subscription
        user.subscriptionId = session.subscription;
        user.subscriptionStatus = 'active';
        saveUsersData(data);
        console.log(`✅ User ${user.email} upgraded to ${plan} tier`);
      }
    }
  } else if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    const data = getUsersData();
    const user = data.users.find(u => u.subscriptionId === subscription.id);
    
    if (user) {
      user.tier = 'free';
      user.subscriptionId = null;
      user.subscriptionStatus = 'canceled';
      saveUsersData(data);
      console.log(`⚠️ User ${user.email} subscription canceled, downgraded to free`);
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
    
    if (!plan || !['avid', 'unlimited'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    const planDetails = {
      avid: {
        name: 'Avid Listener',
        price: '1.00',
        description: '100 searches per month'
      },
      unlimited: {
        name: 'Eat, Breath, Music',
        price: '4.00',
        description: 'Unlimited searches'
      }
    };

    const selectedPlan = planDetails[plan];
    const data = getUsersData();
    const user = data.users.find(u => u.id === req.user.userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // For now, return a simple redirect URL
    // In production, you'd integrate with PayPal SDK
    // This is a placeholder - you'll need to set up PayPal SDK
    const paypalUrl = `https://www.paypal.com/checkoutnow?token=PLACEHOLDER&userId=${user.id}&plan=${plan}`;
    
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
      const data = getUsersData();
      const user = data.users.find(u => u.id === session.metadata.userId);
      
      if (user) {
        user.tier = session.metadata.plan;
        user.searchCount = 0;
        user.subscriptionId = session.subscription;
        user.subscriptionStatus = 'active';
        saveUsersData(data);
        
        console.log(`✅ User ${user.email} upgraded to ${session.metadata.plan} tier`);
        
        res.json({
          success: true,
          message: 'Payment verified and account upgraded',
          tier: user.tier
        });
      } else {
        res.status(404).json({ error: 'User not found' });
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

    const data = getUsersData();
    const user = data.users.find(u => u.id === req.user.userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      tier: user.tier || 'free',
      subscriptionStatus: user.subscriptionStatus || null,
      hasActiveSubscription: user.subscriptionStatus === 'active'
    });
  } catch (error) {
    console.error('Payment status error:', error);
    res.status(500).json({ error: 'Failed to get payment status' });
  }
});

// Send welcome email to existing user (admin endpoint)
app.post('/api/admin/send-welcome-email', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const data = getUsersData();
    const user = data.users.find(u => u.email === email.toLowerCase());
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const remainingSearches = 5 - (user.searchCount || 0);
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎵 hüm backend running on port ${PORT}`);
  console.log(`   🌐 Listening on 0.0.0.0 (all interfaces)`);
  console.log(`   ✅ Lyrics search: Scrapingdog → Spotify (field search)`);
  console.log(`   ✅ Humming: ACRCloud + Spotify enrichment`);
  console.log(`   📡 CORS enabled for all origins`);
});