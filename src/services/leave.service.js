const createLeaveError = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });

const isValidDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

const isUuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

class LeaveService {
  validateRequest = (data = {}) => {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw createLeaveError("Leave request details are required.");
    }
    const startDate =
      typeof data.start_date === "string" ? data.start_date.trim() : "";
    const endDate =
      typeof data.end_date === "string" ? data.end_date.trim() : "";
    const leaveType =
      data.leave_type === undefined
        ? "Other"
        : typeof data.leave_type === "string"
          ? data.leave_type.trim()
          : "";
    const reason = typeof data.reason === "string" ? data.reason.trim() : "";

    if (!isValidDate(startDate) || !isValidDate(endDate) || endDate < startDate) {
      throw createLeaveError("Enter a valid leave date range.");
    }
    if (!leaveType || leaveType.length > 50) {
      throw createLeaveError("Leave type must be between 1 and 50 characters.");
    }
    if (!reason || reason.length > 2000) {
      throw createLeaveError("Reason is required and must be 2,000 characters or fewer.");
    }
    return { startDate, endDate, leaveType, reason };
  };

  createRequest = async (pool, userId, data) => {
    if (!userId) throw createLeaveError("A signed-in account is required.", 401);
    const { startDate, endDate, leaveType, reason } = this.validateRequest(data);
    const { rows } = await pool.query(
      `INSERT INTO leave_requests
         (user_id, start_date, end_date, leave_type, reason, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING id, user_id, start_date, end_date, leave_type, reason, status,
                 admin_reply, created_at, updated_at`,
      [userId, startDate, endDate, leaveType, reason],
    );
    return rows[0];
  };

  listForUser = async (pool, userId) => {
    if (!userId) throw createLeaveError("A signed-in account is required.", 401);
    const { rows } = await pool.query(
      `SELECT id, user_id, start_date, end_date, leave_type, reason, status,
              admin_reply, created_at, updated_at
       FROM leave_requests
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId],
    );
    return rows;
  };

  listAll = async (pool) => {
    const { rows } = await pool.query(
      `SELECT l.*,
              u.email AS user_email,
              COALESCE(NULLIF(BTRIM(u.name), ''), u.email, 'Unknown') AS user_name,
              CASE
                WHEN u.student_record_id IS NOT NULL THEN 'Student'
                WHEN u.teacher_id IS NOT NULL THEN 'Teacher'
                WHEN u.employee_id IS NOT NULL THEN 'Staff'
                ELSE COALESCE(NULLIF(BTRIM(u.role), ''), 'User')
              END AS requester_type
       FROM leave_requests l
       LEFT JOIN tenant_users u ON l.user_id = u.id
       ORDER BY
         CASE WHEN l.status = 'pending' THEN 0 ELSE 1 END,
         l.created_at DESC`,
    );
    return rows;
  };

  updateStatus = async (pool, id, data = {}) => {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw createLeaveError("A leave status is required.");
    }
    if (!isUuid(id)) throw createLeaveError("Invalid leave request ID.");
    const status = String(data.status || "").trim().toLowerCase();
    if (!["pending", "approved", "rejected"].includes(status)) {
      throw createLeaveError(
        "Status must be pending, approved, or rejected.",
      );
    }
    const adminReply =
      data.admin_reply === undefined
        ? null
        : data.admin_reply === null
          ? null
          : typeof data.admin_reply === "string"
            ? data.admin_reply.trim()
            : "";
    if (
      data.admin_reply !== undefined &&
      data.admin_reply !== null &&
      typeof data.admin_reply !== "string"
    ) {
      throw createLeaveError("Admin reply must be text.");
    }
    if (adminReply && adminReply.length > 2000) {
      throw createLeaveError("Admin reply must be 2,000 characters or fewer.");
    }

    const { rows } = await pool.query(
      `UPDATE leave_requests
       SET status = $1,
           admin_reply = CASE WHEN $2::boolean THEN $3 ELSE admin_reply END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING id, user_id, start_date, end_date, leave_type, reason, status,
                 admin_reply, created_at, updated_at`,
      [status, data.admin_reply !== undefined, adminReply, id],
    );
    if (!rows.length) throw createLeaveError("Leave request not found.", 404);
    return rows[0];
  };
}

module.exports = new LeaveService();
