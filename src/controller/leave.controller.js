const getLeaveRequests = async (req, res) => {
  try {
    const client = await req.tenantPool.connect();
    try {
      const { rows } = await client.query(`
        SELECT l.*, u.email as user_email, u.name as user_name, u.role as user_role
        FROM leave_requests l
        LEFT JOIN tenant_users u ON l.user_id = u.id
        ORDER BY l.created_at DESC
      `);
      res.json({ success: true, data: rows });
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getMyLeaves = async (req, res) => {
  try {
    const client = await req.tenantPool.connect();
    try {
      const { rows } = await client.query(`
        SELECT l.*, u.email as user_email, u.name as user_name
        FROM leave_requests l
        LEFT JOIN tenant_users u ON l.user_id = u.id
        WHERE l.user_id = $1
        ORDER BY l.created_at DESC
      `, [req.user.id]);
      res.json({ success: true, data: rows });
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const requestLeave = async (req, res) => {
  try {
    const { start_date, end_date, reason } = req.body;
    const client = await req.tenantPool.connect();
    try {
      const { rows } = await client.query(`
        INSERT INTO leave_requests (user_id, start_date, end_date, reason, status)
        VALUES ($1, $2, $3, $4, 'pending')
        RETURNING *
      `, [req.user.id, start_date, end_date, reason]);
      res.status(201).json({ success: true, data: rows[0] });
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateLeaveStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, admin_reply } = req.body;
    const client = await req.tenantPool.connect();
    try {
      const { rows } = await client.query(`
        UPDATE leave_requests
        SET status = $1, admin_reply = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
        RETURNING *
      `, [status, admin_reply, id]);
      if(rows.length === 0) return res.status(404).json({ success: false, message: "Not found" });
      res.json({ success: true, data: rows[0] });
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getLeaveRequests, getMyLeaves, requestLeave, updateLeaveStatus };
