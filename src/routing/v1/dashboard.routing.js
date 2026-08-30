const express = require('express');
const router = express.Router();
const dashboardController = require('../../controller/dashboard.controller');

router.get('/stats', dashboardController.getDashboardStats);

module.exports = router;
