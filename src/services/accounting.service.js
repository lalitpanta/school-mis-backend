const DEFAULT_ACCOUNTS = [
  ["1000", "Cash", "asset"],
  ["1010", "Bank", "asset"],
  ["1100", "Accounts Receivable", "asset"],
  ["4000", "Fee Income", "income"],
  ["5000", "Operating Expenses", "expense"],
  ["5100", "Staff Salaries", "expense"],
];

function currentFiscalYear() {
  const now = new Date();
  const year = now.getFullYear() - 57;
  const start = now.getMonth() + 1 >= 7 ? year : year - 1;
  return `${start}/${String(start + 1).slice(-2)}`;
}

function accountingError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

class AccountingService {
  async ensureTables(db) {
    await db.query(`
      CREATE TABLE IF NOT EXISTS accounting_accounts (
        id SERIAL PRIMARY KEY,
        code VARCHAR(30) NOT NULL UNIQUE,
        name VARCHAR(150) NOT NULL,
        account_type VARCHAR(20) NOT NULL CHECK (account_type IN ('asset','liability','equity','income','expense')),
        parent_id INTEGER REFERENCES accounting_accounts(id) ON DELETE SET NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS accounting_fiscal_years (
        id SERIAL PRIMARY KEY,
        name VARCHAR(20) NOT NULL UNIQUE,
        starts_on DATE,
        ends_on DATE,
        status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS accounting_journals (
        id SERIAL PRIMARY KEY,
        journal_number VARCHAR(40) NOT NULL UNIQUE,
        journal_date DATE NOT NULL DEFAULT CURRENT_DATE,
        description TEXT,
        fiscal_year VARCHAR(20),
        source_type VARCHAR(80),
        source_id VARCHAR(100),
        status VARCHAR(20) NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','void','reversed')),
        void_reason TEXT,
        reversed_from_id INTEGER REFERENCES accounting_journals(id),
        created_by UUID,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS accounting_journal_lines (
        id SERIAL PRIMARY KEY,
        journal_id INTEGER NOT NULL REFERENCES accounting_journals(id) ON DELETE CASCADE,
        account_id INTEGER NOT NULL REFERENCES accounting_accounts(id),
        description TEXT,
        debit NUMERIC(14,2) NOT NULL DEFAULT 0,
        credit NUMERIC(14,2) NOT NULL DEFAULT 0,
        CHECK (debit >= 0 AND credit >= 0 AND NOT (debit > 0 AND credit > 0))
      );
      CREATE TABLE IF NOT EXISTS accounting_vouchers (
        id SERIAL PRIMARY KEY,
        voucher_number VARCHAR(40) NOT NULL UNIQUE,
        voucher_type VARCHAR(20) NOT NULL CHECK (voucher_type IN ('receipt','payment','contra','sales','purchase','journal')),
        voucher_date DATE NOT NULL DEFAULT CURRENT_DATE,
        narration TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','void','reversed')),
        journal_id INTEGER REFERENCES accounting_journals(id),
        fiscal_year VARCHAR(20),
        created_by UUID,
        posted_by UUID,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS accounting_voucher_lines (
        id SERIAL PRIMARY KEY,
        voucher_id INTEGER NOT NULL REFERENCES accounting_vouchers(id) ON DELETE CASCADE,
        account_id INTEGER NOT NULL REFERENCES accounting_accounts(id),
        description TEXT,
        debit NUMERIC(14,2) NOT NULL DEFAULT 0,
        credit NUMERIC(14,2) NOT NULL DEFAULT 0,
        CHECK (debit >= 0 AND credit >= 0 AND NOT (debit > 0 AND credit > 0))
      );
      CREATE SEQUENCE IF NOT EXISTS accounting_voucher_number_seq;
      CREATE INDEX IF NOT EXISTS idx_accounting_journals_date ON accounting_journals(journal_date);
      CREATE INDEX IF NOT EXISTS idx_accounting_journals_fiscal_year ON accounting_journals(fiscal_year);
      CREATE INDEX IF NOT EXISTS idx_accounting_journal_lines_account ON accounting_journal_lines(account_id);
      CREATE INDEX IF NOT EXISTS idx_accounting_vouchers_date ON accounting_vouchers(voucher_date);
      CREATE INDEX IF NOT EXISTS idx_accounting_vouchers_status ON accounting_vouchers(status);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_accounting_journal_source
        ON accounting_journals(source_type, source_id)
        WHERE source_type IS NOT NULL AND source_id IS NOT NULL;
    `);

    for (const [code, name, type] of DEFAULT_ACCOUNTS) {
      await db.query(
        `INSERT INTO accounting_accounts (code, name, account_type)
         VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING`,
        [code, name, type],
      );
    }
  }

