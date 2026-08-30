const feeService = require("../services/fee.service");

class FeeController {
  getCategories = async (req, res, next) => {
    try {
      const data = await feeService.getCategories(req);
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  createCategory = async (req, res, next) => {
    try {
      const data = await feeService.createCategory(req.body, req);
      res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  getStructures = async (req, res, next) => {
    try {
      const data = await feeService.getStructures(req);
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  createStructure = async (req, res, next) => {
    try {
      const data = await feeService.createStructure(req.body, req);
      res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  getStudentFees = async (req, res, next) => {
    try {
      const { student_id, class_id } = req.query;
      const data = await feeService.getStudentFees({ student_id, class_id }, req);
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  createStudentFee = async (req, res, next) => {
    try {
      const data = await feeService.createStudentFee(req.body, req);
      res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  bulkGenerateStudentFees = async (req, res, next) => {
    try {
      const data = await feeService.bulkGenerateStudentFees(req.body, req);
      res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  getReceipts = async (req, res, next) => {
    try {
      const { student_id } = req.query;
      const data = await feeService.getReceipts({ student_id }, req);
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  collectPayment = async (req, res, next) => {
    try {
      const user = req.user;
      const payload = { ...req.body, cashier_name: user?.name || user?.email || "Admin" };
      const data = await feeService.collectPayment(payload, req);
      res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  getDashboardStats = async (req, res, next) => {
    try {
      const data = await feeService.getDashboardStats(req);
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };
}

module.exports = new FeeController();
