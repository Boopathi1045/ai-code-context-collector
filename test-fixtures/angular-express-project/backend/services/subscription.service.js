const Customer = require('../models/customer.model');

async function findExpiringSubscriptions(daysThreshold = 30) {
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + daysThreshold);

  return await Customer.find({
    subscriptionStatus: 'active',
    subscriptionExpiresAt: { $lte: targetDate },
  });
}

module.exports = {
  findExpiringSubscriptions,
};
