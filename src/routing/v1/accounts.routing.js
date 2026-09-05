const express    = require('express');
const router     = express.Router();
const ctrl       = require('../../controller/accounts.controller');
const { requirePermission } = require('../../middleware/auth.middleware');

// Double-entry accounting foundation
router.get('/accounting/accounts',      requirePermission('accounts.view'), ctrl.listAccounts);
router.post('/accounting/accounts',     requirePermission('accounts.manage'), ctrl.createAccount);
router.post('/accounting/journals',     requirePermission('accounts.post'), ctrl.postJournal);
router.get('/accounting/trial-balance', requirePermission('accounts.view'), ctrl.getTrialBalance);
router.get('/accounting/reports/:report', requirePermission('accounts.view'), ctrl.getFinancialReport);
router.get('/accounting/fiscal-years', requirePermission('accounts.view'), ctrl.listFiscalYears);
router.post('/accounting/fiscal-years', requirePermission('accounts.manage'), ctrl.createFiscalYear);
router.patch('/accounting/fiscal-years/:id/close', requirePermission('accounts.close_period'), ctrl.closeFiscalYear);
router.get('/accounting/journals', requirePermission('accounts.view'), ctrl.listJournals);
router.post('/accounting/journals/:id/void', requirePermission('accounts.manage'), ctrl.voidJournal);
router.post('/accounting/journals/:id/reverse', requirePermission('accounts.post'), ctrl.reverseJournal);

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
