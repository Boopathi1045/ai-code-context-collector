const Customer = require('../models/customer.model');

async function findAllCustomers() {
  return await Customer.find({ isActive: true });
}

async function create(data) {
  const customer = new Customer(data);
  return await customer.save();
}

module.exports = {
  findAllCustomers,
  create,
};
