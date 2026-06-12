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

module.exports = {
  JWT_SECRET,
  isMongoConnected,
  authenticateToken,
  requireAdminSecret,
  getAnonymousId,
  checkSearchLimit,
};
