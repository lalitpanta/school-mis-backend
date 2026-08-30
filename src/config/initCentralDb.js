const { centralPool } = require("./tenantDb");

/**
 * Initialize central database with admin and tenant metadata tables
 */
async function initializeCentralDatabase() {
  const client = await centralPool.connect();

  try {
    console.log("🔄 Creating system_admin table if not exists...");
    // Create system_admin table
    await client.query(`
      CREATE TABLE IF NOT EXISTS system_admin (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("✅ system_admin table created");

    console.log("🔄 Creating tenant table if not exists...");
    // Create tenant table
    await client.query(`
      CREATE TABLE IF NOT EXISTS tenant (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        database_name VARCHAR(255) UNIQUE NOT NULL,
        neon_project_id VARCHAR(255),
        connection_string TEXT,
        modules JSONB DEFAULT '[]'::jsonb,
        contact_person VARCHAR(255),
        phone VARCHAR(20),
        address TEXT,
        status VARCHAR(50) DEFAULT 'active',
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(
      `ALTER TABLE tenant ADD COLUMN IF NOT EXISTS neon_project_id VARCHAR(255)`,
    );
    await client.query(
      `ALTER TABLE tenant ADD COLUMN IF NOT EXISTS connection_string TEXT`,
    );
    console.log("✅ tenant table created");

    console.log("🔄 Adding columns to tenant table...");
    // Add columns safely
    await client.query(
      `ALTER TABLE tenant ADD COLUMN IF NOT EXISTS slug VARCHAR(255)`,
    );
    await client.query(
      `ALTER TABLE tenant ADD COLUMN IF NOT EXISTS modules JSONB DEFAULT '[]'::jsonb`,
    );
    console.log("✅ Columns added");

    console.log("🔄 Creating indexes...");
    // Create indexes
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_system_admin_email ON system_admin(email)`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_tenant_email ON tenant(email)`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_tenant_database_name ON tenant(database_name)`,
    );
    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_slug ON tenant(slug)`,
    );
    console.log("✅ Indexes created");

    console.log("🔄 Creating shared settings table if not exists...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        id SERIAL PRIMARY KEY,
        key VARCHAR(100) NOT NULL UNIQUE,
        value TEXT,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Shared settings table created");

    console.log("🔄 Creating platform settings table if not exists...");
    await client.query(`
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
        s3_access_key_id VARCHAR(255),
        s3_secret_access_key VARCHAR(255),
        s3_bucket_name VARCHAR(255),
        azure_storage_account_name VARCHAR(255),
        azure_storage_account_key VARCHAR(255),
        azure_container_name VARCHAR(255),
        gcp_project_id VARCHAR(255),
        gcp_client_email VARCHAR(255),
        gcp_private_key TEXT,
        gcp_bucket_name VARCHAR(255),
        enable_global_storage BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      INSERT INTO platform_settings (created_at, updated_at)
      SELECT CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      WHERE NOT EXISTS (SELECT 1 FROM platform_settings);
    `);
    console.log("✅ Platform settings table created");

    console.log("🔄 Updating platform settings table with storage columns...");
    await client.query(
      `ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS s3_access_key_id VARCHAR(255)`,
    );
    await client.query(
      `ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS s3_secret_access_key VARCHAR(255)`,
    );
    await client.query(
      `ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS s3_bucket_name VARCHAR(255)`,
    );
    await client.query(
      `ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS azure_storage_account_name VARCHAR(255)`,
    );
    await client.query(
      `ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS azure_storage_account_key VARCHAR(255)`,
    );
    await client.query(
      `ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS azure_container_name VARCHAR(255)`,
    );
    await client.query(
      `ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS gcp_project_id VARCHAR(255)`,
    );
    await client.query(
      `ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS gcp_client_email VARCHAR(255)`,
    );
    await client.query(
      `ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS gcp_private_key TEXT`,
    );
    await client.query(
      `ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS gcp_bucket_name VARCHAR(255)`,
    );
    await client.query(
      `ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS enable_global_storage BOOLEAN DEFAULT FALSE`,
    );
    console.log("✅ Platform settings table updated with storage columns");

    console.log(
      "🔄 Removing legacy platform keys from central settings table...",
    );
    await client.query(`
      DELETE FROM "settings"
      WHERE key IN (
        'system_name',
        'platform_name',
        'platform_tagline',
        'system_email',
        'support_email',
        'language',
        'timezone',
        'currency',
        'default_plan',
        'session_domain',
        'maintenance_mode',
        'allow_new_tenants',
        'auto_suspend_overdue_invoice',
        'enforce_2fa_admins',
        'enforce_2fa_tenant_admins',
        'restrict_login_by_ip_allowlist',
        'session_timeout_minutes',
        'minimum_password_length',
        'password_rotation_days',
        'api_rate_limit_per_minute',
        'default_storage_quota',
        'max_upload_file_size',
        'allowed_file_types',
        'storage_provider',
        'warn_tenants_at_60_percent',
        'block_uploads_at_100_percent',
        'auto_archive_files_older_than_years'
      );
    `);
    console.log("✅ Legacy platform keys removed from settings table");

    console.log("🔄 Creating central school profile tables if not exists...");

    await client.query(`
      CREATE TABLE IF NOT EXISTS school_profile (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255),
        email VARCHAR(255),
        phone VARCHAR(100),
        address TEXT,
        website VARCHAR(255),
        motto TEXT,
        logo TEXT,
        established DATE,
        country VARCHAR(100),
        total_floors INTEGER,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS school_blocks (
        id SERIAL PRIMARY KEY,
        profile_id INTEGER NOT NULL REFERENCES school_profile(id) ON DELETE CASCADE,
        block_name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS school_floors (
        id SERIAL PRIMARY KEY,
        block_id INTEGER NOT NULL REFERENCES school_blocks(id) ON DELETE CASCADE,
        floor_number INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(block_id, floor_number)
      );
    `);
    console.log("✅ Central school profile tables created");

    console.log("✅ Central database schema initialized successfully");
  } catch (error) {
    if (error.code === "42P07") {
      // Table already exists, which is fine
      console.log("✅ Central database tables already exist");
    } else {
      console.error("❌ Database initialization error:", error.message);
      throw error;
    }
  } finally {
    client.release();
  }
}

module.exports = {
  initializeCentralDatabase,
};
