const customerService = require('../services/customer.service');
const subscriptionService = require('../services/subscription.service');

async function getCustomers(req, res) {
  try {
    const customers = await customerService.findAllCustomers();
    res.json(customers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getExpiringSubscriptions(req, res) {
  try {
    const days = req.query.days || 30;
    const expiring = await subscriptionService.findExpiringSubscriptions(days);
    res.json(expiring);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createCustomer(req, res) {
  try {
    const newCustomer = await customerService.create(req.body);
    res.status(201).json(newCustomer);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

module.exports = {
  getCustomers,
  getExpiringSubscriptions,
  createCustomer,
};
