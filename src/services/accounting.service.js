'use strict';

const ACCOUNTING_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS accounting_fiscal_years (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(20) NOT NULL UNIQUE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    closed_at TIMESTAMP,
    closed_by UUID,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (end_date >= start_date)
  );
  CREATE TABLE IF NOT EXISTS accounting_accounts (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(30) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    account_type VARCHAR(20) NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'income', 'expense')),
    parent_id BIGINT REFERENCES accounting_accounts(id) ON DELETE RESTRICT,
    is_control BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS accounting_journals (
    id BIGSERIAL PRIMARY KEY,
    journal_number VARCHAR(40) NOT NULL UNIQUE,
    journal_date DATE NOT NULL,
    fiscal_year_id BIGINT NOT NULL REFERENCES accounting_fiscal_years(id),
    voucher_type VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'posted' CHECK (status IN ('draft', 'posted', 'void', 'reversed')),
    narration TEXT,
    source_type VARCHAR(60),
    source_id VARCHAR(120),
    created_by UUID,
    posted_at TIMESTAMP,
    voided_at TIMESTAMP,
    voided_by UUID,
    void_reason TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_accounting_journal_source
    ON accounting_journals(source_type, source_id)
    WHERE source_type IS NOT NULL AND source_id IS NOT NULL;
  CREATE TABLE IF NOT EXISTS accounting_journal_lines (
    id BIGSERIAL PRIMARY KEY,
    journal_id BIGINT NOT NULL REFERENCES accounting_journals(id) ON DELETE RESTRICT,
    account_id BIGINT NOT NULL REFERENCES accounting_accounts(id) ON DELETE RESTRICT,
    debit NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
    credit NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
    party_type VARCHAR(40),
    party_id VARCHAR(120),
    cost_center VARCHAR(100),
    narration TEXT,
    CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
  );
  CREATE TABLE IF NOT EXISTS accounting_voucher_sequences (
    fiscal_year_id BIGINT NOT NULL REFERENCES accounting_fiscal_years(id) ON DELETE RESTRICT,
    voucher_type VARCHAR(20) NOT NULL,
    prefix VARCHAR(12) NOT NULL,
    next_number INTEGER NOT NULL DEFAULT 1 CHECK (next_number > 0),
    PRIMARY KEY (fiscal_year_id, voucher_type)
  );
  CREATE INDEX IF NOT EXISTS idx_accounting_journals_date ON accounting_journals(journal_date);
  CREATE INDEX IF NOT EXISTS idx_accounting_journals_fy ON accounting_journals(fiscal_year_id);
  CREATE INDEX IF NOT EXISTS idx_accounting_journal_lines_account ON accounting_journal_lines(account_id);
`;

const DEFAULT_ACCOUNTS = [
  ['1000', 'Assets', 'asset', true],
  ['1010', 'Cash', 'asset', true],
  ['1020', 'Bank', 'asset', true],
  ['1030', 'Accounts Receivable', 'asset', true],
  ['2000', 'Liabilities', 'liability', true],
  ['2010', 'Accounts Payable', 'liability', true],
  ['2020', 'Salary Payable', 'liability', true],
  ['3000', 'Equity', 'equity', true],
  ['4000', 'Fee Income', 'income', true],
  ['4010', 'Other Income', 'income', true],
  ['5000', 'General Expenses', 'expense', true],
  ['5010', 'Salary Expense', 'expense', true],
];

const PREFIXES = {
  opening: 'OB', receipt: 'RV', payment: 'PV', contra: 'CV', journal: 'JV',
  sales: 'SV', purchase: 'PUR', fee: 'FEE', payroll: 'PAY', gateway: 'GW', reversal: 'REV',
};
const VOUCHER_TYPES = new Set(Object.keys(PREFIXES));

function currentFiscalYear() {
  const now = new Date();
  const year = now.getFullYear();
  const startYear = now.getMonth() >= 6 ? year : year - 1;
  return {
    code: `${startYear}/${String(startYear + 1).slice(-2)}`,
    startDate: `${startYear}-07-01`,
    endDate: `${startYear + 1}-06-30`,
  };
}

function moneyToCents(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
}

function centsToMoney(value) {
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
}

function accountingError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

class AccountingService {
  async ensureTables(db) {
    await db.query(ACCOUNTING_TABLES_SQL);
    for (const [code, name, type, isControl] of DEFAULT_ACCOUNTS) {
      await db.query(
        `INSERT INTO accounting_accounts (code, name, account_type, is_control)
         VALUES ($1, $2, $3, $4) ON CONFLICT (code) DO NOTHING`,
        [code, name, type, isControl],
      );
    }
    const fy = currentFiscalYear();
    await db.query(
      `INSERT INTO accounting_fiscal_years (code, start_date, end_date)
       VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING`,
      [fy.code, fy.startDate, fy.endDate],
    );
  }

  async withTransaction(db, callback) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async _getFiscalYear(db, code, date) {
    const target = code || currentFiscalYear().code;
    const normalizedDate = date instanceof Date
      ? date.toISOString().slice(0, 10)
      : String(date).slice(0, 10);
    let result = await db.query(
      `SELECT * FROM accounting_fiscal_years WHERE code = $1`, [target],
    );
    if (!result.rows[0]) {
      const fallback = currentFiscalYear();
      result = await db.query(
        `INSERT INTO accounting_fiscal_years (code, start_date, end_date)
         VALUES ($1, $2, $3) RETURNING *`,
        [target, fallback.startDate, fallback.endDate],
      );
    }
    const fiscalYear = result.rows[0];
    if (fiscalYear.status !== 'open') {
      throw accountingError('The fiscal year is closed', 409);
    }
    if (normalizedDate < String(fiscalYear.start_date).slice(0, 10) || normalizedDate > String(fiscalYear.end_date).slice(0, 10)) {
      throw accountingError('Transaction date is outside the fiscal year', 400);
    }
    return fiscalYear;
  }

  async _accountIds(db, codes) {
    const result = await db.query(
      `SELECT code, id FROM accounting_accounts WHERE code = ANY($1::varchar[]) AND is_active = TRUE`,
      [codes],
    );
    const accounts = Object.fromEntries(result.rows.map((row) => [row.code, row.id]));
    for (const code of codes) if (!accounts[code]) throw accountingError(`Account ${code} is not configured`, 409);
    return accounts;
  }

  async postJournal(db, payload, options = {}) {
    await this.ensureTables(db);
    const journalDate = payload.journal_date || new Date().toISOString().slice(0, 10);
    const fiscalYear = await this._getFiscalYear(db, payload.fiscal_year, journalDate);
    const lines = Array.isArray(payload.lines) ? payload.lines : [];
    if (!lines.length) throw accountingError('At least two journal lines are required');

    let debit = 0n;
    let credit = 0n;
    for (const line of lines) {
      const debitCents = moneyToCents(line.debit || '0');
      const creditCents = moneyToCents(line.credit || '0');
      if (debitCents === null || creditCents === null || (debitCents > 0n) === (creditCents > 0n)) {
        throw accountingError('Each journal line must contain either a debit or a credit amount');
      }
      debit += debitCents;
      credit += creditCents;
    }
    if (debit !== credit) throw accountingError('Journal entry is not balanced');

    if (payload.source_type && payload.source_id) {
      const existing = await db.query(
        `SELECT * FROM accounting_journals WHERE source_type = $1 AND source_id = $2`,
        [payload.source_type, String(payload.source_id)],
      );
      if (existing.rows[0]) return existing.rows[0];
    }

    const voucherType = payload.voucher_type || 'journal';
    if (!VOUCHER_TYPES.has(voucherType)) throw accountingError('Unsupported voucher type');
    const prefix = PREFIXES[voucherType] || 'JV';
    await db.query(
      `INSERT INTO accounting_voucher_sequences (fiscal_year_id, voucher_type, prefix)
       VALUES ($1, $2, $3) ON CONFLICT (fiscal_year_id, voucher_type) DO NOTHING`,
      [fiscalYear.id, voucherType, prefix],
    );
    const sequence = await db.query(
      `SELECT next_number FROM accounting_voucher_sequences
       WHERE fiscal_year_id = $1 AND voucher_type = $2 FOR UPDATE`,
      [fiscalYear.id, voucherType],
    );
    const number = sequence.rows[0].next_number;
    await db.query(
      `UPDATE accounting_voucher_sequences SET next_number = next_number + 1
       WHERE fiscal_year_id = $1 AND voucher_type = $2`,
      [fiscalYear.id, voucherType],
    );
    const journalNumber = `${prefix}-${fiscalYear.code}-${String(number).padStart(6, '0')}`;
    const journal = await db.query(
      `INSERT INTO accounting_journals
       (journal_number, journal_date, fiscal_year_id, voucher_type, status, narration, source_type, source_id, created_by, posted_at)
       VALUES ($1, $2, $3, $4, 'posted', $5, $6, $7, $8, CURRENT_TIMESTAMP)
       RETURNING *`,
      [journalNumber, journalDate, fiscalYear.id, voucherType, payload.narration || null, payload.source_type || null, payload.source_id ? String(payload.source_id) : null, options.createdBy || payload.created_by || null],
    );

    const accounts = await this._accountIds(db, lines.map((line) => String(line.account_code)));
    for (const line of lines) {
      await db.query(
        `INSERT INTO accounting_journal_lines
         (journal_id, account_id, debit, credit, party_type, party_id, cost_center, narration)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [journal.rows[0].id, accounts[line.account_code], line.debit || '0', line.credit || '0', line.party_type || null, line.party_id || null, line.cost_center || null, line.narration || null],
      );
    }
    return journal.rows[0];
  }

  async postLegacyTransaction(client, payload, sourceId, req) {
    const isIncome = payload.txn_type === 'income';
    const paymentCode = ['bank', 'cheque', 'online'].includes(payload.payment_mode) ? '1020' : '1010';
    const counterpartCode = isIncome
      ? (payload.category === 'Student Fees' ? '4000' : '4010')
      : (payload.category === 'Staff Salaries' ? '5010' : '5000');
    return this.postJournal(client, {
      journal_date: payload.txn_date,
      fiscal_year: payload.fiscal_year,
      voucher_type: isIncome ? 'receipt' : 'payment',
      narration: payload.particulars,
      source_type: 'accounts_transaction',
      source_id: sourceId,
      lines: isIncome
        ? [{ account_code: paymentCode, debit: payload.amount }, { account_code: counterpartCode, credit: payload.amount }]
        : [{ account_code: counterpartCode, debit: payload.amount }, { account_code: paymentCode, credit: payload.amount }],
    }, { createdBy: req.user?.id || null });
  }

  async listAccounts(req) {
    await this.ensureTables(req.tenantPool);
    const result = await req.tenantPool.query(
      `SELECT a.*, p.code AS parent_code, p.name AS parent_name
       FROM accounting_accounts a LEFT JOIN accounting_accounts p ON p.id = a.parent_id
       ORDER BY a.code`,
    );
    return result.rows;
  }

  async createAccount(payload, req) {
    await this.ensureTables(req.tenantPool);
    const result = await req.tenantPool.query(
      `INSERT INTO accounting_accounts (code, name, account_type, parent_id, is_control)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [payload.code, payload.name, payload.account_type, payload.parent_id || null, Boolean(payload.is_control)],
    );
    return result.rows[0];
  }

  async getTrialBalance(filters, req) {
    await this.ensureTables(req.tenantPool);
    const params = [];
    const conditions = [`j.status = 'posted'`];
    if (filters.fiscal_year) { params.push(filters.fiscal_year); conditions.push(`fy.code = $${params.length}`); }
    if (filters.from) { params.push(filters.from); conditions.push(`j.journal_date >= $${params.length}`); }
    if (filters.to) { params.push(filters.to); conditions.push(`j.journal_date <= $${params.length}`); }
    const result = await req.tenantPool.query(
      `SELECT a.id, a.code, a.name, a.account_type,
              COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit
       FROM accounting_accounts a
       LEFT JOIN accounting_journal_lines l ON l.account_id = a.id
       LEFT JOIN accounting_journals j ON j.id = l.journal_id
       LEFT JOIN accounting_fiscal_years fy ON fy.id = j.fiscal_year_id
       WHERE ${conditions.join(' AND ')}
       GROUP BY a.id ORDER BY a.code`, params,
    );
    return result.rows;
  }

  async listFiscalYears(req) {
    await this.ensureTables(req.tenantPool);
    const result = await req.tenantPool.query(
      'SELECT * FROM accounting_fiscal_years ORDER BY start_date DESC',
    );
    return result.rows;
  }

  async createFiscalYear(payload, req) {
    await this.ensureTables(req.tenantPool);
    if (!payload.code || !payload.start_date || !payload.end_date) {
      throw accountingError('Fiscal year code, start date, and end date are required');
    }
    const result = await req.tenantPool.query(
      `INSERT INTO accounting_fiscal_years (code, start_date, end_date)
       VALUES ($1, $2, $3) RETURNING *`,
      [payload.code, payload.start_date, payload.end_date],
    );
    return result.rows[0];
  }

  async closeFiscalYear(id, req) {
    await this.ensureTables(req.tenantPool);
    const result = await req.tenantPool.query(
      `UPDATE accounting_fiscal_years
       SET status = 'closed', closed_at = CURRENT_TIMESTAMP, closed_by = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND status = 'open' RETURNING *`,
      [req.user?.id || null, id],
    );
    if (!result.rows.length) throw accountingError('Open fiscal year not found', 404);
    return result.rows[0];
  }

  async listJournals(filters, req) {
    await this.ensureTables(req.tenantPool);
    const params = [];
    const conditions = [];
    if (filters.status) { params.push(filters.status); conditions.push(`j.status = $${params.length}`); }
    if (filters.voucher_type) { params.push(filters.voucher_type); conditions.push(`j.voucher_type = $${params.length}`); }
    if (filters.fiscal_year) { params.push(filters.fiscal_year); conditions.push(`fy.code = $${params.length}`); }
    if (filters.from) { params.push(filters.from); conditions.push(`j.journal_date >= $${params.length}`); }
    if (filters.to) { params.push(filters.to); conditions.push(`j.journal_date <= $${params.length}`); }
    const result = await req.tenantPool.query(
      `SELECT j.*, fy.code AS fiscal_year,
              COALESCE(SUM(l.debit), 0) AS total_debit,
              COALESCE(SUM(l.credit), 0) AS total_credit
       FROM accounting_journals j
       JOIN accounting_fiscal_years fy ON fy.id = j.fiscal_year_id
       LEFT JOIN accounting_journal_lines l ON l.journal_id = j.id
       ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
       GROUP BY j.id, fy.code ORDER BY j.journal_date DESC, j.id DESC`,
      params,
    );
    return result.rows;
  }

  async voidJournal(id, reason, req) {
    if (!String(reason || '').trim()) throw accountingError('A void reason is required');
    const result = await req.tenantPool.query(
      `UPDATE accounting_journals
       SET status = 'void', voided_at = CURRENT_TIMESTAMP, voided_by = $1, void_reason = $2
       WHERE id = $3 AND status = 'posted' RETURNING *`,
      [req.user?.id || null, reason, id],
    );
    if (!result.rows.length) throw accountingError('Posted journal not found', 404);
    return result.rows[0];
  }

  async reverseJournal(id, reason, req) {
    if (!String(reason || '').trim()) throw accountingError('A reversal reason is required');
    await this.ensureTables(req.tenantPool);
    return this.withTransaction(req.tenantPool, async (client) => {
      const journal = await client.query(
        `SELECT j.*, fy.code AS fiscal_year FROM accounting_journals j
         JOIN accounting_fiscal_years fy ON fy.id = j.fiscal_year_id
         WHERE j.id = $1 AND j.status = 'posted' FOR UPDATE`, [id],
      );
      if (!journal.rows.length) throw accountingError('Posted journal not found', 404);
      const lines = await client.query(
        `SELECT a.code, l.debit, l.credit, l.party_type, l.party_id, l.cost_center, l.narration
         FROM accounting_journal_lines l JOIN accounting_accounts a ON a.id = l.account_id
         WHERE l.journal_id = $1 ORDER BY l.id`, [id],
      );
      const reversal = await this.postJournal(client, {
        journal_date: new Date().toISOString().slice(0, 10),
        fiscal_year: journal.rows[0].fiscal_year,
        voucher_type: 'reversal',
        narration: reason,
        source_type: 'journal_reversal',
        source_id: id,
        lines: lines.rows.map((line) => ({
          ...line,
          debit: line.credit,
          credit: line.debit,
        })),
      }, { createdBy: req.user?.id || null });
      await client.query(
        `UPDATE accounting_journals SET status = 'reversed' WHERE id = $1`, [id],
      );
      return reversal;
    });
  }
}

module.exports = new AccountingService();
