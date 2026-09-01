const express    = require('express');
const router     = express.Router();
const ctrl       = require('../../controller/accounts.controller');

// Overview / dashboard
router.get('/overview',              ctrl.getOverview);

// Transactions ledger
router.get('/transactions',          ctrl.getTransactions);
router.post('/transactions',         ctrl.createTransaction);
router.put('/transactions/:id',      ctrl.updateTransaction);
router.delete('/transactions/:id',   ctrl.deleteTransaction);

// Expense categories & breakdown chart
router.get('/expense-categories',    ctrl.getExpenseCategories);
router.get('/expense-breakdown',     ctrl.getExpenseBreakdown);

// Fee collection per class (for bar chart)
router.get('/collection-by-class',   ctrl.getCollectionByClass);

// Payroll
router.get('/payroll',               ctrl.getPayroll);
router.post('/payroll',              ctrl.createPayroll);
router.patch('/payroll/:id/status',  ctrl.updatePayrollStatus);

// CSV export
router.get('/export/csv',            ctrl.exportCsv);

module.exports = router;
