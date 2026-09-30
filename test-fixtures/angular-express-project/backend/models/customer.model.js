const mongoose = require('mongoose');

const CustomerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  subscriptionStatus: { type: String, enum: ['active', 'expired', 'trial'], default: 'trial' },
  subscriptionExpiresAt: { type: Date },
  isActive: { type: Boolean, default: true },
}, {
  timestamps: true,
});

module.exports = mongoose.model('Customer', CustomerSchema);
