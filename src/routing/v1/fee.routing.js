const express = require("express");
const router = express.Router();
const feeController = require("../../controller/fee.controller");

// Categories
router.get("/categories", feeController.getCategories);
router.post("/categories", feeController.createCategory);

// Structures
router.get("/structures", feeController.getStructures);
router.post("/structures", feeController.createStructure);

// Fees (Student Fees)
router.get("/student-fees", feeController.getStudentFees);
router.post("/student-fees", feeController.createStudentFee);
router.post("/student-fees/bulk-generate", feeController.bulkGenerateStudentFees);

// Payments (Receipts)
router.get("/receipts", feeController.getReceipts);
router.post("/pay", feeController.collectPayment);

// Dashboard/Reports
router.get("/dashboard-stats", feeController.getDashboardStats);

module.exports = router;
