const express = require("express");
const router = express.Router();
const ctrl = require("../../controller/accounts.controller");
const { requirePermission } = require("../../middleware/auth.middleware");

// Double-entry accounting foundation
router.get(
  "/accounting/accounts",
  requirePermission("accounts.view"),
  ctrl.listAccounts,
);
router.post(
  "/accounting/accounts",
  requirePermission("accounts.manage"),
  ctrl.createAccount,
);
router.patch(
  "/accounting/accounts/:id",
  requirePermission("accounts.manage"),
  ctrl.updateAccount,
);
router.post(
  "/accounting/journals",
  requirePermission("accounts.post"),
  ctrl.postJournal,
);
router.get(
  "/accounting/trial-balance",
  requirePermission("accounts.view"),
  ctrl.getTrialBalance,
);
router.get(
  "/accounting/reports/:report",
  requirePermission("accounts.view"),
  ctrl.getFinancialReport,
);
router.get(
  "/accounting/fiscal-years",
  requirePermission("accounts.view"),
  ctrl.listFiscalYears,
);
router.post(
  "/accounting/fiscal-years",
  requirePermission("accounts.manage"),
  ctrl.createFiscalYear,
);
router.patch(
  "/accounting/fiscal-years/:id/close",
  requirePermission("accounts.close_period"),
  ctrl.closeFiscalYear,
);
router.patch(
  "/accounting/fiscal-years/:id/active",
  requirePermission("accounts.manage"),
  ctrl.setActiveFiscalYear,
);
router.patch(
  "/accounting/fiscal-years/:id/lock",
  requirePermission("accounts.close_period"),
  ctrl.lockFiscalYear,
);
router.get(
  "/accounting/configuration",
  requirePermission("accounts.view"),
  ctrl.getAccountingConfiguration,
);
router.patch(
  "/accounting/configuration",
  requirePermission("accounts.manage"),
  ctrl.updateAccountingConfiguration,
);
router.post(
  "/accounting/tax-rules",
  requirePermission("accounts.manage"),
  ctrl.createTaxRule,
);
router.post(
  "/accounting/cost-centers",
  requirePermission("accounts.manage"),
  ctrl.createCostCenter,
);
router.get(
  "/accounting/journals",
  requirePermission("accounts.view"),
  ctrl.listJournals,
);
router.get(
  "/accounting/journals/:id",
  requirePermission("accounts.view"),
  ctrl.getJournal,
);
router.get(
  "/accounting/ledger",
  requirePermission("accounts.view"),
  ctrl.getLedger,
);
router.get(
  "/accounting/vouchers",
  requirePermission("accounts.view"),
  ctrl.listVouchers,
);
router.post(
  "/accounting/vouchers",
  requirePermission("accounts.manage"),
  ctrl.createVoucher,
);
router.post(
  "/accounting/vouchers/:id/post",
  requirePermission("accounts.post"),
  ctrl.postVoucher,
);
router.get(
  "/accounting/payment-gateways",
  requirePermission("accounts.view"),
  ctrl.listGateways,
);
router.post(
  "/accounting/payment-gateways",
  requirePermission("accounts.manage"),
  ctrl.saveGateway,
);
router.get(
  "/accounting/payment-gateway-transactions",
  requirePermission("accounts.view"),
  ctrl.listGatewayTransactions,
);
router.post(
  "/accounting/payment-gateway-transactions",
  requirePermission("accounts.manage"),
  ctrl.updateGatewayTransaction,
);
router.get(
  "/accounting/bank-statements",
  requirePermission("accounts.view"),
  ctrl.listBankStatements,
);
router.post(
  "/accounting/bank-accounts",
  requirePermission("accounts.manage"),
  ctrl.createBankAccount,
);
router.post(
  "/accounting/bank-statements/import",
  requirePermission("accounts.manage"),
  ctrl.importBankStatement,
);
router.post(
  "/accounting/journals/:id/void",
  requirePermission("accounts.manage"),
  ctrl.voidJournal,
);
router.post(
  "/accounting/journals/:id/reverse",
  requirePermission("accounts.post"),
  ctrl.reverseJournal,
);

// Overview / dashboard
router.get("/overview", ctrl.getOverview);

// Transactions ledger
router.get("/transactions", ctrl.getTransactions);
router.post("/transactions", ctrl.createTransaction);
router.put("/transactions/:id", ctrl.updateTransaction);
router.delete("/transactions/:id", ctrl.deleteTransaction);

// Expense categories & breakdown chart
router.get("/expense-categories", ctrl.getExpenseCategories);
router.get("/expense-breakdown", ctrl.getExpenseBreakdown);

// Fee collection per class (for bar chart)
router.get("/collection-by-class", ctrl.getCollectionByClass);

// Payroll
router.get("/payroll", ctrl.getPayroll);
router.post("/payroll", ctrl.createPayroll);
router.patch("/payroll/:id/status", ctrl.updatePayrollStatus);

// CSV export
router.get("/export/csv", ctrl.exportCsv);

module.exports = router;
