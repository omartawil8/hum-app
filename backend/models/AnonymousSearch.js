const mongoose = require('mongoose');

const anonymousSearchSchema = new mongoose.Schema({
  ipAddress: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  searchCount: {
    type: Number,
    default: 0
  },
  lastSearchAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('AnonymousSearch', anonymousSearchSchema);

