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
    CREATE TABLE IF NOT EXISTS platform_settings (
      id SERIAL PRIMARY KEY,
      system_name VARCHAR(255),
      platform_name VARCHAR(255),
      platform_tagline TEXT,
      system_email VARCHAR(255),
      support_email VARCHAR(255),
      language VARCHAR(50) DEFAULT 'English',
      timezone VARCHAR(100),
      currency VARCHAR(20),
      default_plan VARCHAR(255),
      session_domain VARCHAR(255),
      maintenance_mode BOOLEAN DEFAULT FALSE,
      allow_new_tenants BOOLEAN DEFAULT TRUE,
      auto_suspend_overdue_invoice BOOLEAN DEFAULT FALSE,
      enforce_2fa_admins BOOLEAN DEFAULT FALSE,
      enforce_2fa_tenant_admins BOOLEAN DEFAULT FALSE,
      restrict_login_by_ip_allowlist JSONB DEFAULT '{}'::jsonb,
      session_timeout_minutes INTEGER DEFAULT 30,
      minimum_password_length INTEGER DEFAULT 8,
      password_rotation_days INTEGER DEFAULT 90,
      api_rate_limit_per_minute INTEGER DEFAULT 60,
      default_storage_quota VARCHAR(100),
      max_upload_file_size VARCHAR(100),
      allowed_file_types TEXT,
      storage_provider VARCHAR(255),
      warn_tenants_at_60_percent BOOLEAN DEFAULT FALSE,
      block_uploads_at_100_percent BOOLEAN DEFAULT FALSE,
      auto_archive_files_older_than_years INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    INSERT INTO platform_settings (created_at, updated_at)
      SELECT CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      WHERE NOT EXISTS (SELECT 1 FROM platform_settings);
  `);
};

exports.down = function (db) {
  return db.runSql(`DROP TABLE IF EXISTS platform_settings;`);
};

exports._meta = {
  version: 1,
};
