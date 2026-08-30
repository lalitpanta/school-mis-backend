const { centralPool } = require("../config/tenantDb");

const TABLE_NAME = "audit_logs";

const CATEGORY_CONFIG = {
  authentication: { label: "Authentication", emoji: "🔐", color: "indigo" },
  tenant_lifecycle: { label: "Tenant Lifecycle", emoji: "🏢", color: "blue" },
  user_roles: { label: "User & Roles", emoji: "👥", color: "emerald" },
  billing: { label: "Billing", emoji: "💳", color: "amber" },
  data_storage: { label: "Data & Storage", emoji: "🗄️", color: "fuchsia" },
  academic: { label: "Academic Actions", emoji: "🎓", color: "violet" },
  system_config: { label: "System & Config", emoji: "⚙️", color: "slate" },
  security: { label: "Security", emoji: "🛡️", color: "rose" },
};

async function ensureAuditLogTable() {
  const client = await centralPool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
        id SERIAL PRIMARY KEY,
        category VARCHAR(50) NOT NULL,
        action VARCHAR(100) NOT NULL,
        title VARCHAR(255),
        message TEXT,
        severity VARCHAR(20) DEFAULT 'info',
        user_email VARCHAR(255),
        user_type VARCHAR(50),
        tenant_id UUID,
        tenant_name VARCHAR(255),
        ip_address VARCHAR(100),
        device VARCHAR(255),
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON ${TABLE_NAME}(created_at DESC);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_category ON ${TABLE_NAME}(category);
    `);
  } finally {
    client.release();
  }
}

async function seedDefaultAuditLogs() {
  await ensureAuditLogTable();
  return [];
}

async function recordAuditEvent(payload = {}) {
  await ensureAuditLogTable();
  const client = await centralPool.connect();

  try {
    const result = await client.query(
      `INSERT INTO ${TABLE_NAME} (category, action, title, message, severity, user_email, user_type, tenant_id, tenant_name, ip_address, device, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *;`,
      [
        payload.category || "system_config",
        payload.action || "updated",
        payload.title || "System event",
        payload.message || "Audit event recorded",
        payload.severity || "info",
        payload.userEmail || null,
        payload.userType || null,
        payload.tenantId || null,
        payload.tenantName || null,
        payload.ipAddress || null,
        payload.device || null,
        JSON.stringify(payload.metadata || {}),
      ],
    );
    return result.rows[0];
  } finally {
    client.release();
  }
}

async function getAuditLogs({
  limit = 100,
  offset = 0,
  search = "",
  category = "",
  severity = "",
  tenantName = "",
  tenantId = "",
} = {}) {
  await ensureAuditLogTable();
  await seedDefaultAuditLogs();

  const client = await centralPool.connect();
  try {
    const conditions = [];
    const values = [];
    let index = 1;

    if (search) {
      conditions.push(`(
        LOWER(COALESCE(title, '')) LIKE $${index} OR
        LOWER(COALESCE(message, '')) LIKE $${index} OR
        LOWER(COALESCE(user_email, '')) LIKE $${index} OR
        LOWER(COALESCE(tenant_name, '')) LIKE $${index}
      )`);
      values.push(`%${search.toLowerCase()}%`);
      index += 1;
    }

    if (category) {
      conditions.push(`category = $${index}`);
      values.push(category);
      index += 1;
    }

    if (severity) {
      conditions.push(`severity = $${index}`);
      values.push(severity);
      index += 1;
    }

    if (tenantName) {
      conditions.push(`LOWER(COALESCE(tenant_name, '')) LIKE $${index}`);
      values.push(`%${tenantName.toLowerCase()}%`);
      index += 1;
    }

    if (tenantId) {
      conditions.push(`tenant_id = $${index}`);
      values.push(tenantId);
      index += 1;
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limitValue = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 250);
    const offsetValue = Math.max(parseInt(offset, 10) || 0, 0);

    const query = `
      SELECT *
      FROM ${TABLE_NAME}
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${index} OFFSET $${index + 1};
    `;

    values.push(limitValue, offsetValue);
    const result = await client.query(query, values);

    const totalResult = await client.query(
      `SELECT COUNT(*) AS total FROM ${TABLE_NAME} ${whereClause}`,
      values.slice(0, values.length - 2),
    );

    return {
      items: result.rows.map((row) => ({
        ...row,
        metadata: row.metadata || {},
      })),
      total: parseInt(totalResult.rows[0].total, 10),
      limit: limitValue,
      offset: offsetValue,
      categories: CATEGORY_CONFIG,
    };
  } finally {
    client.release();
  }
}

async function getAuditStats({ tenantName = "", tenantId = "" } = {}) {
  await ensureAuditLogTable();
  await seedDefaultAuditLogs();

  const client = await centralPool.connect();
  try {
    const conditions = [];
    const values = [];
    let index = 1;

    if (tenantName) {
      conditions.push(`LOWER(COALESCE(tenant_name, '')) LIKE $${index}`);
      values.push(`%${tenantName.toLowerCase()}%`);
      index += 1;
    }

    if (tenantId) {
      conditions.push(`tenant_id = $${index}`);
      values.push(tenantId);
      index += 1;
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const [summaryRes, categoryRes, severityRes] = await Promise.all([
      client.query(
        `
        SELECT COUNT(*) AS total,
               COUNT(CASE WHEN severity = 'warning' THEN 1 END) AS warnings,
               COUNT(CASE WHEN severity = 'success' THEN 1 END) AS successes,
               MAX(created_at) AS latest
        FROM ${TABLE_NAME}
        ${whereClause};
      `,
        values,
      ),
      client.query(
        `
        SELECT category, COUNT(*) AS count
        FROM ${TABLE_NAME}
        ${whereClause}
        GROUP BY category
        ORDER BY count DESC;
      `,
        values,
      ),
      client.query(
        `
        SELECT severity, COUNT(*) AS count
        FROM ${TABLE_NAME}
        ${whereClause}
        GROUP BY severity
        ORDER BY count DESC;
      `,
        values,
      ),
    ]);

    return {
      summary: summaryRes.rows[0],
      categories: categoryRes.rows,
      severities: severityRes.rows,
    };
  } finally {
    client.release();
  }
}

module.exports = {
  CATEGORY_CONFIG,
  ensureAuditLogTable,
  seedDefaultAuditLogs,
  recordAuditEvent,
  getAuditLogs,
  getAuditStats,
};
