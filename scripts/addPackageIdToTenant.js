const { centralPool } = require("../src/config/tenantDb");

async function addPackageIdToTenant() {
  const client = await centralPool.connect();
  try {
    await client.query(`
      ALTER TABLE tenant 
      ADD COLUMN IF NOT EXISTS package_id UUID REFERENCES packages(id) ON DELETE SET NULL;
    `);
    console.log("Successfully added package_id to tenant table.");
    process.exit(0);
  } catch (error) {
    console.error("Error adding package_id:", error);
    process.exit(1);
  } finally {
    client.release();
  }
}

addPackageIdToTenant();
