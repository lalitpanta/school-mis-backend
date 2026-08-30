const express = require('express');
const router = express.Router();
const leaveController = require('../../controller/leave.controller');
const { requireAdmin } = require('../../middleware/auth.middleware');

router.get('/', leaveController.getLeaveRequests); // Admin/manager can see all
router.get('/my', leaveController.getMyLeaves); // Individual staff
router.post('/', leaveController.requestLeave); // Staff request
router.put('/:id/status', leaveController.updateLeaveStatus); // Admin approve/reject

module.exports = router;
