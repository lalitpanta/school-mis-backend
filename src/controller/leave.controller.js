const leaveService = require("../services/leave.service");

const getLeaveRequests = async (req, res) => {
  try {
    const rows = await leaveService.listAll(req.tenantPool);
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res
      .status(err.statusCode || 500)
      .json({ success: false, message: err.message });
  }
};

const getMyLeaves = async (req, res) => {
  try {
    const rows = await leaveService.listForUser(req.tenantPool, req.user?.id);
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res
      .status(err.statusCode || 500)
      .json({ success: false, message: err.message });
  }
};

const requestLeave = async (req, res) => {
  try {
    const data = await leaveService.createRequest(
      req.tenantPool,
      req.user?.id,
      req.body,
    );
    return res.status(201).json({ success: true, data });
  } catch (err) {
    return res
      .status(err.statusCode || 500)
      .json({ success: false, message: err.message });
  }
};

const updateLeaveStatus = async (req, res) => {
  try {
    const data = await leaveService.updateStatus(
      req.tenantPool,
      req.params.id,
      req.body,
    );
    return res.json({ success: true, data });
  } catch (err) {
    return res
      .status(err.statusCode || 500)
      .json({ success: false, message: err.message });
  }
};

module.exports = { getLeaveRequests, getMyLeaves, requestLeave, updateLeaveStatus };
