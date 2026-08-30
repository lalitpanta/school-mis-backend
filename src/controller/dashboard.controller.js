const getDashboardStats = async (req, res) => {
  try {
    const client = await req.tenantPool.connect();
    try {
      // Students
      const studentRes = await client.query(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN is_active = true THEN 1 ELSE 0 END) as active
        FROM students
      `);
      const totalStudents = parseInt(studentRes.rows[0].total) || 0;
      const activeStudents = parseInt(studentRes.rows[0].active) || 0;
      const inactiveStudents = totalStudents - activeStudents;

      // Teachers
      const teacherRes = await client.query(`SELECT COUNT(*) as total FROM teachers`);
      const totalTeachers = parseInt(teacherRes.rows[0].total) || 0;

      // Fees
      const feeRes = await client.query(`
        SELECT COALESCE(SUM(total_amount), 0) as collected 
        FROM fee_receipts 
        WHERE status = 'active'
      `);
      const feeCollected = parseFloat(feeRes.rows[0].collected) || 0;

      const feePendingRes = await client.query(`
        SELECT COALESCE(SUM(balance), 0) as pending
        FROM student_fees
        WHERE status != 'paid'
      `);
      const feePending = parseFloat(feePendingRes.rows[0].pending) || 0;

      // Recent Students
      const recentStudentsRes = await client.query(`
        SELECT s.full_name, s.is_active, c.class_name
        FROM students s
        LEFT JOIN classes c ON s.class_id = c.id
        ORDER BY s.created_at DESC
        LIMIT 5
      `);

      res.json({
        success: true,
        data: {
          totalStudents,
          activeStudents,
          inactiveStudents,
          totalTeachers,
          feeCollected,
          feePending,
          recentStudents: recentStudentsRes.rows
        }
      });
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getDashboardStats };
