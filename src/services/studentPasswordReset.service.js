const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { centralPool, getTenantPool } = require("../config/tenantDb");
const emailService = require("./email.service");

const RESET_TTL_MINUTES = 60;

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function getFrontendUrl() {
  return (
    process.env.STUDENT_PORTAL_URL ||
    process.env.FRONTEND_URL ||
    "https://mis.benchmarkassociates.com.np"
  )
    .split(",")[0]
    .trim()
    .replace(/\/$/, "");
}

async function getActiveTenant(tenantSlug) {
  const normalizedSlug = String(tenantSlug || "")
    .trim()
    .toLowerCase();
  if (!normalizedSlug) return null;
  const result = await centralPool.query(
    "SELECT id, slug, database_name, name FROM tenant WHERE slug = $1 AND is_active = TRUE LIMIT 1",
    [normalizedSlug],
  );
  return result.rows[0] || null;
}

async function ensureResetSchema(pool) {
  await pool.query(
    "ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS student_record_id INTEGER;",
  );
  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_password_reset_tokens (
      id UUID PRIMARY KEY,
      tenant_user_id UUID NOT NULL REFERENCES tenant_users(id) ON DELETE CASCADE,
      token_hash CHAR(64) NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_student_password_reset_user
      ON student_password_reset_tokens(tenant_user_id, expires_at);
  `);
}

async function createStudentResetLink(pool, userId, email, tenantSlug) {
  await ensureResetSchema(pool);
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  await pool.query(
    `UPDATE student_password_reset_tokens
     SET used_at = CURRENT_TIMESTAMP
     WHERE tenant_user_id = $1 AND used_at IS NULL`,
    [userId],
  );
  await pool.query(
    `INSERT INTO student_password_reset_tokens
       (id, tenant_user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP + ($4 * INTERVAL '1 minute'))`,
    [crypto.randomUUID(), userId, tokenHash, RESET_TTL_MINUTES],
  );

  const resetUrl = new URL(`${getFrontendUrl()}/student/reset-password`);
  resetUrl.hash = new URLSearchParams({ token, tenant: tenantSlug }).toString();

  const loginUrl = new URL(`${getFrontendUrl()}/student/login`);
  loginUrl.searchParams.set("tenantSlug", tenantSlug);

  return {
    resetUrl: resetUrl.toString(),
    loginUrl: loginUrl.toString(),
    email: normalizeEmail(email),
  };
}

async function requestStudentPasswordReset(email, tenantSlug) {
  const normalizedEmail = normalizeEmail(email);
  const tenant = await getActiveTenant(tenantSlug);
  if (!normalizedEmail || !tenant) {
    return {
      message: "If the student account exists, a reset link will be emailed.",
    };
  }

  const pool = getTenantPool(tenant.id, tenant.database_name);
  await ensureResetSchema(pool);
  const accountResult = await pool.query(
    `SELECT id, email, name
     FROM tenant_users
     WHERE LOWER(email) = $1
       AND student_record_id IS NOT NULL
       AND is_active = TRUE
     LIMIT 1`,
    [normalizedEmail],
  );
  const account = accountResult.rows[0];
  if (!account) {
    return {
      message: "If the student account exists, a reset link will be emailed.",
    };
  }

  const link = await createStudentResetLink(
    pool,
    account.id,
    account.email,
    tenant.slug,
  );
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937">
      <h2>Student portal password reset</h2>
      <p>Hello ${String(account.name || "Student").replace(/[<>]/g, "")},</p>
      <p>Use the secure link below to choose a new password. The link expires in ${RESET_TTL_MINUTES} minutes and can only be used once.</p>
      <p><a href="${link.resetUrl}" style="display:inline-block;padding:12px 18px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px">Reset password</a></p>
      <p>If you did not request this, you can ignore this email.</p>
    </div>`;
  await emailService.sendEmail(
    { tenantPool: pool },
    account.email,
    "Student portal password reset",
    html,
  );

  return {
    message: "If the student account exists, a reset link will be emailed.",
  };
}

async function resetStudentPassword(token, tenantSlug, newPassword) {
  if (String(newPassword || "").length < 8) {
    throw new Error("Password must be at least 8 characters long.");
  }
  const tenant = await getActiveTenant(tenantSlug);
  if (!tenant || !token) {
    throw new Error("This reset link is invalid or has expired.");
  }

  const pool = getTenantPool(tenant.id, tenant.database_name);
  await ensureResetSchema(pool);
  const tokenHash = crypto
    .createHash("sha256")
    .update(String(token))
    .digest("hex");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tokenResult = await client.query(
      `SELECT reset.id, reset.tenant_user_id
       FROM student_password_reset_tokens reset
       JOIN tenant_users user_account ON user_account.id = reset.tenant_user_id
       WHERE reset.token_hash = $1
         AND reset.used_at IS NULL
         AND reset.expires_at > CURRENT_TIMESTAMP
         AND user_account.student_record_id IS NOT NULL
         AND user_account.is_active = TRUE
       FOR UPDATE OF reset`,
      [tokenHash],
    );
    const reset = tokenResult.rows[0];
    if (!reset) {
      throw new Error("This reset link is invalid or has expired.");
    }

    const passwordHash = await bcrypt.hash(String(newPassword), 12);
    await client.query(
      `UPDATE tenant_users
       SET password_hash = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND student_record_id IS NOT NULL`,
      [passwordHash, reset.tenant_user_id],
    );
    await client.query(
      "UPDATE student_password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = $1",
      [reset.id],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return {
    message: "Password reset successfully. Sign in with your new password.",
  };
}

module.exports = {
  createStudentResetLink,
  requestStudentPasswordReset,
  resetStudentPassword,
};
