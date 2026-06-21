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
  // hüm+ (single paid plan): generous monthly allowance, with a soft slowdown near
  // the top, a hard monthly cutoff, and an hourly burst limit to stop scripted abuse.
  //   ≤120 / month       : normal
  //   121–149 / month    : slowed (cooldown between searches)
  //   ≥150 / month       : hard cutoff until the monthly window resets
  //   >40 searches / hour: blocked for the rest of that hour
  const PLUS_SOFT_LIMIT = 120;
  const PLUS_CUTOFF_LIMIT = 150;
  const PLUS_SOFT_COOLDOWN_MS = 30 * 1000;
  const HOURLY_LIMIT = 40;
  const HOUR_MS = 60 * 60 * 1000;

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
        // Anything other than the free tier is the single paid plan (incl. legacy
        // avid/unlimited subscribers).
        const isPaid = !!user.tier && user.tier !== 'free';
        const now = Date.now();

        // Paid plan: roll the monthly allowance window and the hourly burst window.
        // (Free tier is a one-time trial and is intentionally NOT reset.)
        if (isPaid) {
          let changed = false;
          if (!user.searchPeriodStart) {
            user.searchPeriodStart = user.subscriptionStartedAt || user.createdAt || new Date();
            changed = true;
          }
          const windowEnd = new Date(user.searchPeriodStart);
          windowEnd.setMonth(windowEnd.getMonth() + 1);
          if (now >= windowEnd.getTime()) {
            user.searchCount = 0;
            user.searchPeriodStart = new Date();
            changed = true;
          }
          const hourStart = user.hourlyWindowStart ? new Date(user.hourlyWindowStart).getTime() : 0;
          if (!hourStart || (now - hourStart) >= HOUR_MS) {
            user.hourlyCount = 0;
            user.hourlyWindowStart = new Date();
            changed = true;
          }
          if (changed) await user.save();
        }

        const searchCount = user.searchCount || 0;

        if (!isPaid && searchCount >= FREE_SEARCH_LIMIT) {
          return res.status(403).json({
            success: false,
            error: 'Search limit reached',
            message: 'You have reached your free search limit. Please upgrade to continue.',
            requiresUpgrade: true
          });
        }

        if (isPaid) {
          // Hourly burst limit: >40 searches in the last hour → blocked for the rest
          // of that hour.
          if ((user.hourlyCount || 0) >= HOURLY_LIMIT) {
            const hourStart = user.hourlyWindowStart ? new Date(user.hourlyWindowStart).getTime() : now;
            const retryAfterSeconds = Math.max(1, Math.ceil((hourStart + HOUR_MS - now) / 1000));
            res.set('Retry-After', String(retryAfterSeconds));
            return res.status(429).json({
              success: false,
              error: 'Search rate limited',
              message: "you've searched a lot in a short time — please take a break and try again in a bit.",
              rateLimited: true,
              retryAfterSeconds
            });
          }
          // Hard monthly cutoff at 150.
          if (searchCount >= PLUS_CUTOFF_LIMIT) {
            return res.status(429).json({
              success: false,
              error: 'Monthly search cap reached',
              message: "you've reached your searches for this month — it resets at the start of your next billing period.",
              rateLimited: true,
              capReached: true
            });
          }
          // Soft slowdown band (121–149): enforce a cooldown between searches.
          if (searchCount > PLUS_SOFT_LIMIT) {
            const last = user.lastSearchAt ? new Date(user.lastSearchAt).getTime() : 0;
            const sinceLast = now - last;
            if (sinceLast < PLUS_SOFT_COOLDOWN_MS) {
              const retryAfterSeconds = Math.ceil((PLUS_SOFT_COOLDOWN_MS - sinceLast) / 1000);
              res.set('Retry-After', String(retryAfterSeconds));
              return res.status(429).json({
                success: false,
                error: 'Search rate limited',
                message: "you're searching quickly — please wait a moment between searches.",
                rateLimited: true,
                retryAfterSeconds
              });
            }
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
