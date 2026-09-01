/**
 * Accounts Service
 * Handles all financial overview, transactions, expenses, and payroll queries.
 * Uses req.tenantPool — the per-tenant PostgreSQL pool injected by middleware.
 */

class AccountsService {
  // ── helpers ──────────────────────────────────────────────────────────────

  /** Returns the current BS fiscal year label, e.g. "2082/83" */
  _currentFiscalYear() {
    const now = new Date();
    // Nepali fiscal year starts mid-July (roughly). Simple heuristic:
    const month = now.getMonth() + 1; // 1–12
    const year  = now.getFullYear();
    const nepYear = year - 57; // approximate AD→BS offset
    if (month >= 7) return `${nepYear}/${String(nepYear + 1).slice(-2)}`;
    return `${nepYear - 1}/${String(nepYear).slice(-2)}`;
  }

  // ── ensure tables exist (graceful fallback for tenants not yet migrated) ─

  async _ensureTables(db) {
    await db.query(`
      CREATE TABLE IF NOT EXISTS accounts_expense_categories (
        id   SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        color VARCHAR(20) DEFAULT '#6366f1',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO accounts_expense_categories (name, color) VALUES
        ('Staff Salaries',           '#6366f1'),
        ('Utilities',                '#f59e0b'),
        ('Transport & Maintenance',  '#10b981'),
        ('Supplies & Materials',     '#f43f5e'),
        ('Other',                    '#94a3b8')
      ON CONFLICT (name) DO NOTHING;

      CREATE TABLE IF NOT EXISTS accounts_transactions (
        id            SERIAL PRIMARY KEY,
        txn_date      DATE          NOT NULL DEFAULT CURRENT_DATE,
        particulars   VARCHAR(255)  NOT NULL,
        sub_text      VARCHAR(255),
        category      VARCHAR(100)  NOT NULL,
        txn_type      VARCHAR(10)   NOT NULL CHECK (txn_type IN ('income','expense')),
        amount        NUMERIC(14,2) NOT NULL,
        payment_mode  VARCHAR(50)   DEFAULT 'cash',
        status        VARCHAR(20)   DEFAULT 'paid',
        reference_id  VARCHAR(100),
        student_id    INTEGER,
        expense_category_id INTEGER REFERENCES accounts_expense_categories(id) ON DELETE SET NULL,
        fiscal_year   VARCHAR(20),
        notes         TEXT,
        created_by    UUID,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS accounts_payroll (
        id             SERIAL PRIMARY KEY,
        employee_id    UUID          NOT NULL,
        employee_name  VARCHAR(255)  NOT NULL,
        employee_type  VARCHAR(50)   DEFAULT 'staff',
        fiscal_year    VARCHAR(20),
        pay_month      VARCHAR(20),
        basic_salary   NUMERIC(14,2) NOT NULL DEFAULT 0,
        allowances     NUMERIC(14,2) DEFAULT 0,
        deductions     NUMERIC(14,2) DEFAULT 0,
        net_salary     NUMERIC(14,2) GENERATED ALWAYS AS (basic_salary + allowances - deductions) STORED,
        payment_date   DATE,
        payment_mode   VARCHAR(50)   DEFAULT 'bank',
        status         VARCHAR(20)   DEFAULT 'pending',
        notes          TEXT,
        created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  // ── Overview (dashboard cards + stats) ───────────────────────────────────

  async getOverview(filters, req) {
    const db = req.tenantPool;
    await this._ensureTables(db);

    const fiscalYear = filters.fiscal_year || this._currentFiscalYear();

    // Total income (fee_receipts + accounts_transactions income)
    const [incomeRes, expenseRes, feeRes, studentBilledRes, overdueRes,
           staffRes, scholarshipRes, prevIncomeRes] = await Promise.all([

      // Income from accounts_transactions this fiscal year
      db.query(`
        SELECT COALESCE(SUM(amount),0) AS total
        FROM accounts_transactions
        WHERE txn_type = 'income' AND fiscal_year = $1
      `, [fiscalYear]),

      // Expenses this fiscal year
      db.query(`
        SELECT COALESCE(SUM(amount),0) AS total
        FROM accounts_transactions
        WHERE txn_type = 'expense' AND fiscal_year = $1
      `, [fiscalYear]),

      // Total fee collected all time (from fee_receipts if table exists)
      db.query(`
        SELECT COALESCE(SUM(total_amount),0) AS total
        FROM fee_receipts
        WHERE status = 'active'
      `).catch(() => ({ rows: [{ total: 0 }] })),

      // Students billed
      db.query(`SELECT COUNT(DISTINCT student_id) AS cnt FROM student_fees`)
        .catch(() => ({ rows: [{ cnt: 0 }] })),

      // Overdue payments
      db.query(`
        SELECT COUNT(*) AS cnt,
               ROUND(AVG(CURRENT_DATE - due_date)) AS avg_days
        FROM student_fees
        WHERE status = 'unpaid' AND due_date < CURRENT_DATE
      `).catch(() => ({ rows: [{ cnt: 0, avg_days: 0 }] })),

      // Staff on payroll
      db.query(`SELECT COUNT(DISTINCT employee_id) AS cnt FROM accounts_payroll WHERE fiscal_year = $1`, [fiscalYear])
        .catch(() => ({ rows: [{ cnt: 0 }] })),

      // Scholarships / concessions
      db.query(`
        SELECT COUNT(*) AS cnt, COALESCE(SUM(concession_amount),0) AS total
        FROM student_fees
        WHERE concession_amount > 0
      `).catch(() => ({ rows: [{ cnt: 0, total: 0 }] })),

      // Previous period income (for trend — same fiscal year, last 30 days)
      db.query(`
        SELECT COALESCE(SUM(amount),0) AS total
        FROM accounts_transactions
        WHERE txn_type = 'income'
          AND fiscal_year = $1
          AND txn_date < CURRENT_DATE - INTERVAL '30 days'
      `, [fiscalYear]),
    ]);

    const totalIncome   = parseFloat(incomeRes.rows[0].total);
    const totalExpense  = parseFloat(expenseRes.rows[0].total);
    const feesCollected = parseFloat(feeRes.rows[0].total);
    const balanceInHand = totalIncome - totalExpense;

    // Fee outstanding
    const outstandingRes = await db.query(`
      SELECT COALESCE(SUM(balance),0) AS total FROM student_fees WHERE status != 'paid'
    `).catch(() => ({ rows: [{ total: 0 }] }));

    // Fee collection % this term
    const billedRes = await db.query(`
      SELECT COALESCE(SUM(amount - concession_amount),0) AS total FROM student_fees
    `).catch(() => ({ rows: [{ total: 0 }] }));

    const feeBilled = parseFloat(billedRes.rows[0].total) || 1;
    const collectionPct = Math.round((feesCollected / feeBilled) * 100);

    // This month income vs expense
    const monthRes = await db.query(`
      SELECT
        txn_type,
        COALESCE(SUM(amount),0) AS total
      FROM accounts_transactions
      WHERE txn_date >= date_trunc('month', CURRENT_DATE)
        AND fiscal_year = $1
      GROUP BY txn_type
    `, [fiscalYear]).catch(() => ({ rows: [] }));

    let incomeThisMonth = 0, expenseThisMonth = 0;
    for (const row of monthRes.rows) {
      if (row.txn_type === 'income')  incomeThisMonth  = parseFloat(row.total);
      if (row.txn_type === 'expense') expenseThisMonth = parseFloat(row.total);
    }

    // Trend vs last month
    const prevIncome = parseFloat(prevIncomeRes.rows[0].total) || 0;
    const incomeTrend = totalIncome - prevIncome;

    return {
      fiscal_year:        fiscalYear,
      balance_in_hand:    balanceInHand,
      income_this_month:  incomeThisMonth,
      expense_this_month: expenseThisMonth,
      fees_outstanding:   parseFloat(outstandingRes.rows[0].total),
      fees_collected:     feesCollected,
      income_trend:       incomeTrend,
      collection_pct:     Math.min(collectionPct, 100),
      students_billed:    parseInt(studentBilledRes.rows[0].cnt, 10),
      payments_overdue:   parseInt(overdueRes.rows[0].cnt, 10),
      avg_days_late:      Math.round(parseFloat(overdueRes.rows[0].avg_days || 0)),
      staff_on_payroll:   parseInt(staffRes.rows[0].cnt, 10),
      scholarships_count: parseInt(scholarshipRes.rows[0].cnt, 10),
      scholarships_total: parseFloat(scholarshipRes.rows[0].total),
    };
  }

  // ── Transactions ─────────────────────────────────────────────────────────

  async getTransactions(filters, req) {
    const db = req.tenantPool;
    await this._ensureTables(db);

    const { fiscal_year, txn_type, status, limit = 50, offset = 0 } = filters;
    const fy = fiscal_year || this._currentFiscalYear();

    let where = ['fiscal_year = $1'];
    const params = [fy];

    if (txn_type) {
      params.push(txn_type);
      where.push(`txn_type = $${params.length}`);
    }
    if (status) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }

    params.push(parseInt(limit, 10));
    params.push(parseInt(offset, 10));

    const rows = await db.query(`
      SELECT t.*,
             ec.name  AS expense_category_name,
             ec.color AS expense_category_color
      FROM accounts_transactions t
      LEFT JOIN accounts_expense_categories ec ON t.expense_category_id = ec.id
      WHERE ${where.join(' AND ')}
      ORDER BY t.txn_date DESC, t.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    const countRes = await db.query(`
      SELECT COUNT(*) AS total
      FROM accounts_transactions
      WHERE ${where.slice(0, -2).join(' AND ') || 'fiscal_year = $1'}
    `, params.slice(0, -2));

    return {
      data:  rows.rows,
      total: parseInt(countRes.rows[0].total, 10),
    };
  }

  async createTransaction(payload, req) {
    const db = req.tenantPool;
    await this._ensureTables(db);

    const {
      txn_date, particulars, sub_text, category, txn_type,
      amount, payment_mode, status, reference_id, student_id,
      expense_category_id, fiscal_year, notes,
    } = payload;

    const fy = fiscal_year || this._currentFiscalYear();
    const userId = req.user?.id || null;

    const result = await db.query(`
      INSERT INTO accounts_transactions
        (txn_date, particulars, sub_text, category, txn_type,
         amount, payment_mode, status, reference_id, student_id,
         expense_category_id, fiscal_year, notes, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING *
    `, [
      txn_date || new Date().toISOString().split('T')[0],
      particulars, sub_text || null, category, txn_type,
      amount, payment_mode || 'cash', status || 'paid',
      reference_id || null, student_id || null,
      expense_category_id || null, fy, notes || null, userId,
    ]);

    return result.rows[0];
  }

  async updateTransaction(id, payload, req) {
    const db = req.tenantPool;
    const fields = [];
    const vals   = [];
    const allowed = [
      'txn_date','particulars','sub_text','category','txn_type',
      'amount','payment_mode','status','notes','expense_category_id',
    ];

    for (const key of allowed) {
      if (payload[key] !== undefined) {
        vals.push(payload[key]);
        fields.push(`${key} = $${vals.length}`);
      }
    }

    if (!fields.length) throw new Error('No fields to update');

    vals.push(id);
    const result = await db.query(`
      UPDATE accounts_transactions SET ${fields.join(', ')}, updated_at = NOW()
      WHERE id = $${vals.length} RETURNING *
    `, vals);

    if (!result.rows.length) throw new Error('Transaction not found');
    return result.rows[0];
  }

  async deleteTransaction(id, req) {
    const db = req.tenantPool;
    const result = await db.query(
      'DELETE FROM accounts_transactions WHERE id = $1 RETURNING id', [id]
    );
    if (!result.rows.length) throw new Error('Transaction not found');
    return { deleted: true, id };
  }

  // ── Expense categories ────────────────────────────────────────────────────

  async getExpenseCategories(req) {
    const db = req.tenantPool;
    await this._ensureTables(db);
    const result = await db.query(
      'SELECT * FROM accounts_expense_categories ORDER BY name'
    );
    return result.rows;
  }

  async getExpenseBreakdown(filters, req) {
    const db = req.tenantPool;
    await this._ensureTables(db);

    const fy = filters.fiscal_year || this._currentFiscalYear();

    const result = await db.query(`
      SELECT
        COALESCE(ec.name,  t.category)  AS category,
        COALESCE(ec.color, '#94a3b8')   AS color,
        COALESCE(SUM(t.amount), 0)       AS total
      FROM accounts_transactions t
      LEFT JOIN accounts_expense_categories ec ON t.expense_category_id = ec.id
      WHERE t.txn_type = 'expense' AND t.fiscal_year = $1
      GROUP BY ec.name, t.category, ec.color
      ORDER BY total DESC
    `, [fy]);

    return result.rows;
  }

  // ── Collection by class ───────────────────────────────────────────────────

  async getCollectionByClass(filters, req) {
    const db = req.tenantPool;

    const result = await db.query(`
      SELECT
        c.name                                        AS class_name,
        COALESCE(SUM(sf.amount - sf.concession_amount), 0) AS billed,
        COALESCE(SUM(sf.paid_amount), 0)               AS collected
      FROM student_fees sf
      JOIN students s  ON sf.student_id = s.id
      JOIN classrooms c ON s.classroom_id = c.id
      GROUP BY c.name
      ORDER BY collected DESC
      LIMIT 10
    `).catch(() => ({ rows: [] }));

    return result.rows.map(row => ({
      class_name: row.class_name,
      billed:     parseFloat(row.billed),
      collected:  parseFloat(row.collected),
      pct:        row.billed > 0
                    ? Math.round((row.collected / row.billed) * 100)
                    : 0,
    }));
  }

  // ── Payroll ───────────────────────────────────────────────────────────────

  async getPayroll(filters, req) {
    const db = req.tenantPool;
    await this._ensureTables(db);

    const fy = filters.fiscal_year || this._currentFiscalYear();
    const result = await db.query(`
      SELECT * FROM accounts_payroll
      WHERE fiscal_year = $1
      ORDER BY pay_month, employee_name
    `, [fy]);

    return result.rows;
  }

  async createPayroll(payload, req) {
    const db = req.tenantPool;
    await this._ensureTables(db);

    const {
      employee_id, employee_name, employee_type,
      fiscal_year, pay_month, basic_salary,
      allowances, deductions, payment_date, payment_mode, notes,
    } = payload;

    const fy = fiscal_year || this._currentFiscalYear();

    const result = await db.query(`
      INSERT INTO accounts_payroll
        (employee_id, employee_name, employee_type, fiscal_year, pay_month,
         basic_salary, allowances, deductions, payment_date, payment_mode, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
    `, [
      employee_id, employee_name, employee_type || 'staff',
      fy, pay_month,
      basic_salary, allowances || 0, deductions || 0,
      payment_date || null, payment_mode || 'bank', notes || null,
    ]);

    return result.rows[0];
  }

  async updatePayrollStatus(id, status, req) {
    const db = req.tenantPool;
    const result = await db.query(`
      UPDATE accounts_payroll SET status = $1, updated_at = NOW()
      WHERE id = $2 RETURNING *
    `, [status, id]);
    if (!result.rows.length) throw new Error('Payroll record not found');
    return result.rows[0];
  }

  // ── Report export (CSV) ───────────────────────────────────────────────────

  async exportTransactionsCsv(filters, req) {
    const db = req.tenantPool;
    const fy = filters.fiscal_year || this._currentFiscalYear();

    const result = await db.query(`
      SELECT
        t.txn_date,
        t.particulars,
        t.sub_text,
        t.category,
        t.txn_type,
        t.amount,
        t.payment_mode,
        t.status,
        ec.name AS expense_category
      FROM accounts_transactions t
      LEFT JOIN accounts_expense_categories ec ON t.expense_category_id = ec.id
      WHERE t.fiscal_year = $1
      ORDER BY t.txn_date DESC
    `, [fy]);

    // Build CSV string
    const headers = ['Date','Particulars','Detail','Category','Type','Amount','Payment Mode','Status'];
    const lines   = [headers.join(',')];

    for (const row of result.rows) {
      lines.push([
        row.txn_date,
        `"${(row.particulars || '').replace(/"/g, '""')}"`,
        `"${(row.sub_text    || '').replace(/"/g, '""')}"`,
        `"${(row.expense_category || row.category || '').replace(/"/g, '""')}"`,
        row.txn_type,
        row.amount,
        row.payment_mode,
        row.status,
      ].join(','));
    }

    return lines.join('\n');
  }
}

module.exports = new AccountsService();
