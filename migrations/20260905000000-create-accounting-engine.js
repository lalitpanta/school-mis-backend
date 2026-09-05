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
    INSERT INTO accounting_accounts (code, name, account_type) VALUES
      ('1000', 'Cash', 'asset'),
      ('1010', 'Bank', 'asset'),
      ('1100', 'Accounts Receivable', 'asset'),
      ('4000', 'Fee Income', 'income'),
      ('5000', 'Operating Expenses', 'expense'),
      ('5100', 'Staff Salaries', 'expense')
    ON CONFLICT (code) DO NOTHING;
  `);
};

exports.down = function (db) {
  return db.runSql(`
    DROP TABLE IF EXISTS accounting_journal_lines;
    DROP TABLE IF EXISTS accounting_voucher_lines;
    DROP TABLE IF EXISTS accounting_vouchers;
    DROP SEQUENCE IF EXISTS accounting_voucher_number_seq;
    DROP TABLE IF EXISTS accounting_journals;
    DROP TABLE IF EXISTS accounting_fiscal_years;
    DROP TABLE IF EXISTS accounting_accounts;
  `);
};

exports._meta = { version: 1 };