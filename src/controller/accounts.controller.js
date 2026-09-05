const accountsService = require('../services/accounts.service');
const accountingService = require('../services/accounting.service');

class AccountsController {
  listAccounts = async (req, res, next) => {
    try {
      const data = await accountingService.listAccounts(req);
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  createAccount = async (req, res, next) => {
    try {
      const data = await accountingService.createAccount(req.body, req);
      res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  postJournal = async (req, res, next) => {
    try {
      const data = await accountingService.withTransaction(req.tenantPool, (client) =>
        accountingService.postJournal(client, req.body, { createdBy: req.user?.id }),
      );
      res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  getTrialBalance = async (req, res, next) => {
    try {
      const data = await accountingService.getTrialBalance(req.query, req);
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  listFiscalYears = async (req, res, next) => {
    try {
      const data = await accountingService.listFiscalYears(req);
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  createFiscalYear = async (req, res, next) => {
    try {
      const data = await accountingService.createFiscalYear(req.body, req);
      res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  closeFiscalYear = async (req, res, next) => {
    try {
      const data = await accountingService.closeFiscalYear(req.params.id, req);
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  listJournals = async (req, res, next) => {
    try {
      const data = await accountingService.listJournals(req.query, req);
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  voidJournal = async (req, res, next) => {
    try {
      const data = await accountingService.voidJournal(req.params.id, req.body.reason, req);
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  reverseJournal = async (req, res, next) => {
    try {
      const data = await accountingService.reverseJournal(req.params.id, req.body.reason, req);
      res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  // GET /accounts/overview?fiscal_year=2082/83
  getOverview = async (req, res, next) => {
    try {
      const data = await accountsService.getOverview(req.query, req);
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  // GET /accounts/transactions?fiscal_year=&txn_type=&status=&limit=&offset=
  getTransactions = async (req, res, next) => {
    try {
      const data = await accountsService.getTransactions(req.query, req);
      res.status(200).json({ success: true, ...data });
    } catch (err) {
      next(err);
    }
  };

  // POST /accounts/transactions
  createTransaction = async (req, res, next) => {
    try {
      const data = await accountsService.createTransaction(req.body, req);
      res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  // PUT /accounts/transactions/:id
  updateTransaction = async (req, res, next) => {
    try {
      const data = await accountsService.updateTransaction(
        req.params.id, req.body, req
      );
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  // DELETE /accounts/transactions/:id
  deleteTransaction = async (req, res, next) => {
    try {
      const data = await accountsService.deleteTransaction(req.params.id, req);
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  // GET /accounts/expense-categories
  getExpenseCategories = async (req, res, next) => {
    try {
      const data = await accountsService.getExpenseCategories(req);
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  // GET /accounts/expense-breakdown?fiscal_year=
  getExpenseBreakdown = async (req, res, next) => {
    try {
      const data = await accountsService.getExpenseBreakdown(req.query, req);
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  // GET /accounts/collection-by-class
  getCollectionByClass = async (req, res, next) => {
    try {
      const data = await accountsService.getCollectionByClass(req.query, req);
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  // GET /accounts/payroll?fiscal_year=
  getPayroll = async (req, res, next) => {
    try {
      const data = await accountsService.getPayroll(req.query, req);
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  // POST /accounts/payroll
  createPayroll = async (req, res, next) => {
    try {
      const data = await accountsService.createPayroll(req.body, req);
      res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  // PATCH /accounts/payroll/:id/status
  updatePayrollStatus = async (req, res, next) => {
    try {
      const { status } = req.body;
      const data = await accountsService.updatePayrollStatus(
        req.params.id, status, req
      );
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  // GET /accounts/export/csv?fiscal_year=
  exportCsv = async (req, res, next) => {
    try {
      const csv = await accountsService.exportTransactionsCsv(req.query, req);
      const fy  = req.query.fiscal_year || 'all';
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="accounts_${fy.replace('/', '-')}.csv"`
      );
      res.status(200).send(csv);
    } catch (err) {
      next(err);
    }
  };
}

module.exports = new AccountsController();
