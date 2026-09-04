const feeService = require("../services/fee.service");

class FeeController {
  listGroups = async (req, res, next) => {
    try {
      res.json({ success: true, data: await feeService.listGroups(req) });
    } catch (err) {
      next(err);
    }
  };

  createGroup = async (req, res, next) => {
    try {
      res
        .status(201)
        .json({
          success: true,
          data: await feeService.createGroup(req.body, req),
        });
    } catch (err) {
      next(err);
    }
  };

  getStructure = async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: await feeService.getFeeStructure(req.params.id, req),
      });
    } catch (err) {
      next(err);
    }
  };

  createManagedStructure = async (req, res, next) => {
    try {
      res
        .status(201)
        .json({
          success: true,
          data: await feeService.createManagedStructure(req.body, req),
        });
    } catch (err) {
      next(err);
    }
  };

  updateManagedStructure = async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: await feeService.updateManagedStructure(
          req.params.id,
          req.body,
          req,
        ),
      });
    } catch (err) {
      next(err);
    }
  };

  setStructureStatus = async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: await feeService.setStructureStatus(
          req.params.id,
          req.body.status,
          req,
        ),
      });
    } catch (err) {
      next(err);
    }
  };

  duplicateStructure = async (req, res, next) => {
    try {
      res
        .status(201)
        .json({
          success: true,
          data: await feeService.duplicateStructure(req.params.id, req),
        });
    } catch (err) {
      next(err);
    }
  };

  assignStructure = async (req, res, next) => {
    try {
      res
        .status(201)
        .json({
          success: true,
          data: await feeService.assignStructure(req.body, req),
        });
    } catch (err) {
      next(err);
    }
  };

  createInvoice = async (req, res, next) => {
    try {
      res
        .status(201)
        .json({
          success: true,
          data: await feeService.createInvoice(req.body, req),
        });
    } catch (err) {
      next(err);
    }
  };

  listInvoices = async (req, res, next) => {
    try {
      res.json({ success: true, data: await feeService.listInvoices(req) });
    } catch (err) {
      next(err);
    }
  };

  getInvoice = async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: await feeService.getInvoice(req.params.id, req),
      });
    } catch (err) {
      next(err);
    }
  };

  recordInvoicePayment = async (req, res, next) => {
    try {
      res
        .status(201)
        .json({
          success: true,
          data: await feeService.recordInvoicePayment(
            req.params.id,
            req.body,
            req,
          ),
        });
    } catch (err) {
      next(err);
    }
  };

  listAudit = async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: await feeService.listAudit(req.query.entity_id, req),
      });
    } catch (err) {
      next(err);
    }
  };

  requestReceiptCancellation = async (req, res, next) => {
    try {
      res
        .status(201)
        .json({
          success: true,
          data: await feeService.requestReceiptCancellation(
            req.params.id,
            req.body.reason,
            req,
          ),
        });
    } catch (err) {
      next(err);
    }
  };

  approveReceiptCancellation = async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: await feeService.approveReceiptCancellation(req.params.id, req),
      });
    } catch (err) {
      next(err);
    }
  };

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
      const data = await feeService.getStudentFees(
        { student_id, class_id },
        req,
      );
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  lookupStudents = async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: await feeService.lookupStudents(req.query.search, req),
      });
    } catch (err) {
      next(err);
    }
  };

  getStudentDue = async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: await feeService.getStudentDue(req.params.studentId, req),
      });
    } catch (err) {
      next(err);
    }
  };

  generateStudentDue = async (req, res, next) => {
    try {
      res
        .status(201)
        .json({
          success: true,
          data: await feeService.generateStudentDue(req.params.studentId, req),
        });
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
      const payload = {
        ...req.body,
        cashier_name: user?.name || user?.email || "Admin",
      };
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
