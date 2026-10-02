const teacherService = require("./teacher.service");
const coursesService = require("./courses.service");
const resultService = require("./result.service");

class TeacherPortalService {
  getContext = async (req) => {
    const teacherId = req?.user?.teacherId;
    if (!teacherId) throw new Error("Teacher profile is not linked to this account.");

    const pool = req.tenantPool;
    await teacherService.ensureTable(pool);
    await coursesService.ensureTable(pool);
    await resultService.ensure(pool);
    await pool.query(
      "ALTER TABLE sections ADD COLUMN IF NOT EXISTS class_teacher_id UUID",
    );
    return { pool, teacherId, tenantId: req.tenantId };
  };

  getOverview = async (req) => {
    const { pool, teacherId, tenantId } = await this.getContext(req);
    const [profileResult, classesResult, coursesResult, examsResult, attendanceResult, leaveResult, calendarMonthsResult, calendarDaysResult] =
      await Promise.all([
        pool.query(
          `SELECT id, employee_id, full_name, designation, department_id,
                  personal_email, personal_phone, work_email, work_phone,
                  current_address, office_room, join_date, subjects_taught,
                  highest_qualification, profile_photo_url
           FROM teachers WHERE id = $1 AND is_active = TRUE`,
          [teacherId],
        ),
        pool.query(
          `SELECT c.id, c.name, s.id AS section_id, s.section_name,
                  COUNT(DISTINCT st.id)::int AS student_count
           FROM classrooms c
           LEFT JOIN sections s ON s.class_id = c.id
           LEFT JOIN students st
             ON (st.classroom_id = c.id OR st.class_id = c.id)
            AND (s.id IS NULL OR st.section_id = s.id)
            AND st.is_active = TRUE
           WHERE c.is_active = TRUE
             AND (
               c.class_teacher_id = $1
               OR s.class_teacher_id = $1
               OR EXISTS (
                 SELECT 1 FROM courses assigned_course
                 WHERE assigned_course.primary_teacher_id = $1
                   AND assigned_course.classroom_id = c.id
                   AND (
                     assigned_course.section_id IS NULL
                     OR assigned_course.section_id = s.id
                   )
               )
             )
           GROUP BY c.id, c.name, s.id, s.section_name
           ORDER BY c.name, s.section_name`,
          [teacherId],
        ),
        pool.query(
          `SELECT c.id, c.course_name, c.course_code, c.description,
                  c.periods_per_week, c.scheduled_days, c.full_marks_theory,
                  c.pass_marks_theory, c.full_marks_practical,
                  c.classroom_id, cr.name AS class_name,
                  c.section_id, s.section_name
           FROM courses c
           LEFT JOIN classrooms cr ON cr.id = c.classroom_id
           LEFT JOIN sections s ON s.id = c.section_id
           WHERE c.is_active = TRUE
             AND (
               c.primary_teacher_id = $1
               OR c.classroom_id IN (
                 SELECT id FROM classrooms WHERE class_teacher_id = $1
               )
               OR c.section_id IN (
                 SELECT id FROM sections WHERE class_teacher_id = $1
               )
             )
           ORDER BY cr.name, s.section_name, c.course_name`,
          [teacherId],
        ),
        pool.query(
          `SELECT ef.id, ef.exam_type, ef.term, ef.exam_date,
                  ef.is_published, ef.pass_mark_percentage,
                  ef.class_id, c.name AS class_name,
                  ef.section_id, s.section_name,
                  COUNT(DISTINCT es.id)::int AS subject_count,
                  COUNT(DISTINCT sm.student_id)::int AS students_with_marks
           FROM exam_formats ef
           LEFT JOIN classrooms c ON c.id = ef.class_id
           LEFT JOIN sections s ON s.id = ef.section_id
           LEFT JOIN exam_subjects es ON es.exam_format_id = ef.id
           LEFT JOIN student_marks sm ON sm.exam_format_id = ef.id
           WHERE ef.class_id IN (
             SELECT id FROM classrooms WHERE class_teacher_id = $1
           )
           OR ef.section_id IN (
             SELECT id FROM sections WHERE class_teacher_id = $1
           )
           OR EXISTS (
             SELECT 1 FROM courses assigned_course
             WHERE assigned_course.primary_teacher_id = $1
               AND assigned_course.classroom_id = ef.class_id
               AND (
                 assigned_course.section_id IS NULL
                 OR assigned_course.section_id = ef.section_id
               )
           )
           GROUP BY ef.id, c.name, s.section_name
           ORDER BY ef.exam_date DESC NULLS LAST, ef.id DESC
           LIMIT 30`,
          [teacherId],
        ),
        pool.query(
          `SELECT dar.id, dar.check_type, dar.check_time, dar.device_id
           FROM device_attendance_records dar
           JOIN device_teacher_enrollments enrollment
             ON enrollment.device_user_id = dar.device_user_id
            AND enrollment.tenant_id = dar.tenant_id
           WHERE enrollment.user_id = $1 AND dar.tenant_id = $2
           ORDER BY dar.check_time DESC
           LIMIT 20`,
          [teacherId, tenantId],
        ),
        pool.query(
          `SELECT id, start_date, end_date, leave_type, reason, status,
                  admin_reply, created_at
           FROM leave_requests WHERE user_id = $1
           ORDER BY created_at DESC LIMIT 20`,
          [req.user.id],
        ),
        pool.query(`
          SELECT m.id, m.month_name, m.bs_month_index,
                 m.month_start_date_BS, m.month_end_date_BS,
                 y.year_label, y.year_label_BS
          FROM month_class_data m
          JOIN "year" y ON y.id = m.year_id
          WHERE y.id = (
            SELECT id FROM "year"
            ORDER BY is_current DESC, created_at DESC
            LIMIT 1
          )
          ORDER BY m.bs_month_index ASC
        `),
        pool.query(`
          SELECT cd.id, cd.month_id, cd.day_number, cd.day_of_week,
                 dc.day_type, cat.category_name, m.month_name,
                 m.bs_month_index, y.year_label
          FROM calendar_days cd
          JOIN month_class_data m ON m.id = cd.month_id
          JOIN "year" y ON y.id = m.year_id
          LEFT JOIN day_classification dc ON dc.id = cd.day_type_id
          LEFT JOIN day_category cat ON cat.id = dc.category_id
          WHERE y.id = (
            SELECT id FROM "year"
            ORDER BY is_current DESC, created_at DESC
            LIMIT 1
          )
          ORDER BY m.bs_month_index, cd.day_number
        `),
      ]);

    return {
      profile: profileResult.rows[0] || null,
      classes: classesResult.rows,
      courses: coursesResult.rows,
      exams: examsResult.rows,
      attendance: attendanceResult.rows,
      leaveRequests: leaveResult.rows,
      calendarMonths: calendarMonthsResult.rows,
      calendarDays: calendarDaysResult.rows,
    };
  };

