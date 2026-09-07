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
    ALTER TABLE accounting_journals
      ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(180);
    CREATE SEQUENCE IF NOT EXISTS accounting_journal_number_seq;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_accounting_journal_idempotency
      ON accounting_journals(idempotency_key)
      WHERE idempotency_key IS NOT NULL;
  `);
};

exports.down = function (db) {
  return db.runSql(`
    DROP INDEX IF EXISTS uq_accounting_journal_idempotency;
    ALTER TABLE accounting_journals DROP COLUMN IF EXISTS idempotency_key;
    DROP SEQUENCE IF EXISTS accounting_journal_number_seq;
  `);
};

exports._meta = { version: 1 };
