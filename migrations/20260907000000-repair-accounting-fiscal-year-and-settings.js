"use strict";

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
    ALTER TABLE IF EXISTS accounts_transactions ADD COLUMN IF NOT EXISTS fiscal_year VARCHAR(20);
    ALTER TABLE IF EXISTS accounts_payroll ADD COLUMN IF NOT EXISTS fiscal_year VARCHAR(20);
    ALTER TABLE IF EXISTS accounting_journals ADD COLUMN IF NOT EXISTS fiscal_year VARCHAR(20);
    ALTER TABLE IF EXISTS accounting_vouchers ADD COLUMN IF NOT EXISTS fiscal_year VARCHAR(20);
    ALTER TABLE IF EXISTS accounting_fiscal_years ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'open';
    ALTER TABLE IF EXISTS accounting_fiscal_years ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE IF EXISTS accounting_fiscal_years ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP;
    ALTER TABLE IF EXISTS accounting_configuration ADD COLUMN IF NOT EXISTS calendar_type VARCHAR(2) NOT NULL DEFAULT 'BS';
    ALTER TABLE IF EXISTS accounting_configuration ADD COLUMN IF NOT EXISTS active_fiscal_year VARCHAR(20);
    ALTER TABLE IF EXISTS accounting_configuration ADD COLUMN IF NOT EXISTS approval_required BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE IF EXISTS accounting_configuration ADD COLUMN IF NOT EXISTS approval_threshold NUMERIC(14,2) NOT NULL DEFAULT 0;
    ALTER TABLE IF EXISTS accounting_configuration ADD COLUMN IF NOT EXISTS cash_account_id INTEGER;
    ALTER TABLE IF EXISTS accounting_configuration ADD COLUMN IF NOT EXISTS bank_account_id INTEGER;
    ALTER TABLE IF EXISTS accounting_configuration ADD COLUMN IF NOT EXISTS gateway_clearing_account_id INTEGER;
    DO $$ BEGIN
      IF to_regclass('accounts_transactions') IS NOT NULL THEN
        CREATE INDEX IF NOT EXISTS idx_accounts_transactions_fiscal_year ON accounts_transactions(fiscal_year);
      END IF;
      IF to_regclass('accounts_payroll') IS NOT NULL THEN
        CREATE INDEX IF NOT EXISTS idx_accounts_payroll_fiscal_year ON accounts_payroll(fiscal_year);
      END IF;
      IF to_regclass('accounting_journals') IS NOT NULL THEN
        CREATE INDEX IF NOT EXISTS idx_accounting_journals_fiscal_year ON accounting_journals(fiscal_year);
      END IF;
    END $$;
    CREATE TABLE IF NOT EXISTS accounting_configuration (
      id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      legal_name VARCHAR(255), address TEXT, pan_number VARCHAR(100), vat_number VARCHAR(100),
      phone VARCHAR(100), email VARCHAR(255), logo_url TEXT, letterhead_url TEXT,
      currency VARCHAR(10) NOT NULL DEFAULT 'NPR', decimal_places SMALLINT NOT NULL DEFAULT 2,
      fiscal_year_format VARCHAR(30) NOT NULL DEFAULT 'BS', active_fiscal_year VARCHAR(20),
      calendar_type VARCHAR(2) NOT NULL DEFAULT 'BS',
      approval_required BOOLEAN NOT NULL DEFAULT FALSE, approval_threshold NUMERIC(14,2) NOT NULL DEFAULT 0,
      cash_account_id INTEGER, bank_account_id INTEGER, gateway_clearing_account_id INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO accounting_configuration (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
    CREATE TABLE IF NOT EXISTS accounting_tax_rules (
      id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL UNIQUE, tax_type VARCHAR(40) NOT NULL,
      rate NUMERIC(12,4) NOT NULL DEFAULT 0, rate_kind VARCHAR(10) NOT NULL DEFAULT 'percentage' CHECK (rate_kind IN ('percentage','fixed')),
      inclusive BOOLEAN NOT NULL DEFAULT FALSE, account_id INTEGER, is_active BOOLEAN NOT NULL DEFAULT TRUE,
      effective_from DATE, effective_to DATE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS accounting_cost_centers (
      id SERIAL PRIMARY KEY, code VARCHAR(40) NOT NULL UNIQUE, name VARCHAR(150) NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS accounting_voucher_numbering (
      id SERIAL PRIMARY KEY, voucher_type VARCHAR(20) NOT NULL UNIQUE, prefix VARCHAR(20) NOT NULL,
      next_number INTEGER NOT NULL DEFAULT 1, fiscal_year_based BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO accounting_voucher_numbering (voucher_type, prefix) VALUES
      ('receipt','RV'), ('payment','PV'), ('contra','CV'), ('journal','JV'), ('sales','SV'), ('purchase','PU')
    ON CONFLICT (voucher_type) DO NOTHING;
  `);
};

exports.down = function (db) {
  return db.runSql(`
    DROP TABLE IF EXISTS accounting_voucher_numbering;
    DROP TABLE IF EXISTS accounting_cost_centers;
    DROP TABLE IF EXISTS accounting_tax_rules;
    DROP TABLE IF EXISTS accounting_configuration;
  `);
};

exports._meta = { version: 1 };