  async withTransaction(db, callback) {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listAccounts(req) {
    await this.ensureTables(req.tenantPool);
    const result = await req.tenantPool.query(
      "SELECT * FROM accounting_accounts WHERE is_active = TRUE ORDER BY code",
    );
    return result.rows;
  }

  async createAccount(payload, req) {
    await this.ensureTables(req.tenantPool);
    if (!payload.code || !payload.name || !payload.account_type) {
      throw accountingError("Code, name, and account type are required");
    }
    const result = await req.tenantPool.query(
      `INSERT INTO accounting_accounts (code, name, account_type, parent_id)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [payload.code.trim(), payload.name.trim(), payload.account_type, payload.parent_id || null],
    );
    return result.rows[0];
  }

  async updateAccount(id, payload, req) {
    await this.ensureTables(req.tenantPool);
    const fields = [];
    const values = [];
    for (const key of ["name", "account_type", "parent_id", "is_active"]) {
      if (payload[key] !== undefined) {
        values.push(key === "name" ? String(payload[key]).trim() : payload[key]);
        fields.push(`${key} = $${values.length}`);
      }
    }
    if (!fields.length) throw accountingError("No account fields to update");
    values.push(id);
    const result = await req.tenantPool.query(
      `UPDATE accounting_accounts SET ${fields.join(", ")}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${values.length} RETURNING *`,
      values,
    );
    if (!result.rows.length) throw accountingError("Account not found", 404);
    return result.rows[0];
  }

  async postJournal(client, payload, meta = {}) {
    const lines = Array.isArray(payload.lines) ? payload.lines : [];
    if (lines.length < 2) throw accountingError("A journal needs at least two lines");
    const totalDebit = lines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
    const totalCredit = lines.reduce((sum, line) => sum + Number(line.credit || 0), 0);
    if (!Number.isFinite(totalDebit) || Math.abs(totalDebit - totalCredit) > 0.005 || totalDebit <= 0) {
      throw accountingError("Journal debits and credits must balance");
    }

    const fiscalYear = payload.fiscal_year || currentFiscalYear();
    const invalidLine = lines.some((line) => {
      const debit = Number(line.debit || 0);
      const credit = Number(line.credit || 0);
      return !line.account_id || debit < 0 || credit < 0 || (debit === 0 && credit === 0) || (debit > 0 && credit > 0);
    });
    if (invalidLine) throw accountingError("Each journal line must have one positive debit or credit");

    const fiscalYearStatus = await client.query(
      "SELECT status FROM accounting_fiscal_years WHERE name = $1",
      [fiscalYear],
    );
    if (fiscalYearStatus.rows[0]?.status === "closed") {
      throw accountingError("This fiscal year is closed", 409);
    }
    const accountIds = lines.map((line) => line.account_id);
    const accountCheck = await client.query(
      "SELECT id FROM accounting_accounts WHERE id = ANY($1) AND is_active = TRUE",
      [accountIds],
    );
    if (accountCheck.rows.length !== new Set(accountIds.map(String)).size) {
      throw accountingError("Journal contains an inactive or unknown account");
    }
    const journal = await client.query(
      `INSERT INTO accounting_journals
        (journal_number, journal_date, description, fiscal_year, source_type, source_id, created_by)
       VALUES ($1, COALESCE($2, CURRENT_DATE), $3, $4, $5, $6, $7) RETURNING *`,
      [
        payload.journal_number || `JNL-${Date.now()}`,
        payload.journal_date || null,
        payload.description || payload.particulars || null,
        fiscalYear,
        payload.source_type || null,
        payload.source_id || null,
        meta.createdBy || null,
      ],
    );
    for (const line of lines) {
      await client.query(
        `INSERT INTO accounting_journal_lines (journal_id, account_id, description, debit, credit)
         VALUES ($1, $2, $3, $4, $5)`,
        [journal.rows[0].id, line.account_id, line.description || null, line.debit || 0, line.credit || 0],
      );
    }
    return this._journalWithLines(client, journal.rows[0].id);
  }

  async createVoucher(payload, req) {
    await this.ensureTables(req.tenantPool);
    const lines = Array.isArray(payload.lines) ? payload.lines : [];
    if (!payload.voucher_type || !lines.length) throw accountingError("Voucher type and lines are required");
    const voucherType = String(payload.voucher_type).toLowerCase();
    if (!["receipt", "payment", "contra", "sales", "purchase", "journal"].includes(voucherType)) {
      throw accountingError("Unsupported voucher type");
    }
    const year = new Date().getFullYear();
    const prefix = voucherType.slice(0, 2).toUpperCase();
    return this.withTransaction(req.tenantPool, async (client) => {
      const sequence = await client.query("SELECT nextval('accounting_voucher_number_seq') AS next_number");
      const number = `${prefix}-${year}-${String(sequence.rows[0].next_number).padStart(4, "0")}`;
      const voucher = await client.query(
        `INSERT INTO accounting_vouchers (voucher_number, voucher_type, voucher_date, narration, fiscal_year, created_by)
         VALUES ($1, $2, COALESCE($3, CURRENT_DATE), $4, $5, $6) RETURNING *`,
        [number, voucherType, payload.voucher_date || null, payload.narration || null, payload.fiscal_year || currentFiscalYear(), req.user?.id || null],
      );
      for (const line of lines) {
        await client.query(
          `INSERT INTO accounting_voucher_lines (voucher_id, account_id, description, debit, credit)
           VALUES ($1, $2, $3, $4, $5)`,
          [voucher.rows[0].id, line.account_id, line.description || null, line.debit || 0, line.credit || 0],
        );
      }
      return this.getVoucher(voucher.rows[0].id, { tenantPool: client });
    });
  }

  async getVoucher(id, req) {
    await this.ensureTables(req.tenantPool);
    const result = await req.tenantPool.query(
      `SELECT v.*, COALESCE(json_agg(l ORDER BY l.id) FILTER (WHERE l.id IS NOT NULL), '[]') AS lines
       FROM accounting_vouchers v LEFT JOIN accounting_voucher_lines l ON l.voucher_id = v.id
       WHERE v.id = $1 GROUP BY v.id`,
      [id],
    );
    if (!result.rows.length) throw accountingError("Voucher not found", 404);
    return result.rows[0];
  }

  async listVouchers(filters, req) {
    await this.ensureTables(req.tenantPool);
    const values = [];
    const where = [];
    if (filters.status) { values.push(filters.status); where.push(`v.status = $${values.length}`); }
    if (filters.voucher_type) { values.push(filters.voucher_type); where.push(`v.voucher_type = $${values.length}`); }
    const result = await req.tenantPool.query(
      `SELECT v.*, COALESCE(SUM(l.debit), 0) AS total_debit
       FROM accounting_vouchers v LEFT JOIN accounting_voucher_lines l ON l.voucher_id = v.id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       GROUP BY v.id ORDER BY v.id DESC LIMIT 100`,
      values,
    );
    return result.rows;
  }

  async postVoucher(id, req) {
    await this.ensureTables(req.tenantPool);
    return this.withTransaction(req.tenantPool, async (client) => {
      const voucher = await this.getVoucher(id, { tenantPool: client });
      if (voucher.status !== "draft") throw accountingError("Only draft vouchers can be posted", 409);
      const journal = await this.postJournal(client, {
        journal_date: voucher.voucher_date,
        description: voucher.narration || voucher.voucher_number,
        fiscal_year: voucher.fiscal_year,
        source_type: "accounting_voucher",
        source_id: String(voucher.id),
        lines: voucher.lines,
      }, { createdBy: req.user?.id });
      const updated = await client.query(
        `UPDATE accounting_vouchers SET status = 'posted', journal_id = $1, posted_by = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *`,
        [journal.id, req.user?.id || null, id],
      );
      return { ...updated.rows[0], journal };
    });
  }

  async postLegacyTransaction(client, payload, sourceId, req) {
    const mode = payload.payment_mode === "bank" ? "1010" : "1000";
    const type = payload.txn_type === "income" ? "income" : "expense";
    const debitCode = type === "income" ? mode : payload.category === "Staff Salaries" ? "5100" : "5000";
    const creditCode = type === "income" ? "4000" : mode;
    const accounts = await client.query(
      "SELECT id, code FROM accounting_accounts WHERE code = ANY($1)",
      [[debitCode, creditCode]],
    );
    const ids = Object.fromEntries(accounts.rows.map((row) => [row.code, row.id]));
    if (!ids[debitCode] || !ids[creditCode]) {
      throw accountingError("Default accounting accounts are not configured", 500);
    }
    const existing = await client.query(
      "SELECT id FROM accounting_journals WHERE source_type = $1 AND source_id = $2",
      ["accounts_transaction", String(sourceId)],
    );
    if (existing.rows.length) return this._journalWithLines(client, existing.rows[0].id);
    return this.postJournal(client, {
      journal_date: payload.txn_date,
      description: payload.particulars || "Accounts transaction",
      fiscal_year: payload.fiscal_year,
      source_type: "accounts_transaction",
      source_id: String(sourceId),
      lines: [
        { account_id: ids[debitCode], debit: payload.amount, credit: 0 },
        { account_id: ids[creditCode], debit: 0, credit: payload.amount },
      ],
    }, { createdBy: req.user?.id });
  }

  async _journalWithLines(db, id) {
    const result = await db.query(
      `SELECT j.*, COALESCE(json_agg(l ORDER BY l.id) FILTER (WHERE l.id IS NOT NULL), '[]') AS lines
       FROM accounting_journals j LEFT JOIN accounting_journal_lines l ON l.journal_id = j.id
       WHERE j.id = $1 GROUP BY j.id`,
      [id],
    );
    return result.rows[0];
  }

  async listJournals(filters, req) {
    await this.ensureTables(req.tenantPool);
    const params = [];
    const where = [];
    if (filters.fiscal_year) { params.push(filters.fiscal_year); where.push(`j.fiscal_year = $${params.length}`); }
    const result = await req.tenantPool.query(
      `SELECT j.*, COALESCE(SUM(l.debit), 0) AS total_debit
       FROM accounting_journals j LEFT JOIN accounting_journal_lines l ON l.journal_id = j.id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       GROUP BY j.id ORDER BY j.journal_date DESC, j.id DESC LIMIT 100`,
      params,
    );
    return result.rows;
  }

  async getJournal(id, req) {
    await this.ensureTables(req.tenantPool);
    const journal = await this._journalWithLines(req.tenantPool, id);
    if (!journal) throw accountingError("Journal not found", 404);
    return journal;
  }

  async getLedger(filters, req) {
    await this.ensureTables(req.tenantPool);
    const params = [filters.fiscal_year || currentFiscalYear()];
    const where = ["j.status = 'posted'", "j.fiscal_year = $1"];
    if (filters.account_id) {
      params.push(filters.account_id);
      where.push(`l.account_id = $${params.length}`);
    }
    const result = await req.tenantPool.query(
      `SELECT j.id AS journal_id, j.journal_number, j.journal_date, j.description,
        j.source_type, l.account_id, a.code AS account_code, a.name AS account_name,
        l.debit, l.credit
       FROM accounting_journals j
       JOIN accounting_journal_lines l ON l.journal_id = j.id
       JOIN accounting_accounts a ON a.id = l.account_id
       WHERE ${where.join(" AND ")}
       ORDER BY j.journal_date, j.id, l.id`,
      params,
    );
    let balance = 0;
    return result.rows.map((row) => {
      balance += Number(row.debit || 0) - Number(row.credit || 0);
      return { ...row, balance: balance.toFixed(2) };
    });
  }

  async getTrialBalance(filters, req) {
    await this.ensureTables(req.tenantPool);
    const fiscalYear = filters.fiscal_year || currentFiscalYear();
    const result = await req.tenantPool.query(
      `SELECT a.id, a.code, a.name, a.account_type,
        COALESCE(SUM(l.debit) FILTER (WHERE j.id IS NOT NULL), 0) AS debit,
        COALESCE(SUM(l.credit) FILTER (WHERE j.id IS NOT NULL), 0) AS credit
       FROM accounting_accounts a LEFT JOIN accounting_journal_lines l ON l.account_id = a.id
       LEFT JOIN accounting_journals j ON j.id = l.journal_id AND j.status = 'posted' AND j.fiscal_year = $1
       WHERE a.is_active = TRUE GROUP BY a.id ORDER BY a.code`,
      [fiscalYear],
    );
    return { fiscal_year: fiscalYear, accounts: result.rows };
  }

  async getFinancialReport(report, filters, req) {
    const trialBalance = await this.getTrialBalance(filters, req);
    if (!["profit-loss", "income-statement", "balance-sheet"].includes(report)) {
      throw accountingError("Unknown financial report", 404);
    }
    const accounts = report === "balance-sheet"
      ? trialBalance.accounts.filter((account) => ["asset", "liability", "equity"].includes(account.account_type))
      : trialBalance.accounts.filter((account) => ["income", "expense"].includes(account.account_type));
    return { report, fiscal_year: trialBalance.fiscal_year, accounts };
  }

  async listFiscalYears(req) {
    await this.ensureTables(req.tenantPool);
    const result = await req.tenantPool.query("SELECT * FROM accounting_fiscal_years ORDER BY name DESC");
    return result.rows;
  }

  async createFiscalYear(payload, req) {
    await this.ensureTables(req.tenantPool);
    const name = String(payload.name || payload.fiscal_year || "").trim();
    if (!name) throw accountingError("Fiscal year name is required");
    const result = await req.tenantPool.query(
      `INSERT INTO accounting_fiscal_years (name, starts_on, ends_on) VALUES ($1, $2, $3) RETURNING *`,
      [name, payload.starts_on || null, payload.ends_on || null],
    );
    return result.rows[0];
  }

  async closeFiscalYear(id, req) {
    await this.ensureTables(req.tenantPool);
    const result = await req.tenantPool.query(
      "UPDATE accounting_fiscal_years SET status = 'closed' WHERE id = $1 RETURNING *",
      [id],
    );
    if (!result.rows.length) throw accountingError("Fiscal year not found", 404);
    return result.rows[0];
  }

  async voidJournal(id, reason, req) {
    await this.ensureTables(req.tenantPool);
    if (!reason?.trim()) throw accountingError("A void reason is required");
    const result = await req.tenantPool.query(
      "UPDATE accounting_journals SET status = 'void', void_reason = $1 WHERE id = $2 AND status = 'posted' RETURNING *",
      [reason || null, id],
    );
    if (!result.rows.length) throw accountingError("Posted journal not found", 404);
    return result.rows[0];
  }

  async reverseJournal(id, reason, req) {
    await this.ensureTables(req.tenantPool);
    if (!reason?.trim()) throw accountingError("A reversal reason is required");
    return this.withTransaction(req.tenantPool, async (client) => {
      const original = await client.query("SELECT * FROM accounting_journals WHERE id = $1 AND status = 'posted'", [id]);
      if (!original.rows.length) throw accountingError("Posted journal not found", 404);
      const lines = await client.query("SELECT * FROM accounting_journal_lines WHERE journal_id = $1 ORDER BY id", [id]);
      const reversal = await this.postJournal(client, {
        description: reason || `Reversal of ${original.rows[0].journal_number}`,
        fiscal_year: original.rows[0].fiscal_year,
        source_type: "journal_reversal",
        source_id: String(id),
        lines: lines.rows.map((line) => ({ account_id: line.account_id, debit: line.credit, credit: line.debit })),
      }, { createdBy: req.user?.id });
      await client.query("UPDATE accounting_journals SET status = 'reversed', reversed_from_id = $1 WHERE id = $2", [reversal.id, id]);
      return reversal;
    });
  }
}

module.exports = new AccountingService();