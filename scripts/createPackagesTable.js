const pool = require("../src/config/db");

async function createTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS packages (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        package_name VARCHAR(255) NOT NULL,
        description TEXT,
        accessed_modules JSONB DEFAULT '[]',
        price DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
        time_period VARCHAR(255),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("Packages table created successfully!");
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

createTable();
