const express = require("express");
const router = express.Router();
const feeController = require("../../controller/fee.controller");
const { requirePermission } = require("../../middleware/auth.middleware");

// Categories
router.get("/categories", feeController.getCategories);
router.post("/categories", requirePermission("fees.manage"), feeController.createCategory);
router.get("/groups", feeController.listGroups);

// Structures
router.get("/structures", feeController.getStructures);
router.post("/structures", requirePermission("fees.manage"), feeController.createStructure);
router.get("/structures/:id", feeController.getStructure);
router.post("/managed-structures", requirePermission("fees.manage"), feeController.createManagedStructure);
router.put("/managed-structures/:id", requirePermission("fees.manage"), feeController.updateManagedStructure);
router.patch("/managed-structures/:id/status", requirePermission("fees.manage"), feeController.setStructureStatus);
router.post("/managed-structures/:id/duplicate", requirePermission("fees.manage"), feeController.duplicateStructure);
router.post("/assignments", requirePermission("fees.manage"), feeController.assignStructure);

// Fees (Student Fees)
router.get("/students/lookup", feeController.lookupStudents);
router.get("/students/:studentId/due", feeController.getStudentDue);
router.post("/students/:studentId/generate-due", requirePermission("fees.manage"), feeController.generateStudentDue);
router.get("/student-fees", feeController.getStudentFees);
router.post("/student-fees", requirePermission("fees.manage"), feeController.createStudentFee);
router.post("/student-fees/bulk-generate", requirePermission("fees.manage"), feeController.bulkGenerateStudentFees);

// Payments (Receipts)
router.get("/receipts", feeController.getReceipts);
router.post("/pay", requirePermission("fees.collect"), feeController.collectPayment);
router.post("/receipts/:id/cancellation", requirePermission("fees.collect"), feeController.requestReceiptCancellation);
router.patch("/receipts/:id/cancellation/approve", requirePermission("fees.manage"), feeController.approveReceiptCancellation);
router.get("/invoices", feeController.listInvoices);
router.post("/invoices", requirePermission("fees.collect"), feeController.createInvoice);
router.post("/invoices/:id/payments", requirePermission("fees.collect"), feeController.recordInvoicePayment);
router.get("/audit", feeController.listAudit);

// Dashboard/Reports
router.get("/dashboard-stats", feeController.getDashboardStats);

module.exports = router;
