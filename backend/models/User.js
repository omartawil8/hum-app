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
  }
});

module.exports = mongoose.model('User', userSchema);

