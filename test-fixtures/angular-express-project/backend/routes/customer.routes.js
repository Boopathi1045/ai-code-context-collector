const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customer.controller');

router.get('/customers', customerController.getCustomers);
router.get('/customers/expiring-subscriptions', customerController.getExpiringSubscriptions);
router.post('/customers', customerController.createCustomer);

module.exports = router;
