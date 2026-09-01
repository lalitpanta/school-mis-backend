'use strict';

var dbm;
var type;
var seed;

exports.setup = function (options, seedLink) {
  dbm = options.dbmigrate;
  type = dbm.dataType;
  seed = seedLink;
};

exports.up = function (db) {
  return db.runSql(`
    -- ── Expense categories ───────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS accounts_expense_categories (
      id   SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL UNIQUE,
      color VARCHAR(20) DEFAULT '#6366f1',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Seed default categories (idempotent)
    INSERT INTO accounts_expense_categories (name, color) VALUES
      ('Staff Salaries',           '#6366f1'),
      ('Utilities',                '#f59e0b'),
      ('Transport & Maintenance',  '#10b981'),
      ('Supplies & Materials',     '#f43f5e'),
      ('Other',                    '#94a3b8')
    ON CONFLICT (name) DO NOTHING;

    -- ── Accounts transactions ────────────────────────────────────────────
    -- A single ledger for both income (fee receipts) and expenses
    CREATE TABLE IF NOT EXISTS accounts_transactions (
      id            SERIAL PRIMARY KEY,
      txn_date      DATE          NOT NULL DEFAULT CURRENT_DATE,
      particulars   VARCHAR(255)  NOT NULL,
      sub_text      VARCHAR(255),
      category      VARCHAR(100)  NOT NULL,
      txn_type      VARCHAR(10)   NOT NULL CHECK (txn_type IN ('income','expense')),
      amount        NUMERIC(14,2) NOT NULL,
      payment_mode  VARCHAR(50)   DEFAULT 'cash'
                                  CHECK (payment_mode IN ('cash','bank','cheque','online','other')),
      status        VARCHAR(20)   DEFAULT 'paid'
                                  CHECK (status IN ('paid','partial','overdue','pending')),
      reference_id  VARCHAR(100),     -- fee_receipts.receipt_number or any external ref
      student_id    INTEGER,          -- FK soft-link (no hard FK to keep migration simple)
      expense_category_id INTEGER REFERENCES accounts_expense_categories(id) ON DELETE SET NULL,
      fiscal_year   VARCHAR(20),      -- e.g. "2082/83"
      notes         TEXT,
      created_by    UUID,
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_acct_txn_date         ON accounts_transactions(txn_date);
    CREATE INDEX IF NOT EXISTS idx_acct_txn_type         ON accounts_transactions(txn_type);
    CREATE INDEX IF NOT EXISTS idx_acct_txn_status       ON accounts_transactions(status);
    CREATE INDEX IF NOT EXISTS idx_acct_txn_fiscal_year  ON accounts_transactions(fiscal_year);
    CREATE INDEX IF NOT EXISTS idx_acct_txn_student_id   ON accounts_transactions(student_id);

    -- ── Payroll runs ─────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS accounts_payroll (
      id             SERIAL PRIMARY KEY,
      employee_id    UUID          NOT NULL,  -- tenant_users or teachers.id
      employee_name  VARCHAR(255)  NOT NULL,
      employee_type  VARCHAR(50)   DEFAULT 'staff'
                                   CHECK (employee_type IN ('teacher','staff','admin')),
      fiscal_year    VARCHAR(20),
      pay_month      VARCHAR(20),             -- e.g. "Shrawan 2082"
      basic_salary   NUMERIC(14,2) NOT NULL DEFAULT 0,
      allowances     NUMERIC(14,2) DEFAULT 0,
      deductions     NUMERIC(14,2) DEFAULT 0,
      net_salary     NUMERIC(14,2) GENERATED ALWAYS AS (basic_salary + allowances - deductions) STORED,
      payment_date   DATE,
      payment_mode   VARCHAR(50)   DEFAULT 'bank',
      status         VARCHAR(20)   DEFAULT 'pending'
                                   CHECK (status IN ('pending','paid','cancelled')),
      notes          TEXT,
      created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_payroll_fiscal_year ON accounts_payroll(fiscal_year);
    CREATE INDEX IF NOT EXISTS idx_payroll_status      ON accounts_payroll(status);
    CREATE INDEX IF NOT EXISTS idx_payroll_employee_id ON accounts_payroll(employee_id);
  `);
};

exports.down = function (db) {
  return db.runSql(`
    DROP TABLE IF EXISTS accounts_payroll;
    DROP TABLE IF EXISTS accounts_transactions;
    DROP TABLE IF EXISTS accounts_expense_categories;
  `);
};

exports._meta = { version: 1 };
