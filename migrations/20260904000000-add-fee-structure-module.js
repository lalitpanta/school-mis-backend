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
  return db
    .runSql(`SELECT to_regclass('fee_structures') AS fee_structures`)
    .then((result) => {
      if (!result.rows?.[0]?.fee_structures) return null;
      return db.runSql(`
    CREATE SEQUENCE IF NOT EXISTS fee_receipt_number_seq;
    CREATE SEQUENCE IF NOT EXISTS fee_invoice_number_seq;
    ALTER TABLE fee_receipts ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(120);
    ALTER TABLE fee_receipts ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(180);
    ALTER TABLE fee_receipts ADD COLUMN IF NOT EXISTS collector_id UUID;
    ALTER TABLE fee_receipts ADD COLUMN IF NOT EXISTS remarks TEXT;
    ALTER TABLE fee_categories ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE fee_payment_items ADD COLUMN IF NOT EXISTS fee_rule_id INTEGER;
    ALTER TABLE fee_payment_items ADD COLUMN IF NOT EXISTS allocation_amount NUMERIC(14,2);
    ALTER TABLE student_fees ADD COLUMN IF NOT EXISTS fee_rule_id INTEGER;
    ALTER TABLE student_fees ADD COLUMN IF NOT EXISTS fee_structure_version_id INTEGER;
    ALTER TABLE student_fees ADD COLUMN IF NOT EXISTS charge_amount NUMERIC(14,2);
    ALTER TABLE student_fees ADD COLUMN IF NOT EXISTS fine_amount NUMERIC(14,2) NOT NULL DEFAULT 0;
    ALTER TABLE student_fees ADD COLUMN IF NOT EXISTS levy_amount NUMERIC(14,2) NOT NULL DEFAULT 0;
    ALTER TABLE student_fees ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_fee_receipts_idempotency ON fee_receipts(idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_fee_receipts_payment_reference ON fee_receipts(payment_reference) WHERE payment_reference IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_student_fee_rule_due ON student_fees(student_id, fee_rule_id, due_date) WHERE fee_rule_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS fee_ledger_entries (
      id BIGSERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
      student_fee_id INTEGER REFERENCES student_fees(id) ON DELETE RESTRICT,
      receipt_id INTEGER REFERENCES fee_receipts(id) ON DELETE RESTRICT,
      entry_type VARCHAR(30) NOT NULL CHECK (entry_type IN ('opening','charge','discount','levy','fine','payment','refund','adjustment')),
      amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
      reference VARCHAR(180),
      description TEXT,
      created_by UUID,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_fee_ledger_student_date ON fee_ledger_entries(student_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_fee_ledger_receipt ON fee_ledger_entries(receipt_id);

    ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS structure_name VARCHAR(180);
    ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'draft';
    ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS effective_start_date DATE;
    ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS effective_end_date DATE;
    ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS created_by UUID;
    ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS updated_by UUID;

    CREATE TABLE IF NOT EXISTS fee_structure_versions (
      id SERIAL PRIMARY KEY,
      fee_structure_id INTEGER NOT NULL REFERENCES fee_structures(id) ON DELETE RESTRICT,
      version INTEGER NOT NULL,
      snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      status VARCHAR(20) NOT NULL DEFAULT 'draft',
      created_by UUID,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(fee_structure_id, version)
    );
    CREATE TABLE IF NOT EXISTS fee_groups (
      id SERIAL PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      description TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(name)
    );
    CREATE TABLE IF NOT EXISTS fee_rules (
      id SERIAL PRIMARY KEY,
      fee_structure_id INTEGER NOT NULL REFERENCES fee_structures(id) ON DELETE RESTRICT,
      fee_group_id INTEGER REFERENCES fee_groups(id) ON DELETE SET NULL,
      category_id INTEGER REFERENCES fee_categories(id) ON DELETE RESTRICT,
      name VARCHAR(180) NOT NULL,
      amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
      charge_type VARCHAR(20) NOT NULL DEFAULT 'recurring' CHECK (charge_type IN ('one_time','recurring')),
      frequency VARCHAR(20) NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('monthly','term','annual','one_time')),
      mandatory BOOLEAN NOT NULL DEFAULT TRUE,
      taxable BOOLEAN NOT NULL DEFAULT FALSE,
      refundable BOOLEAN NOT NULL DEFAULT FALSE,
      effective_start_date DATE,
      effective_end_date DATE,
      due_day INTEGER,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS fee_schedules (
      id SERIAL PRIMARY KEY,
      fee_rule_id INTEGER NOT NULL REFERENCES fee_rules(id) ON DELETE CASCADE,
      schedule_type VARCHAR(20) NOT NULL CHECK (schedule_type IN ('monthly','term','annual','installment')),
      due_date DATE NOT NULL,
      installment_no INTEGER,
      amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS fee_levies (
      id SERIAL PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      rate_type VARCHAR(20) NOT NULL CHECK (rate_type IN ('percentage','fixed')),
      rate_value NUMERIC(14,4) NOT NULL CHECK (rate_value >= 0),
      applicability JSONB NOT NULL DEFAULT '{}'::jsonb,
      effective_start_date DATE,
      effective_end_date DATE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS fee_discounts (
      id SERIAL PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      discount_type VARCHAR(20) NOT NULL CHECK (discount_type IN ('percentage','fixed')),
      value NUMERIC(14,4) NOT NULL CHECK (value >= 0),
      start_date DATE,
      end_date DATE,
      approval_required BOOLEAN NOT NULL DEFAULT FALSE,
      stackable BOOLEAN NOT NULL DEFAULT FALSE,
      priority INTEGER NOT NULL DEFAULT 100,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS fee_fine_rules (
      id SERIAL PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      grace_period_days INTEGER NOT NULL DEFAULT 0,
      fine_type VARCHAR(20) NOT NULL CHECK (fine_type IN ('flat','percentage_per_day')),
      fine_value NUMERIC(14,4) NOT NULL DEFAULT 0,
      maximum_amount NUMERIC(14,2),
      waiver_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
      effective_start_date DATE,
      effective_end_date DATE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS fee_assignments (
      id SERIAL PRIMARY KEY,
      fee_structure_id INTEGER NOT NULL REFERENCES fee_structures(id) ON DELETE RESTRICT,
      fee_structure_version_id INTEGER REFERENCES fee_structure_versions(id) ON DELETE RESTRICT,
      student_id INTEGER REFERENCES students(id) ON DELETE RESTRICT,
      class_id INTEGER REFERENCES classes(id) ON DELETE RESTRICT,
      section_id INTEGER REFERENCES sections(id) ON DELETE RESTRICT,
      effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
      override_amount NUMERIC(14,2),
      override_reason TEXT,
      approval_status VARCHAR(20) NOT NULL DEFAULT 'pending',
      assigned_by UUID,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS fee_invoices (
      id SERIAL PRIMARY KEY,
      invoice_number VARCHAR(80) NOT NULL UNIQUE,
      receipt_number VARCHAR(80) UNIQUE,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
      fee_structure_id INTEGER REFERENCES fee_structures(id) ON DELETE RESTRICT,
      fee_structure_version_id INTEGER REFERENCES fee_structure_versions(id) ON DELETE RESTRICT,
      academic_year VARCHAR(50),
      issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
      due_date DATE,
      subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
      discount_total NUMERIC(14,2) NOT NULL DEFAULT 0,
      levy_total NUMERIC(14,2) NOT NULL DEFAULT 0,
      fine_total NUMERIC(14,2) NOT NULL DEFAULT 0,
      total NUMERIC(14,2) NOT NULL DEFAULT 0,
      amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'issued',
      created_by UUID,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    ALTER TABLE fee_invoices ADD COLUMN IF NOT EXISTS invoice_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;
    CREATE TABLE IF NOT EXISTS fee_invoice_items (
      id SERIAL PRIMARY KEY,
      invoice_id INTEGER NOT NULL REFERENCES fee_invoices(id) ON DELETE RESTRICT,
      fee_rule_id INTEGER REFERENCES fee_rules(id) ON DELETE SET NULL,
      line_type VARCHAR(20) NOT NULL CHECK (line_type IN ('fee','discount','levy','fine')),
      description VARCHAR(255) NOT NULL,
      quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
      amount NUMERIC(14,2) NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE IF NOT EXISTS fee_payments (
      id SERIAL PRIMARY KEY,
      invoice_id INTEGER NOT NULL REFERENCES fee_invoices(id) ON DELETE RESTRICT,
      receipt_number VARCHAR(80) NOT NULL UNIQUE,
      amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
      payment_method VARCHAR(40) NOT NULL,
      provider_reference VARCHAR(180),
      paid_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      received_by UUID,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(120);
    ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(180);
    ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS collector_id UUID;
    ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS remarks TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_fee_payments_idempotency ON fee_payments(idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_fee_payments_reference ON fee_payments(payment_reference) WHERE payment_reference IS NOT NULL;
    CREATE TABLE IF NOT EXISTS fee_refunds (
      id SERIAL PRIMARY KEY,
      payment_id INTEGER NOT NULL REFERENCES fee_payments(id) ON DELETE RESTRICT,
      amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
      reason TEXT NOT NULL,
      approved_by UUID,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS fee_waivers (
      id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
      invoice_id INTEGER REFERENCES fee_invoices(id) ON DELETE RESTRICT,
      amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
      reason TEXT NOT NULL,
      effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
      approval_status VARCHAR(20) NOT NULL DEFAULT 'pending',
      approved_by UUID,
      created_by UUID,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS fee_audit_logs (
      id BIGSERIAL PRIMARY KEY,
      entity_type VARCHAR(60) NOT NULL,
      entity_id INTEGER,
      action VARCHAR(40) NOT NULL,
      before_data JSONB,
      after_data JSONB,
      reason TEXT,
      actor_id UUID,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_fee_rules_structure ON fee_rules(fee_structure_id);
    CREATE INDEX IF NOT EXISTS idx_fee_assignments_student ON fee_assignments(student_id);
    CREATE INDEX IF NOT EXISTS idx_fee_assignments_scope ON fee_assignments(class_id, section_id);
    CREATE INDEX IF NOT EXISTS idx_fee_invoices_student_status ON fee_invoices(student_id, status);
    CREATE INDEX IF NOT EXISTS idx_fee_audit_entity ON fee_audit_logs(entity_type, entity_id);
    CREATE TABLE IF NOT EXISTS fee_receipt_cancellations (
      id BIGSERIAL PRIMARY KEY,
      receipt_id INTEGER NOT NULL UNIQUE REFERENCES fee_receipts(id) ON DELETE RESTRICT,
      status VARCHAR(20) NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','rejected')),
      reason TEXT NOT NULL,
      requested_by UUID,
      approved_by UUID,
      approved_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_fee_receipt_cancellations_status ON fee_receipt_cancellations(status);
    CREATE TABLE IF NOT EXISTS fee_payment_allocations (
      id BIGSERIAL PRIMARY KEY,
      payment_id INTEGER NOT NULL REFERENCES fee_payments(id) ON DELETE RESTRICT,
      invoice_item_id INTEGER NOT NULL REFERENCES fee_invoice_items(id) ON DELETE RESTRICT,
      amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(payment_id, invoice_item_id)
    );
    CREATE INDEX IF NOT EXISTS idx_fee_payment_allocations_item ON fee_payment_allocations(invoice_item_id);
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_payment_item_fee_rule') THEN
        ALTER TABLE fee_payment_items ADD CONSTRAINT fk_payment_item_fee_rule FOREIGN KEY (fee_rule_id) REFERENCES fee_rules(id) ON DELETE RESTRICT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_student_fee_rule') THEN
        ALTER TABLE student_fees ADD CONSTRAINT fk_student_fee_rule FOREIGN KEY (fee_rule_id) REFERENCES fee_rules(id) ON DELETE RESTRICT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_student_fee_version') THEN
        ALTER TABLE student_fees ADD CONSTRAINT fk_student_fee_version FOREIGN KEY (fee_structure_version_id) REFERENCES fee_structure_versions(id) ON DELETE RESTRICT;
      END IF;
    END $$;
    `);
    });
};

exports.down = function (db) {
  return db.runSql(`
    DROP TABLE IF EXISTS fee_payment_allocations, fee_receipt_cancellations, fee_ledger_entries;
    DROP TABLE IF EXISTS fee_audit_logs, fee_waivers, fee_refunds, fee_payments,
      fee_invoice_items, fee_invoices, fee_assignments, fee_fine_rules,
      fee_discounts, fee_levies, fee_schedules, fee_rules, fee_groups,
      fee_structure_versions;
    DROP SEQUENCE IF EXISTS fee_invoice_number_seq;
    DROP SEQUENCE IF EXISTS fee_receipt_number_seq;
  `);
};

exports._meta = { version: 1 };
