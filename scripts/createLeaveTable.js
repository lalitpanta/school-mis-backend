const { centralPool, getTenantPool } = require("../src/config/tenantDb");

async function createLeaveTable() {
  const client = await centralPool.connect();
  try {
    const res = await client.query("SELECT id, database_name FROM tenant");
    for (const row of res.rows) {
      const tenantPool = getTenantPool(row.id, row.database_name);
      const tClient = await tenantPool.connect();
      try {
        await tClient.query(`
          CREATE TABLE IF NOT EXISTS leave_requests (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id UUID NOT NULL REFERENCES tenant_users(id) ON DELETE CASCADE,
            start_date DATE NOT NULL,
            end_date DATE NOT NULL,
            reason TEXT NOT NULL,
            status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
            admin_reply TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
        console.log(`Created leave_requests table in tenant DB: ${row.database_name}`);
      } catch (err) {
        console.error(`Error creating table in ${row.database_name}:`, err);
      } finally {
        tClient.release();
      }
    }
  } catch (err) {
    console.error("Error fetching tenants:", err);
  } finally {
    client.release();
    process.exit(0);
  }
}

createLeaveTable();
