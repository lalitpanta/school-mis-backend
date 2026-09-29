const { centralPool } = require("../config/tenantDb");
const { recordAuditEvent } = require("./auditLog.service");
const { createHash } = require("crypto");
const { v4: uuidv4 } = require("uuid");

const SESSION_TABLE = "active_sessions";
let ensureTablePromise;

async function ensureActiveSessionsTable() {
  if (!ensureTablePromise) {
    ensureTablePromise = (async () => {
      await centralPool.query(`
        CREATE TABLE IF NOT EXISTS ${SESSION_TABLE} (
          session_id UUID PRIMARY KEY,
          token_fingerprint VARCHAR(64) UNIQUE,
          tenant_id UUID NOT NULL,
          user_id TEXT NOT NULL,
          user_email VARCHAR(255) NOT NULL,
          user_type VARCHAR(50),
          ip_address VARCHAR(100),
          user_agent TEXT,
          signed_in_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_active_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          expires_at TIMESTAMPTZ,
          revoked_at TIMESTAMPTZ
        )
      `);
      await centralPool.query(
        `ALTER TABLE ${SESSION_TABLE} ADD COLUMN IF NOT EXISTS token_fingerprint VARCHAR(64)`,
      );
      await centralPool.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_active_sessions_token_fingerprint ON ${SESSION_TABLE}(token_fingerprint) WHERE token_fingerprint IS NOT NULL`,
      );
      await centralPool.query(
        `CREATE INDEX IF NOT EXISTS idx_active_sessions_tenant_active ON ${SESSION_TABLE}(tenant_id, revoked_at, last_active_at DESC)`,
      );
    })().catch((error) => {
      ensureTablePromise = null;
      throw error;
    });
  }
  await ensureTablePromise;
}

function getClientIp(req) {
  return req?.ip || req?.socket?.remoteAddress || null;
}

async function createActiveSession({ token, sessionId, user, tenant, req }) {
  await ensureActiveSessionsTable();
  const decodedToken = require("jsonwebtoken").decode(token) || {};
  const tenantId = tenant?.id || user?.tenantId;
  if (!tenantId) return;
  const tokenFingerprint = createHash("sha256").update(token).digest("hex");

  await centralPool.query(
    `INSERT INTO ${SESSION_TABLE}
      (session_id, token_fingerprint, tenant_id, user_id, user_email, user_type, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (session_id) DO NOTHING`,
    [
      sessionId,
      tokenFingerprint,
      tenantId,
      String(user?.id || tenantId),
      user?.email || tenant?.email || "unknown",
      user?.type || "tenant",
      getClientIp(req),
      req?.headers?.["user-agent"] || null,
      decodedToken.exp ? new Date(decodedToken.exp * 1000) : null,
    ],
  );
}

async function registerLegacySession({ token, decodedToken, req }) {
  await ensureActiveSessionsTable();
  const tenantId =
    decodedToken?.tenantId ||
    (decodedToken?.type === "tenant" ? decodedToken.id : null);
  if (!tenantId || !decodedToken?.id || !decodedToken?.email) return null;

  const tokenFingerprint = createHash("sha256").update(token).digest("hex");
  const result = await centralPool.query(
    `INSERT INTO ${SESSION_TABLE}
      (session_id, token_fingerprint, tenant_id, user_id, user_email, user_type, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (token_fingerprint) DO UPDATE SET token_fingerprint = EXCLUDED.token_fingerprint
     RETURNING session_id, revoked_at, expires_at`,
    [
      uuidv4(),
      tokenFingerprint,
      tenantId,
      String(decodedToken.id),
      decodedToken.email,
      decodedToken.type,
      getClientIp(req),
      req?.headers?.["user-agent"] || null,
      decodedToken.exp ? new Date(decodedToken.exp * 1000) : null,
    ],
  );
  return result.rows[0] || null;
}

async function isSessionActive(sessionId) {
  await ensureActiveSessionsTable();
  const result = await centralPool.query(
    `SELECT 1 FROM ${SESSION_TABLE}
     WHERE session_id = $1 AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,
    [sessionId],
  );
  return result.rowCount > 0;
}

async function touchActiveSession(sessionId) {
  await centralPool.query(
    `UPDATE ${SESSION_TABLE}
     SET last_active_at = CURRENT_TIMESTAMP
     WHERE session_id = $1 AND revoked_at IS NULL
       AND last_active_at < CURRENT_TIMESTAMP - INTERVAL '1 minute'`,
    [sessionId],
  );
}

async function listTenantSessions(tenantId) {
  await ensureActiveSessionsTable();
  const result = await centralPool.query(
    `SELECT session_id, user_id, user_email, user_type, ip_address, user_agent,
            signed_in_at, last_active_at
     FROM ${SESSION_TABLE}
     WHERE tenant_id = $1 AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
     ORDER BY signed_in_at DESC`,
    [tenantId],
  );
  return result.rows;
}

async function revokeTenantSession({
  tenantId,
  sessionId,
  currentSessionId,
  req,
}) {
  await ensureActiveSessionsTable();
  const result = await centralPool.query(
    `UPDATE ${SESSION_TABLE}
     SET revoked_at = CURRENT_TIMESTAMP
     WHERE tenant_id = $1 AND session_id = $2 AND revoked_at IS NULL
     RETURNING user_email`,
    [tenantId, sessionId],
  );
  if (result.rowCount && sessionId !== currentSessionId) {
    await recordAuditEvent({
      category: "security",
      action: "session_revoked",
      title: "Session signed out",
      message: `A session for ${result.rows[0].user_email} was signed out by the tenant.`,
      severity: "warning",
      userEmail: req?.user?.email || null,
      userType: req?.user?.type || null,
      tenantId,
      ipAddress: getClientIp(req),
      device: req?.headers?.["user-agent"] || null,
      metadata: { sessionId },
    });
  }
  return result.rowCount > 0;
}

async function revokeOtherTenantSessions({ tenantId, currentSessionId, req }) {
  await ensureActiveSessionsTable();
  const result = await centralPool.query(
    `UPDATE ${SESSION_TABLE}
     SET revoked_at = CURRENT_TIMESTAMP
     WHERE tenant_id = $1 AND session_id <> $2 AND revoked_at IS NULL
     RETURNING session_id`,
    [tenantId, currentSessionId],
  );
  await recordAuditEvent({
    category: "security",
    action: "other_sessions_revoked",
    title: "Other sessions signed out",
    message: `Signed out ${result.rowCount} other session${result.rowCount === 1 ? "" : "s"}.`,
    severity: "warning",
    userEmail: req?.user?.email || null,
    userType: req?.user?.type || null,
    tenantId,
    ipAddress: getClientIp(req),
    device: req?.headers?.["user-agent"] || null,
    metadata: { revokedCount: result.rowCount },
  });
  return result.rowCount;
}

async function endCurrentSession({ tenantId, sessionId, req }) {
  if (!sessionId) return false;
  await ensureActiveSessionsTable();
  const result = await centralPool.query(
    `UPDATE ${SESSION_TABLE}
     SET revoked_at = CURRENT_TIMESTAMP
     WHERE tenant_id = $1 AND session_id = $2 AND revoked_at IS NULL
     RETURNING user_email`,
    [tenantId, sessionId],
  );
  if (result.rowCount) {
    await recordAuditEvent({
      category: "authentication",
      action: "logout",
      title: "User signed out",
      message: `${req?.user?.email || result.rows[0].user_email} signed out.`,
      severity: "info",
      userEmail: req?.user?.email || result.rows[0].user_email,
      userType: req?.user?.type || null,
      tenantId,
      ipAddress: getClientIp(req),
      device: req?.headers?.["user-agent"] || null,
      metadata: { sessionId },
    });
  }
  return result.rowCount > 0;
}

module.exports = {
  ensureActiveSessionsTable,
  createActiveSession,
  registerLegacySession,
  isSessionActive,
  touchActiveSession,
  listTenantSessions,
  revokeTenantSession,
  revokeOtherTenantSessions,
  endCurrentSession,
};
