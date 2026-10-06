const express = require('express');
const router = express.Router();
const leaveController = require('../../controller/leave.controller');

router.get('/', leaveController.getLeaveRequests); // Admin/manager can see all
router.get('/my', leaveController.getMyLeaves); // Individual staff
router.post('/', leaveController.requestLeave);
router.put('/:id/status', leaveController.updateLeaveStatus);

module.exports = router;
