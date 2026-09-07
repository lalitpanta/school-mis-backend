const DEFAULT_ACCOUNTS = [
  ["1000", "Cash", "asset"],
  ["1010", "Bank", "asset"],
  ["1020", "Gateway Clearing", "asset"],
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

function moneyToCents(value) {
  const text = String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

function centsToMoney(cents) {
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

class AccountingService {
  async _getConfigurationRow(client) {
    const result = await client.query(
      "SELECT * FROM accounting_configuration WHERE id = 1 LIMIT 1",
    );
    return result.rows[0] || null;
  }

  async _resolveConfiguredFiscalYear(client, requestedFiscalYear) {
    const config = await this._getConfigurationRow(client);
    const fiscalYear = requestedFiscalYear || config?.active_fiscal_year || currentFiscalYear();

    const yearResult = await client.query(
      "SELECT id, name, status, locked_at FROM accounting_fiscal_years WHERE name = $1 LIMIT 1",
      [fiscalYear],
    );

    if (!yearResult.rows.length) {
      throw accountingError(
        `Fiscal year "${fiscalYear}" does not exist. Create it before posting transactions.`,
        404,
      );
    }

    const year = yearResult.rows[0];
    if (year.status === "closed" || year.locked_at) {
      throw accountingError("This fiscal year is closed and cannot accept new postings", 409);
    }

    return { fiscalYear, year };
  }

  async _requireFiscalYear(client, fiscalYear) {
    const result = await client.query(
      "SELECT id, name, status, locked_at FROM accounting_fiscal_years WHERE name = $1 LIMIT 1",
      [fiscalYear],
    );
    if (!result.rows.length) {
      throw accountingError(
        `Fiscal year "${fiscalYear}" does not exist. Create it before running reports.`,
        404,
      );
    }
    return result.rows[0];
  }

  async _assertFiscalYearBalanced(client, fiscalYear) {
    const result = await client.query(
      `SELECT
         COALESCE(SUM(l.debit), 0) AS total_debit,
         COALESCE(SUM(l.credit), 0) AS total_credit
       FROM accounting_journal_lines l
       JOIN accounting_journals j ON j.id = l.journal_id
       WHERE j.status = 'posted' AND j.fiscal_year = $1`,
      [fiscalYear],
    );

    const totalDebit = Number(result.rows[0]?.total_debit || 0);
    const totalCredit = Number(result.rows[0]?.total_credit || 0);

    if (Math.abs(totalDebit - totalCredit) > 0.005) {
      throw accountingError(
        `Trial balance is out of balance for fiscal year "${fiscalYear}"`,
        409,
      );
    }

    return { totalDebit, totalCredit };
  }

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
        is_active BOOLEAN NOT NULL DEFAULT FALSE,
        locked_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS accounting_journals (
        id SERIAL PRIMARY KEY,
        journal_number VARCHAR(40) NOT NULL UNIQUE,
        idempotency_key VARCHAR(180),
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
      CREATE SEQUENCE IF NOT EXISTS accounting_journal_number_seq;
      CREATE TABLE IF NOT EXISTS accounting_payment_gateways (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        provider VARCHAR(50) NOT NULL,
        merchant_id VARCHAR(150),
        api_key VARCHAR(255),
        api_secret VARCHAR(255),
        webhook_url TEXT,
        mode VARCHAR(20) NOT NULL DEFAULT 'sandbox' CHECK (mode IN ('sandbox','live')),
        is_active BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS accounting_gateway_transactions (
        id SERIAL PRIMARY KEY,
        gateway_id INTEGER NOT NULL REFERENCES accounting_payment_gateways(id),
        external_id VARCHAR(180) NOT NULL,
        idempotency_key VARCHAR(180) NOT NULL,
        amount NUMERIC(14,2) NOT NULL,
        payment_mode VARCHAR(40),
        status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','success','failed','refunded','reconciled')),
        journal_id INTEGER REFERENCES accounting_journals(id),
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (gateway_id, external_id),
        UNIQUE (idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS accounting_bank_accounts (
        id SERIAL PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        account_number_masked VARCHAR(50),
        ledger_account_id INTEGER REFERENCES accounting_accounts(id),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS accounting_bank_statements (
        id SERIAL PRIMARY KEY,
        bank_account_id INTEGER NOT NULL REFERENCES accounting_bank_accounts(id),
        transaction_date DATE NOT NULL,
        reference VARCHAR(180),
        description TEXT,
        amount NUMERIC(14,2) NOT NULL,
        direction VARCHAR(10) NOT NULL CHECK (direction IN ('debit','credit')),
        status VARCHAR(20) NOT NULL DEFAULT 'unmatched' CHECK (status IN ('unmatched','matched','reconciled')),
        journal_id INTEGER REFERENCES accounting_journals(id),
        imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (bank_account_id, transaction_date, reference, amount, direction)
      );
      CREATE INDEX IF NOT EXISTS idx_accounting_journals_date ON accounting_journals(journal_date);
      CREATE INDEX IF NOT EXISTS idx_accounting_journals_fiscal_year ON accounting_journals(fiscal_year);
      CREATE INDEX IF NOT EXISTS idx_accounting_journal_lines_account ON accounting_journal_lines(account_id);
      CREATE INDEX IF NOT EXISTS idx_accounting_vouchers_date ON accounting_vouchers(voucher_date);
      CREATE INDEX IF NOT EXISTS idx_accounting_vouchers_status ON accounting_vouchers(status);
      CREATE INDEX IF NOT EXISTS idx_accounting_gateway_transactions_status ON accounting_gateway_transactions(status);
      CREATE INDEX IF NOT EXISTS idx_accounting_bank_statements_status ON accounting_bank_statements(status);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_accounting_journal_source
        ON accounting_journals(source_type, source_id)
        WHERE source_type IS NOT NULL AND source_id IS NOT NULL;
      ALTER TABLE IF EXISTS accounting_journals ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(180);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_accounting_journal_idempotency
        ON accounting_journals(idempotency_key)
        WHERE idempotency_key IS NOT NULL;
      ALTER TABLE IF EXISTS accounting_fiscal_years ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'open';
      ALTER TABLE IF EXISTS accounting_fiscal_years ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE IF EXISTS accounting_fiscal_years ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP;
      ALTER TABLE IF EXISTS accounting_journals ADD COLUMN IF NOT EXISTS fiscal_year VARCHAR(20);
      ALTER TABLE IF EXISTS accounting_vouchers ADD COLUMN IF NOT EXISTS fiscal_year VARCHAR(20);
      CREATE TABLE IF NOT EXISTS accounting_configuration (
        id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1), legal_name VARCHAR(255), address TEXT,
        pan_number VARCHAR(100), vat_number VARCHAR(100), phone VARCHAR(100), email VARCHAR(255),
        logo_url TEXT, letterhead_url TEXT, currency VARCHAR(10) NOT NULL DEFAULT 'NPR',
        decimal_places SMALLINT NOT NULL DEFAULT 2, fiscal_year_format VARCHAR(30) NOT NULL DEFAULT 'BS',
        calendar_type VARCHAR(2) NOT NULL DEFAULT 'BS',
        active_fiscal_year VARCHAR(20), approval_required BOOLEAN NOT NULL DEFAULT FALSE,
        approval_threshold NUMERIC(14,2) NOT NULL DEFAULT 0, cash_account_id INTEGER,
        bank_account_id INTEGER, gateway_clearing_account_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO accounting_configuration (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
      ALTER TABLE IF EXISTS accounting_configuration ADD COLUMN IF NOT EXISTS calendar_type VARCHAR(2) NOT NULL DEFAULT 'BS';
      ALTER TABLE IF EXISTS accounting_configuration ADD COLUMN IF NOT EXISTS active_fiscal_year VARCHAR(20);
      ALTER TABLE IF EXISTS accounting_configuration ADD COLUMN IF NOT EXISTS approval_required BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE IF EXISTS accounting_configuration ADD COLUMN IF NOT EXISTS approval_threshold NUMERIC(14,2) NOT NULL DEFAULT 0;
      ALTER TABLE IF EXISTS accounting_configuration ADD COLUMN IF NOT EXISTS cash_account_id INTEGER;
      ALTER TABLE IF EXISTS accounting_configuration ADD COLUMN IF NOT EXISTS bank_account_id INTEGER;
      ALTER TABLE IF EXISTS accounting_configuration ADD COLUMN IF NOT EXISTS gateway_clearing_account_id INTEGER;
      CREATE TABLE IF NOT EXISTS accounting_tax_rules (
        id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL UNIQUE, tax_type VARCHAR(40) NOT NULL,
        rate NUMERIC(12,4) NOT NULL DEFAULT 0, rate_kind VARCHAR(10) NOT NULL DEFAULT 'percentage',
        inclusive BOOLEAN NOT NULL DEFAULT FALSE, account_id INTEGER, is_active BOOLEAN NOT NULL DEFAULT TRUE,
        effective_from DATE, effective_to DATE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS accounting_cost_centers (
        id SERIAL PRIMARY KEY, code VARCHAR(40) NOT NULL UNIQUE, name VARCHAR(150) NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS accounting_voucher_numbering (
        id SERIAL PRIMARY KEY, voucher_type VARCHAR(20) NOT NULL UNIQUE, prefix VARCHAR(20) NOT NULL,
        next_number INTEGER NOT NULL DEFAULT 1, fiscal_year_based BOOLEAN NOT NULL DEFAULT TRUE, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO accounting_voucher_numbering (voucher_type, prefix) VALUES
        ('receipt','RV'), ('payment','PV'), ('contra','CV'), ('journal','JV'), ('sales','SV'), ('purchase','PU')
      ON CONFLICT (voucher_type) DO NOTHING;
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
      [
        payload.code.trim(),
        payload.name.trim(),
        payload.account_type,
        payload.parent_id || null,
      ],
    );
    return result.rows[0];
  }

  async updateAccount(id, payload, req) {
    await this.ensureTables(req.tenantPool);
    const fields = [];
    const values = [];
    for (const key of ["name", "account_type", "parent_id", "is_active"]) {
      if (payload[key] !== undefined) {
        values.push(
          key === "name" ? String(payload[key]).trim() : payload[key],
        );
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
    const idempotencyKey = payload.idempotency_key || meta.idempotencyKey;
    if (lines.length < 2)
      throw accountingError("A journal needs at least two lines");
    const normalizedLines = lines.map((line) => ({
      ...line,
      debitCents: moneyToCents(line.debit || 0),
      creditCents: moneyToCents(line.credit || 0),
    }));
    const totalDebit = normalizedLines.reduce(
      (sum, line) => sum + (line.debitCents || 0n),
      0n,
    );
    const totalCredit = normalizedLines.reduce(
      (sum, line) => sum + (line.creditCents || 0n),
      0n,
    );
    if (totalDebit <= 0n || totalDebit !== totalCredit) {
      throw accountingError("Journal debits and credits must balance");
    }

    const resolvedYear = await this._resolveConfiguredFiscalYear(
      client,
      payload.fiscal_year,
    );
    const fiscalYear = resolvedYear.fiscalYear;
    const invalidLine = normalizedLines.some((line) => {
      const debit = line.debitCents;
      const credit = line.creditCents;
      return (
        !line.account_id ||
        debit === null ||
        credit === null ||
        (debit === 0n && credit === 0n) ||
        (debit > 0n && credit > 0n)
      );
    });
    if (invalidLine)
      throw accountingError(
        "Each journal line must have one positive debit or credit",
      );

    const fiscalYearStatus = await client.query(
      "SELECT status, locked_at FROM accounting_fiscal_years WHERE name = $1",
      [fiscalYear],
    );
    if (
      fiscalYearStatus.rows[0]?.status === "closed" ||
      fiscalYearStatus.rows[0]?.locked_at
    ) {
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
    if (idempotencyKey) {
      const existing = await client.query(
        "SELECT id FROM accounting_journals WHERE idempotency_key = $1 FOR UPDATE",
        [String(idempotencyKey)],
      );
      if (existing.rows[0]) return this._journalWithLines(client, existing.rows[0].id);
    }
    if (payload.source_type && payload.source_id) {
      const existing = await client.query(
        "SELECT id FROM accounting_journals WHERE source_type = $1 AND source_id = $2 FOR UPDATE",
        [payload.source_type, String(payload.source_id)],
      );
      if (existing.rows[0]) return this._journalWithLines(client, existing.rows[0].id);
    }
    const sequence = await client.query(
      "SELECT nextval('accounting_journal_number_seq') AS next_number",
    );
    const journalNumber =
      payload.journal_number ||
      `JNL-${new Date().getFullYear()}-${String(sequence.rows[0].next_number).padStart(8, "0")}`;
    const journal = await client.query(
      `INSERT INTO accounting_journals
        (journal_number, idempotency_key, journal_date, description, fiscal_year, source_type, source_id, created_by)
       VALUES ($1, $2, COALESCE($3, CURRENT_DATE), $4, $5, $6, $7, $8) RETURNING *`,
      [
        journalNumber,
        idempotencyKey ? String(idempotencyKey) : null,
        payload.journal_date || null,
        payload.description || payload.particulars || null,
        fiscalYear,
        payload.source_type || null,
        payload.source_id || null,
        meta.createdBy || null,
      ],
    );
    for (const line of normalizedLines) {
      await client.query(
        `INSERT INTO accounting_journal_lines (journal_id, account_id, description, debit, credit)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          journal.rows[0].id,
          line.account_id,
          line.description || null,
          centsToMoney(line.debitCents),
          centsToMoney(line.creditCents),
        ],
      );
    }
    return this._journalWithLines(client, journal.rows[0].id);
  }

  async createVoucher(payload, req) {
    await this.ensureTables(req.tenantPool);
    const lines = Array.isArray(payload.lines) ? payload.lines : [];
    if (!payload.voucher_type || !lines.length)
      throw accountingError("Voucher type and lines are required");
    const voucherType = String(payload.voucher_type).toLowerCase();
    if (
      ![
        "receipt",
        "payment",
        "contra",
        "sales",
        "purchase",
        "journal",
      ].includes(voucherType)
    ) {
      throw accountingError("Unsupported voucher type");
    }
    const year = new Date().getFullYear();
    const prefix = voucherType.slice(0, 2).toUpperCase();
    return this.withTransaction(req.tenantPool, async (client) => {
      const sequence = await client.query(
        "SELECT nextval('accounting_voucher_number_seq') AS next_number",
      );
      const number = `${prefix}-${year}-${String(sequence.rows[0].next_number).padStart(4, "0")}`;
      const voucher = await client.query(
        `INSERT INTO accounting_vouchers (voucher_number, voucher_type, voucher_date, narration, fiscal_year, created_by)
         VALUES ($1, $2, COALESCE($3, CURRENT_DATE), $4, $5, $6) RETURNING *`,
        [
          number,
          voucherType,
          payload.voucher_date || null,
          payload.narration || null,
          payload.fiscal_year || currentFiscalYear(),
          req.user?.id || null,
        ],
      );
      for (const line of lines) {
        await client.query(
          `INSERT INTO accounting_voucher_lines (voucher_id, account_id, description, debit, credit)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            voucher.rows[0].id,
            line.account_id,
            line.description || null,
            line.debit || 0,
            line.credit || 0,
          ],
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
    if (filters.status) {
      values.push(filters.status);
      where.push(`v.status = $${values.length}`);
    }
    if (filters.voucher_type) {
      values.push(filters.voucher_type);
      where.push(`v.voucher_type = $${values.length}`);
    }
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
      if (voucher.status !== "draft")
        throw accountingError("Only draft vouchers can be posted", 409);
      const journal = await this.postJournal(
        client,
        {
          journal_date: voucher.voucher_date,
          description: voucher.narration || voucher.voucher_number,
          fiscal_year: voucher.fiscal_year,
          source_type: "accounting_voucher",
          source_id: String(voucher.id),
          lines: voucher.lines,
        },
        { createdBy: req.user?.id },
      );
      const updated = await client.query(
        `UPDATE accounting_vouchers SET status = 'posted', journal_id = $1, posted_by = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *`,
        [journal.id, req.user?.id || null, id],
      );
      return { ...updated.rows[0], journal };
    });
  }

  async listGateways(req) {
    await this.ensureTables(req.tenantPool);
    const result = await req.tenantPool.query(
      `SELECT id, name, provider, merchant_id, webhook_url, mode, is_active, created_at, updated_at
       FROM accounting_payment_gateways ORDER BY name`,
    );
    return result.rows;
  }

  async saveGateway(payload, req) {
    await this.ensureTables(req.tenantPool);
    if (!payload.name || !payload.provider)
      throw accountingError("Gateway name and provider are required");
    const result = await req.tenantPool.query(
      `INSERT INTO accounting_payment_gateways
        (name, provider, merchant_id, api_key, api_secret, webhook_url, mode, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (name) DO UPDATE SET provider = EXCLUDED.provider,
        merchant_id = EXCLUDED.merchant_id, api_key = COALESCE(EXCLUDED.api_key, accounting_payment_gateways.api_key),
        api_secret = COALESCE(EXCLUDED.api_secret, accounting_payment_gateways.api_secret),
        webhook_url = EXCLUDED.webhook_url, mode = EXCLUDED.mode, is_active = EXCLUDED.is_active,
        updated_at = CURRENT_TIMESTAMP
       RETURNING id, name, provider, merchant_id, webhook_url, mode, is_active, created_at, updated_at`,
      [
        payload.name.trim(),
        payload.provider.trim(),
        payload.merchant_id || null,
        payload.api_key || null,
        payload.api_secret || null,
        payload.webhook_url || null,
        payload.mode || "sandbox",
        payload.is_active === true,
      ],
    );
    return result.rows[0];
  }

  async listGatewayTransactions(filters, req) {
    await this.ensureTables(req.tenantPool);
    const values = [];
    const where = [];
    if (filters.status) {
      values.push(filters.status);
      where.push(`t.status = $${values.length}`);
    }
    const result = await req.tenantPool.query(
      `SELECT t.id, t.external_id, t.amount, t.payment_mode, t.status, t.created_at,
        g.name AS gateway_name FROM accounting_gateway_transactions t
       JOIN accounting_payment_gateways g ON g.id = t.gateway_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY t.created_at DESC LIMIT 100`,
      values,
    );
    return result.rows;
  }

  async updateGatewayTransaction(payload, req) {
    await this.ensureTables(req.tenantPool);
    if (
      !payload.gateway_id ||
      !payload.external_id ||
      !payload.idempotency_key ||
      Number(payload.amount) <= 0
    ) {
      throw accountingError(
        "Gateway, external ID, idempotency key, and positive amount are required",
      );
    }
    return this.withTransaction(req.tenantPool, async (client) => {
      const existing = await client.query(
        "SELECT * FROM accounting_gateway_transactions WHERE idempotency_key = $1 FOR UPDATE",
        [payload.idempotency_key],
      );
      if (existing.rows[0]) return existing.rows[0];
      const transaction = await client.query(
        `INSERT INTO accounting_gateway_transactions (gateway_id, external_id, idempotency_key, amount, payment_mode, status, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          payload.gateway_id,
          payload.external_id,
          payload.idempotency_key,
          payload.amount,
          payload.payment_mode || null,
          payload.status || "pending",
          payload.payload || {},
        ],
      );
      if (transaction.rows[0].status === "success") {
        const accounts = await client.query(
          "SELECT id, code FROM accounting_accounts WHERE code = ANY($1)",
          [["1020", "4000"]],
        );
        const ids = Object.fromEntries(
          accounts.rows.map((row) => [row.code, row.id]),
        );
        if (!ids["1020"] || !ids["4000"])
          throw accountingError(
            "Gateway clearing accounts are not configured",
            500,
          );
        const journal = await this.postJournal(
          client,
          {
            description: `Gateway payment ${payload.external_id}`,
            source_type: "payment_gateway",
            source_id: String(transaction.rows[0].id),
            lines: [
              { account_id: ids["1020"], debit: payload.amount, credit: 0 },
              { account_id: ids["4000"], debit: 0, credit: payload.amount },
            ],
          },
          { createdBy: req.user?.id },
        );
        await client.query(
          "UPDATE accounting_gateway_transactions SET journal_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
          [journal.id, transaction.rows[0].id],
        );
        transaction.rows[0].journal_id = journal.id;
      }
      return transaction.rows[0];
    });
  }

  async listBankStatements(filters, req) {
    await this.ensureTables(req.tenantPool);
    const result = await req.tenantPool.query(
      `SELECT s.*, b.name AS bank_account_name FROM accounting_bank_statements s
       JOIN accounting_bank_accounts b ON b.id = s.bank_account_id
       WHERE ($1::text IS NULL OR s.status = $1) ORDER BY s.transaction_date DESC LIMIT 200`,
      [filters.status || null],
    );
    return result.rows;
  }

  async createBankAccount(payload, req) {
    await this.ensureTables(req.tenantPool);
    if (!payload.name) throw accountingError("Bank account name is required");
    const result = await req.tenantPool.query(
      `INSERT INTO accounting_bank_accounts (name, account_number_masked, ledger_account_id) VALUES ($1,$2,$3) RETURNING *`,
      [
        payload.name.trim(),
        payload.account_number_masked || null,
        payload.ledger_account_id || null,
      ],
    );
    return result.rows[0];
  }

  async importBankStatement(payload, req) {
    await this.ensureTables(req.tenantPool);
    if (!payload.bank_account_id || !Array.isArray(payload.entries))
      throw accountingError("Bank account and statement entries are required");
    return this.withTransaction(req.tenantPool, async (client) => {
      let imported = 0;
      for (const entry of payload.entries) {
        if (
          !entry.transaction_date ||
          !entry.reference ||
          Number(entry.amount) <= 0 ||
          !["debit", "credit"].includes(entry.direction)
        )
          continue;
        const result = await client.query(
          `INSERT INTO accounting_bank_statements (bank_account_id, transaction_date, reference, description, amount, direction)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
          [
            payload.bank_account_id,
            entry.transaction_date,
            entry.reference,
            entry.description || null,
            entry.amount,
            entry.direction,
          ],
        );
        imported += result.rowCount;
      }
      return { imported };
    });
  }

  async postLegacyTransaction(client, payload, sourceId, req) {
    const mode = payload.payment_mode === "bank" ? "1010" : "1000";
    const type = payload.txn_type === "income" ? "income" : "expense";
    const debitCode =
      type === "income"
        ? mode
        : payload.category === "Staff Salaries"
          ? "5100"
          : "5000";
    const creditCode = type === "income" ? "4000" : mode;
    const accounts = await client.query(
      "SELECT id, code FROM accounting_accounts WHERE code = ANY($1)",
      [[debitCode, creditCode]],
    );
    const ids = Object.fromEntries(
      accounts.rows.map((row) => [row.code, row.id]),
    );
    if (!ids[debitCode] || !ids[creditCode]) {
      throw accountingError(
        "Default accounting accounts are not configured",
        500,
      );
    }
    const existing = await client.query(
      "SELECT id FROM accounting_journals WHERE source_type = $1 AND source_id = $2",
      ["accounts_transaction", String(sourceId)],
    );
    if (existing.rows.length)
      return this._journalWithLines(client, existing.rows[0].id);
    return this.postJournal(
      client,
      {
        journal_date: payload.txn_date,
        description: payload.particulars || "Accounts transaction",
        fiscal_year: payload.fiscal_year,
        source_type: "accounts_transaction",
        source_id: String(sourceId),
        lines: [
          { account_id: ids[debitCode], debit: payload.amount, credit: 0 },
          { account_id: ids[creditCode], debit: 0, credit: payload.amount },
        ],
      },
      { createdBy: req.user?.id },
    );
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
    if (filters.fiscal_year) {
      params.push(filters.fiscal_year);
      where.push(`j.fiscal_year = $${params.length}`);
    }
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
    const fiscalYear = filters.fiscal_year || currentFiscalYear();
    await this._requireFiscalYear(req.tenantPool, fiscalYear);

    const params = [fiscalYear];
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
    await this._requireFiscalYear(req.tenantPool, fiscalYear);
    await this._assertFiscalYearBalanced(req.tenantPool, fiscalYear);

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
    if (
      !["profit-loss", "income-statement", "balance-sheet"].includes(report)
    ) {
      throw accountingError("Unknown financial report", 404);
    }
    const accounts =
      report === "balance-sheet"
        ? trialBalance.accounts.filter((account) =>
            ["asset", "liability", "equity"].includes(account.account_type),
          )
        : trialBalance.accounts.filter((account) =>
            ["income", "expense"].includes(account.account_type),
          );
    return { report, fiscal_year: trialBalance.fiscal_year, accounts };
  }

  async listFiscalYears(req) {
    await this.ensureTables(req.tenantPool);
    const result = await req.tenantPool.query(
      "SELECT * FROM accounting_fiscal_years ORDER BY name DESC",
    );
    return result.rows;
  }

  async setActiveFiscalYear(id, req) {
    await this.ensureTables(req.tenantPool);
    return this.withTransaction(req.tenantPool, async (client) => {
      const target = await client.query(
        "SELECT * FROM accounting_fiscal_years WHERE id = $1 FOR UPDATE",
        [id],
      );
      if (!target.rows.length)
        throw accountingError("Fiscal year not found", 404);
      if (target.rows[0].status === "closed" || target.rows[0].locked_at)
        throw accountingError("Closed fiscal years cannot be activated", 409);
      await client.query(
        "UPDATE accounting_fiscal_years SET is_active = FALSE",
      );
      const result = await client.query(
        "UPDATE accounting_fiscal_years SET is_active = TRUE WHERE id = $1 RETURNING *",
        [id],
      );
      await client.query(
        "UPDATE accounting_configuration SET active_fiscal_year = $1, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
        [target.rows[0].name],
      );
      return result.rows[0];
    });
  }

  async lockFiscalYear(id, req) {
    await this.ensureTables(req.tenantPool);
    const result = await req.tenantPool.query(
      "UPDATE accounting_fiscal_years SET locked_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'open' RETURNING *",
      [id],
    );
    if (!result.rows.length)
      throw accountingError("Open fiscal year not found", 404);
    return result.rows[0];
  }

  async getConfiguration(req) {
    await this.ensureTables(req.tenantPool);
    const [configuration, taxes, centers, numbering, years] = await Promise.all(
      [
        req.tenantPool.query(
          "SELECT * FROM accounting_configuration WHERE id = 1",
        ),
        req.tenantPool.query(
          "SELECT * FROM accounting_tax_rules ORDER BY name",
        ),
        req.tenantPool.query(
          "SELECT * FROM accounting_cost_centers ORDER BY name",
        ),
        req.tenantPool.query(
          "SELECT * FROM accounting_voucher_numbering ORDER BY voucher_type",
        ),
        req.tenantPool.query(
          "SELECT * FROM accounting_fiscal_years ORDER BY name DESC",
        ),
      ],
    );
    return {
      general: configuration.rows[0] || {},
      taxes: taxes.rows,
      cost_centers: centers.rows,
      numbering: numbering.rows,
      fiscal_years: years.rows,
    };
  }

  async updateConfiguration(payload, req) {
    await this.ensureTables(req.tenantPool);
    const allowed = [
      "legal_name",
      "address",
      "pan_number",
      "vat_number",
      "phone",
      "email",
      "logo_url",
      "letterhead_url",
      "currency",
      "decimal_places",
      "fiscal_year_format",
      "calendar_type",
      "approval_required",
      "approval_threshold",
      "cash_account_id",
      "bank_account_id",
      "gateway_clearing_account_id",
    ];
    if (
      payload.calendar_type !== undefined &&
      !["AD", "BS"].includes(payload.calendar_type)
    ) {
      throw accountingError("Accounting calendar must be AD or BS");
    }
    const values = [];
    const fields = [];
    for (const key of allowed)
      if (payload[key] !== undefined) {
        values.push(payload[key]);
        fields.push(`${key} = $${values.length}`);
      }
    if (fields.length)
      await req.tenantPool.query(
        `UPDATE accounting_configuration SET ${fields.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = 1`,
        values,
      );
    return this.getConfiguration(req);
  }

  async createTaxRule(payload, req) {
    await this.ensureTables(req.tenantPool);
    if (!payload.name || !payload.tax_type || Number(payload.rate) < 0)
      throw accountingError("Tax name, type, and valid rate are required");
    const result = await req.tenantPool.query(
      "INSERT INTO accounting_tax_rules (name, tax_type, rate, rate_kind, inclusive, account_id, effective_from, effective_to) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
      [
        payload.name.trim(),
        payload.tax_type,
        payload.rate,
        payload.rate_kind || "percentage",
        payload.inclusive === true,
        payload.account_id || null,
        payload.effective_from || null,
        payload.effective_to || null,
      ],
    );
    return result.rows[0];
  }

  async createCostCenter(payload, req) {
    await this.ensureTables(req.tenantPool);
    if (!payload.code || !payload.name)
      throw accountingError("Cost center code and name are required");
    const result = await req.tenantPool.query(
      "INSERT INTO accounting_cost_centers (code, name) VALUES ($1,$2) RETURNING *",
      [payload.code.trim(), payload.name.trim()],
    );
    return result.rows[0];
  }

  async createFiscalYear(payload, req) {
    await this.ensureTables(req.tenantPool);
    const name = String(payload.name || payload.fiscal_year || "").trim();
    if (!name) throw accountingError("Fiscal year name is required");
    if (
      !payload.starts_on ||
      !payload.ends_on ||
      payload.starts_on > payload.ends_on
    )
      throw accountingError("A valid fiscal year date range is required");
    const overlap = await req.tenantPool.query(
      "SELECT id FROM accounting_fiscal_years WHERE starts_on <= $2::date AND ends_on >= $1::date LIMIT 1",
      [payload.starts_on, payload.ends_on],
    );
    if (overlap.rows.length)
      throw accountingError(
        "Fiscal year overlaps an existing fiscal year",
        409,
      );
    const result = await req.tenantPool.query(
      `INSERT INTO accounting_fiscal_years (name, starts_on, ends_on) VALUES ($1, $2, $3) RETURNING *`,
      [name, payload.starts_on || null, payload.ends_on || null],
    );

    const config = await req.tenantPool.query(
      "SELECT active_fiscal_year FROM accounting_configuration WHERE id = 1 LIMIT 1",
    );
    if (!config.rows[0]?.active_fiscal_year) {
      await req.tenantPool.query(
        "UPDATE accounting_configuration SET active_fiscal_year = $1, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
        [name],
      );
    }

    return result.rows[0];
  }

  async closeFiscalYear(id, req) {
    await this.ensureTables(req.tenantPool);
    const result = await req.tenantPool.query(
      "UPDATE accounting_fiscal_years SET status = 'closed' WHERE id = $1 RETURNING *",
      [id],
    );
    if (!result.rows.length)
      throw accountingError("Fiscal year not found", 404);
    return result.rows[0];
  }

  async voidJournal(id, reason, req) {
    await this.ensureTables(req.tenantPool);
    if (!reason?.trim()) throw accountingError("A void reason is required");
    const result = await req.tenantPool.query(
      "UPDATE accounting_journals SET status = 'void', void_reason = $1 WHERE id = $2 AND status = 'posted' RETURNING *",
      [reason || null, id],
    );
    if (!result.rows.length)
      throw accountingError("Posted journal not found", 404);
    return result.rows[0];
  }

  async reverseJournal(id, reason, req) {
    await this.ensureTables(req.tenantPool);
    if (!reason?.trim()) throw accountingError("A reversal reason is required");
    return this.withTransaction(req.tenantPool, async (client) => {
      const original = await client.query(
        "SELECT * FROM accounting_journals WHERE id = $1 AND status = 'posted'",
        [id],
      );
      if (!original.rows.length)
        throw accountingError("Posted journal not found", 404);
      const lines = await client.query(
        "SELECT * FROM accounting_journal_lines WHERE journal_id = $1 ORDER BY id",
        [id],
      );
      const reversal = await this.postJournal(
        client,
        {
          description:
            reason || `Reversal of ${original.rows[0].journal_number}`,
          fiscal_year: original.rows[0].fiscal_year,
          source_type: "journal_reversal",
          source_id: String(id),
          lines: lines.rows.map((line) => ({
            account_id: line.account_id,
            debit: line.credit,
            credit: line.debit,
          })),
        },
        { createdBy: req.user?.id },
      );
      await client.query(
        "UPDATE accounting_journals SET status = 'reversed', reversed_from_id = $1 WHERE id = $2",
        [reversal.id, id],
      );
      return reversal;
    });
  }
}

module.exports = new AccountingService();