  getClassStudents = async (classroomId, sectionId, req) => {
    const { pool, teacherId } = await this.getContext(req);
    const classResult = await pool.query(
      `SELECT id FROM classrooms c
       WHERE c.id = $1 AND (
         c.class_teacher_id = $2
         OR EXISTS (
           SELECT 1 FROM sections assigned_section
           WHERE assigned_section.class_id = c.id
             AND assigned_section.class_teacher_id = $2
             AND ($3::integer IS NULL OR assigned_section.id = $3)
         )
         OR EXISTS (
           SELECT 1 FROM courses assigned_course
           WHERE assigned_course.classroom_id = c.id
             AND assigned_course.primary_teacher_id = $2
             AND (
               assigned_course.section_id IS NULL
               OR assigned_course.section_id = $3
             )
         )
       )`,
      [classroomId, teacherId, sectionId || null],
    );
    if (!classResult.rows.length) return null;

    const result = await pool.query(
      `SELECT DISTINCT st.id, st.full_name, st.roll_no, st.gender,
              st.student_mail, st.phone_no, st.section_id,
              s.section_name
       FROM students st
       LEFT JOIN sections s ON s.id = st.section_id
       WHERE st.is_active = TRUE
         AND (st.classroom_id = $1 OR st.class_id = $1)
         AND ($3::integer IS NULL OR st.section_id = $3)
         AND (
           EXISTS (
             SELECT 1 FROM classrooms c
             WHERE c.id = $1 AND c.class_teacher_id = $2
           )
           OR EXISTS (
             SELECT 1 FROM sections assigned_section
             WHERE assigned_section.id = st.section_id
               AND assigned_section.class_teacher_id = $2
           )
           OR EXISTS (
             SELECT 1 FROM courses assigned_course
             WHERE assigned_course.classroom_id = $1
               AND assigned_course.primary_teacher_id = $2
               AND (
                 assigned_course.section_id IS NULL
                 OR assigned_course.section_id = st.section_id
               )
           )
         )
       ORDER BY s.section_name, st.roll_no NULLS LAST, st.full_name
       LIMIT 500`,
      [classroomId, teacherId, sectionId || null],
    );
    return result.rows;
  };

  requestLeave = async (req, data) => {
    const { pool } = await this.getContext(req);
    const startDate = String(data.start_date || "").trim();
    const endDate = String(data.end_date || "").trim();
    const reason = String(data.reason || "").trim();
    const leaveType = String(data.leave_type || "Other").trim();
    if (!startDate || !endDate || !reason) {
      throw new Error("Start date, end date, and reason are required.");
    }
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(endDate) ||
      Number.isNaN(Date.parse(startDate)) ||
      Number.isNaN(Date.parse(endDate)) ||
      endDate < startDate
    ) {
      throw new Error("Enter a valid leave date range.");
    }
    const result = await pool.query(
      `INSERT INTO leave_requests
         (user_id, start_date, end_date, leave_type, reason, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING id, start_date, end_date, leave_type, reason, status,
                 admin_reply, created_at`,
      [req.user.id, startDate, endDate, leaveType, reason],
    );
    return result.rows[0];
  };
}

module.exports = new TeacherPortalService();
