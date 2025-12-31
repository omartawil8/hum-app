const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  searchCount: {
    type: Number,
    default: 0
  },
  tier: {
    type: String,
    enum: ['free', 'avid', 'unlimited'],
    default: 'free'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  stripeCustomerId: {
    type: String,
    default: null
  },
  stripeSubscriptionId: {
    type: String,
    default: null
  },
  nickname: {
    type: String,
    default: null,
    trim: true,
    maxlength: 30
  },
  bookmarks: [{
    title: String,
    artist: String,
    album: String,
    albumArt: String,
    spotifyUrl: String,
    timestamp: {
      type: Date,
      default: Date.now
    }
  }],
  recentSearches: [{
    query: String,
    result: {
      title: String,
      artist: String,
      album: String,
      albumArt: String,
      spotifyUrl: String
    },
    timestamp: {
      type: Date,
      default: Date.now
    }
  }]
});

module.exports = mongoose.model('User', userSchema);

