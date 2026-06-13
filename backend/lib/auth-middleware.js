const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const AnonymousSearch = require('../models/AnonymousSearch');

if (!process.env.JWT_SECRET) {
  console.error('❌ JWT_SECRET environment variable is not set. Refusing to start.');
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;

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

// Middleware to protect /api/admin/* routes with a shared secret header
function requireAdminSecret(req, res, next) {
  const provided = req.headers['x-admin-secret'];
  if (!process.env.ADMIN_SECRET || provided !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }
  next();
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
  const AVID_MONTHLY_LIMIT = 100; // Avid: 100 searches per monthly window
  // "Unlimited" is generous but not infinite. Past these monthly counts the *pace*
  // of searches is throttled with escalating cooldowns, then fully cut off at the
  // top, to stop scripted abuse from running up ACRCloud/Spotify costs. A real
  // listener never searches fast enough to feel the lower cooldowns.
  //   400–499 : soft  (8s between searches)
  //   500–599 : hard  (60s)
  //   600–699 : very hard (5 min — "very hard to use")
  //   700+    : hard cutoff (blocked until the monthly window resets)
  const UNLIMITED_SOFT_LIMIT = 400;
  const UNLIMITED_HARD_LIMIT = 500;
  const UNLIMITED_VERY_HARD_LIMIT = 600;
  const UNLIMITED_CUTOFF_LIMIT = 700;
  const SOFT_COOLDOWN_MS = 8 * 1000;
  const HARD_COOLDOWN_MS = 60 * 1000;
  const VERY_HARD_COOLDOWN_MS = 5 * 60 * 1000;

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
        // Paid tiers get a fresh search allowance each month. Roll the window when
        // a month has elapsed since it started. (Free tier is a one-time trial, so
        // it is intentionally NOT reset here.)
        if (user.tier === 'avid' || user.tier === 'unlimited') {
          let changed = false;
          if (!user.searchPeriodStart) {
            user.searchPeriodStart = user.subscriptionStartedAt || user.createdAt || new Date();
            changed = true;
          }
          const windowEnd = new Date(user.searchPeriodStart);
          windowEnd.setMonth(windowEnd.getMonth() + 1);
          if (Date.now() >= windowEnd.getTime()) {
            user.searchCount = 0;
            user.searchPeriodStart = new Date();
            changed = true;
          }
          if (changed) await user.save();
        }

        const searchCount = user.searchCount || 0;

        if (user.tier === 'free' && searchCount >= FREE_SEARCH_LIMIT) {
          return res.status(403).json({
            success: false,
            error: 'Search limit reached',
            message: 'You have reached your free search limit. Please upgrade to continue.',
            requiresUpgrade: true
          });
        }
        // Avid tier: 100 searches per monthly window
        if (user.tier === 'avid' && searchCount >= AVID_MONTHLY_LIMIT) {
          return res.status(403).json({
            success: false,
            error: 'Search limit reached',
            message: 'You have reached your monthly search limit. Please upgrade to Avid Listener.',
            requiresUpgrade: true
          });
        }
        // Unlimited tier: escalating pace throttles, then a hard monthly cutoff.
        if (user.tier === 'unlimited' && searchCount >= UNLIMITED_SOFT_LIMIT) {
          // Hard cutoff at 700/month — fully blocked until the monthly window resets.
          if (searchCount >= UNLIMITED_CUTOFF_LIMIT) {
            return res.status(429).json({
              success: false,
              error: 'Monthly search cap reached',
              message: "you've hit 700 searches this month — that's the cap. it resets at the start of your next monthly period.",
              rateLimited: true,
              capReached: true
            });
          }
          // Below the cap: pick the cooldown for the band the user is in.
          const last = user.lastSearchAt ? user.lastSearchAt.getTime() : 0;
          const sinceLast = Date.now() - last;
          let cooldown;
          let message;
          if (searchCount >= UNLIMITED_VERY_HARD_LIMIT) {
            cooldown = VERY_HARD_COOLDOWN_MS;
            message = "you've passed 600 searches this month — searches are heavily limited now. please wait a few minutes between searches.";
          } else if (searchCount >= UNLIMITED_HARD_LIMIT) {
            cooldown = HARD_COOLDOWN_MS;
            message = "you've passed 500 searches this month — searches are rate-limited now. please wait a bit between searches.";
          } else {
            cooldown = SOFT_COOLDOWN_MS;
            message = "you're searching very fast — please wait a few seconds between searches.";
          }
          if (sinceLast < cooldown) {
            const retryAfterSeconds = Math.ceil((cooldown - sinceLast) / 1000);
            res.set('Retry-After', String(retryAfterSeconds));
            return res.status(429).json({
              success: false,
              error: 'Search rate limited',
              message,
              rateLimited: true,
              retryAfterSeconds
            });
          }
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

module.exports = {
  JWT_SECRET,
  isMongoConnected,
  authenticateToken,
  requireAdminSecret,
  getAnonymousId,
  checkSearchLimit,
};
