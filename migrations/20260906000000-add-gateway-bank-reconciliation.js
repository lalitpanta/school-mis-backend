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
    CREATE TABLE IF NOT EXISTS accounting_payment_gateways (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL UNIQUE,
      provider VARCHAR(50) NOT NULL,
      merchant_id VARCHAR(150), api_key VARCHAR(255), api_secret VARCHAR(255), webhook_url TEXT,
      mode VARCHAR(20) NOT NULL DEFAULT 'sandbox' CHECK (mode IN ('sandbox','live')),
      is_active BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS accounting_gateway_transactions (
      id SERIAL PRIMARY KEY,
      gateway_id INTEGER NOT NULL REFERENCES accounting_payment_gateways(id),
      external_id VARCHAR(180) NOT NULL, idempotency_key VARCHAR(180) NOT NULL,
      amount NUMERIC(14,2) NOT NULL, payment_mode VARCHAR(40),
      status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','success','failed','refunded','reconciled')),
      journal_id INTEGER REFERENCES accounting_journals(id), payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (gateway_id, external_id), UNIQUE (idempotency_key)
    );
    CREATE TABLE IF NOT EXISTS accounting_bank_accounts (
      id SERIAL PRIMARY KEY, name VARCHAR(150) NOT NULL, account_number_masked VARCHAR(50),
      ledger_account_id INTEGER REFERENCES accounting_accounts(id), is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS accounting_bank_statements (
      id SERIAL PRIMARY KEY, bank_account_id INTEGER NOT NULL REFERENCES accounting_bank_accounts(id),
      transaction_date DATE NOT NULL, reference VARCHAR(180), description TEXT, amount NUMERIC(14,2) NOT NULL,
      direction VARCHAR(10) NOT NULL CHECK (direction IN ('debit','credit')),
      status VARCHAR(20) NOT NULL DEFAULT 'unmatched' CHECK (status IN ('unmatched','matched','reconciled')),
      journal_id INTEGER REFERENCES accounting_journals(id), imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (bank_account_id, transaction_date, reference, amount, direction)
    );
    CREATE INDEX IF NOT EXISTS idx_accounting_gateway_transactions_status ON accounting_gateway_transactions(status);
    CREATE INDEX IF NOT EXISTS idx_accounting_bank_statements_status ON accounting_bank_statements(status);
  `);
};

exports.down = function (db) {
  return db.runSql(`
    DROP TABLE IF EXISTS accounting_bank_statements;
    DROP TABLE IF EXISTS accounting_bank_accounts;
    DROP TABLE IF EXISTS accounting_gateway_transactions;
    DROP TABLE IF EXISTS accounting_payment_gateways;
  `);
};

exports._meta = { version: 1 };
