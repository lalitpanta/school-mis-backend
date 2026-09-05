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

    CREATE TABLE IF NOT EXISTS accounting_account_mappings (
      mapping_key VARCHAR(60) PRIMARY KEY,
      account_id BIGINT NOT NULL REFERENCES accounting_accounts(id) ON DELETE RESTRICT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS accounting_journals (
      id BIGSERIAL PRIMARY KEY,
      journal_number VARCHAR(40) NOT NULL UNIQUE,
      journal_date DATE NOT NULL,
      fiscal_year_id BIGINT NOT NULL REFERENCES accounting_fiscal_years(id),
      voucher_type VARCHAR(20) NOT NULL CHECK (voucher_type IN ('opening', 'receipt', 'payment', 'contra', 'journal', 'sales', 'purchase', 'fee', 'payroll', 'gateway', 'reversal')),
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

    CREATE TABLE IF NOT EXISTS accounting_audit_events (
      id BIGSERIAL PRIMARY KEY,
      action VARCHAR(40) NOT NULL,
      entity_type VARCHAR(40) NOT NULL,
      entity_id VARCHAR(120) NOT NULL,
      actor_id UUID,
      reason TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_accounting_accounts_parent ON accounting_accounts(parent_id);
    CREATE INDEX IF NOT EXISTS idx_accounting_accounts_type ON accounting_accounts(account_type);
    CREATE INDEX IF NOT EXISTS idx_accounting_journals_date ON accounting_journals(journal_date);
    CREATE INDEX IF NOT EXISTS idx_accounting_journals_fy ON accounting_journals(fiscal_year_id);
    CREATE INDEX IF NOT EXISTS idx_accounting_journals_status ON accounting_journals(status);
    CREATE INDEX IF NOT EXISTS idx_accounting_journal_lines_account ON accounting_journal_lines(account_id);
    CREATE INDEX IF NOT EXISTS idx_accounting_journal_lines_journal ON accounting_journal_lines(journal_id);

    INSERT INTO accounting_accounts (code, name, account_type, is_control) VALUES
      ('1000', 'Assets', 'asset', TRUE),
      ('1010', 'Cash', 'asset', TRUE),
      ('1020', 'Bank', 'asset', TRUE),
      ('1030', 'Accounts Receivable', 'asset', TRUE),
      ('2000', 'Liabilities', 'liability', TRUE),
      ('2010', 'Accounts Payable', 'liability', TRUE),
      ('2020', 'Salary Payable', 'liability', TRUE),
      ('3000', 'Equity', 'equity', TRUE),
      ('4000', 'Fee Income', 'income', TRUE),
      ('4010', 'Other Income', 'income', TRUE),
      ('5000', 'General Expenses', 'expense', TRUE),
      ('5010', 'Salary Expense', 'expense', TRUE)
    ON CONFLICT (code) DO NOTHING;

    UPDATE accounting_accounts child SET parent_id = parent.id
    FROM accounting_accounts parent
    WHERE parent.code = '1000' AND child.code IN ('1010', '1020', '1030');
    UPDATE accounting_accounts child SET parent_id = parent.id
    FROM accounting_accounts parent
    WHERE parent.code = '2000' AND child.code IN ('2010', '2020');
    UPDATE accounting_accounts child SET parent_id = parent.id
    FROM accounting_accounts parent
    WHERE parent.code = '4000' AND child.code = '4010';
    UPDATE accounting_accounts child SET parent_id = parent.id
    FROM accounting_accounts parent
    WHERE parent.code = '5000' AND child.code = '5010';

    INSERT INTO accounting_account_mappings (mapping_key, account_id)
    SELECT mapping_key, account_id FROM (VALUES
      ('cash', (SELECT id FROM accounting_accounts WHERE code = '1010')),
      ('bank', (SELECT id FROM accounting_accounts WHERE code = '1020')),
      ('accounts_receivable', (SELECT id FROM accounting_accounts WHERE code = '1030')),
      ('fee_income', (SELECT id FROM accounting_accounts WHERE code = '4000')),
      ('other_income', (SELECT id FROM accounting_accounts WHERE code = '4010')),
      ('general_expense', (SELECT id FROM accounting_accounts WHERE code = '5000')),
      ('salary_expense', (SELECT id FROM accounting_accounts WHERE code = '5010'))
    ) AS defaults(mapping_key, account_id)
    ON CONFLICT (mapping_key) DO NOTHING;
  `);
};

exports.down = function (db) {
  return db.runSql(`
    DROP TABLE IF EXISTS accounting_journal_lines;
    DROP TABLE IF EXISTS accounting_journals;
    DROP TABLE IF EXISTS accounting_voucher_sequences;
    DROP TABLE IF EXISTS accounting_audit_events;
    DROP TABLE IF EXISTS accounting_account_mappings;
    DROP TABLE IF EXISTS accounting_accounts;
    DROP TABLE IF EXISTS accounting_fiscal_years;
  `);
};

exports._meta = { version: 1 };
