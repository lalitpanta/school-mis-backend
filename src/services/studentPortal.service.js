const studentsService = require("./students.service");
const resultService = require("./result.service");
const coursesService = require("./courses.service");
const dailyReportsService = require("./dailyReports.service");
const noticesService = require("./notices.service");

class StudentPortalService {
  getDashboard = async (req) => {
    const studentId = req?.user?.studentId;
    const pool = req?.tenantPool;
    if (req?.user?.type !== "student" || !studentId || !pool) {
      throw Object.assign(new Error("Student access required."), {
        status: 403,
      });
    }

    const student = await studentsService.get(studentId, req);
    if (!student || !student.is_active) {
      throw Object.assign(new Error("Student profile is unavailable."), {
        status: 404,
      });
    }

    await Promise.all([
      resultService.ensure(pool),
      coursesService.ensureTable(pool),
      dailyReportsService.ensure(pool),
    ]);

    const classId = student.classroom_id || student.class_id || null;
    const studentProfile = {
      id: student.id,
      full_name: student.full_name,
      admission_no: student.admission_no,
      roll_no: student.roll_no,
      class_id: student.class_id,
      classroom_id: student.classroom_id,
      class_name: student.class_name,
      classroom_name: student.classroom_name,
      section_id: student.section_id,
      section_name: student.section_name,
      profile_picture: student.profile_picture,
      student_mail: student.student_mail,
      school_email: student.school_email,
      phone_no: student.phone_no,
      address: student.address,
      current_address: student.current_address,
      home_district: student.home_district,
      home_municipality: student.home_municipality,
      home_ward: student.home_ward,
      home_full_address: student.home_full_address,
      guardian_name: student.guardian_name,
      guardian_email: student.guardian_email,
      guardian_phone: student.guardian_phone,
      date_of_birth: student.date_of_birth,
      gender: student.gender,
    };
    const [hasResultsTable, hasStudentFeesTable, hasLeaveRequestsTable] = await Promise.all([
      this.hasTable(pool, "results"),
      this.hasTable(pool, "student_fees"),
      this.hasTable(pool, "leave_requests"),
    ]);
    const [publishedResults, exams, courses, fees, invoices, reports, notices, leaveRequests] =
      await Promise.all([
        hasResultsTable ? pool.query(
          `SELECT id, subject, first_term_marks, second_term_marks, final_marks,
                  grade, comments, updated_at
           FROM results
           WHERE student_id = $1 AND is_published = TRUE
           ORDER BY updated_at DESC, subject`,
          [studentId],
        ) : Promise.resolve({ rows: [] }),
        pool.query(
          `SELECT ef.id, ef.exam_type, ef.term, ef.exam_date, ef.pass_mark_percentage,
                  es.subject_name, es.total_max_marks,
                  sm.theory_marks, sm.practical_marks, sm.total_marks,
                  sm.is_pass, sm.remarks
           FROM exam_formats ef
           JOIN exam_subjects es ON es.exam_format_id = ef.id
           LEFT JOIN student_marks sm
             ON sm.exam_subject_id = es.id AND sm.student_id = $1
           WHERE ef.is_published = TRUE
             AND ((ef.section_id IS NOT NULL AND ef.section_id = $2)
               OR (ef.section_id IS NULL AND ef.class_id = $3))
           ORDER BY ef.exam_date DESC NULLS LAST, ef.id, es.subject_name`,
          [studentId, student.section_id || null, classId],
        ),
        pool.query(
          `SELECT id, course_name, course_code, short_name, description,
                  subject_type, grade_level, periods_per_week,
                  period_duration_minutes, scheduled_days, learning_outcomes,
                  textbooks, lms_digital_resource_link
           FROM courses
           WHERE is_active = TRUE AND show_in_student_portal = TRUE
             AND (classroom_id IS NULL OR classroom_id = $1)
             AND (section_id IS NULL OR section_id = $2)
           ORDER BY course_name`,
          [classId, student.section_id || null],
        ),
        hasStudentFeesTable ? pool.query(
          `SELECT id, fee_category_name AS name, amount, paid_amount, balance,
                  due_date, status
           FROM student_fees
           WHERE student_id = $1
           ORDER BY due_date NULLS LAST, id DESC`,
          [studentId],
        ) : Promise.resolve({ rows: [] }),
        this.getInvoices(pool, studentId),
        pool.query(
          `SELECT id, report, pdf_url, sent, created_at
           FROM daily_reports
           WHERE student_id = $1 AND (sent = TRUE OR pdf_url IS NOT NULL)
           ORDER BY created_at DESC
           LIMIT 20`,
          [studentId],
        ),
        noticesService.getNotices(req),
        hasLeaveRequestsTable
          ? pool.query(
              `SELECT id, start_date, end_date, reason, status, admin_reply, created_at
               FROM leave_requests
               WHERE user_id = $1
               ORDER BY created_at DESC
               LIMIT 30`,
              [req.user.id],
            )
          : Promise.resolve({ rows: [] }),
      ]);

    const visibleNotices = (Array.isArray(notices) ? notices : []).filter(
      (notice) => {
        const status = String(notice.status || "published").toLowerCase();
        const audience = String(notice.audience || "all").toLowerCase();
        const isPublished = ["published", "active", "sent"].includes(status);
        const isStudentAudience = [
          "all",
          "students",
          "all students",
          "student",
        ].includes(audience);
        const notExpired =
          !notice.expiryDate ||
          new Date(notice.expiryDate).getTime() >= Date.now();
        return isPublished && isStudentAudience && notExpired;
      },
    );

    const feeRecords = fees.rows || [];
    const courseRecords = courses.rows || [];
    const outstandingFees = feeRecords.reduce(
      (sum, fee) => sum + Number(fee.balance || 0),
      0,
    );
    const publishedMarks = publishedResults.rows || [];
    const numericMarks = publishedMarks
      .map((result) => Number(result.final_marks))
      .filter(Number.isFinite);
    const resultAverage = numericMarks.length
      ? Math.round(
          numericMarks.reduce((sum, mark) => sum + mark, 0) /
            numericMarks.length,
        )
      : null;

    return {
      student: studentProfile,
      summary: {
        resultAverage,
        publishedSubjectCount: publishedMarks.length,
        outstandingFees,
        unpaidFeeCount: feeRecords.filter(
          (fee) => Number(fee.balance || 0) > 0,
        ).length,
        unreadNoticeCount: visibleNotices.filter(
          (notice) =>
            !(Array.isArray(notice.read_by) &&
              notice.read_by.includes(String(req.user.id))),
        ).length,
      },
      results: publishedMarks,
      exams: exams.rows || [],
      courses: courseRecords,
      fees: feeRecords,
      invoices: invoices.rows || [],
      reports: reports.rows || [],
      leaveRequests: leaveRequests.rows || [],
      notices: visibleNotices,
      attendance: { available: false, records: [] },
      assignments: { available: false, records: [] },
      timetable: {
        available: courseRecords.some(
          (course) => Array.isArray(course.scheduled_days) && course.scheduled_days.length,
        ),
        records: courseRecords.filter(
          (course) => Array.isArray(course.scheduled_days) && course.scheduled_days.length,
        ),
      },
    };
  };

  hasTable = async (pool, tableName) => {
    const result = await pool.query("SELECT to_regclass($1) AS name", [tableName]);
    return Boolean(result.rows[0]?.name);
  };

  getInvoices = async (pool, studentId) => {
    const table = await pool.query("SELECT to_regclass('fee_invoices') AS name");
    if (!table.rows[0]?.name) return { rows: [] };

    return pool.query(
      `SELECT id, invoice_number, receipt_number, issue_date, due_date,
              total, amount_paid, status
       FROM fee_invoices
       WHERE student_id = $1
       ORDER BY issue_date DESC, id DESC
       LIMIT 30`,
      [studentId],
    );
  };
}

module.exports = new StudentPortalService();