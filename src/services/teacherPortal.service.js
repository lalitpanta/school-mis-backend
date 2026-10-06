const teacherService = require("./teacher.service");
const coursesService = require("./courses.service");
const resultService = require("./result.service");

const createRequestError = (message, statusCode) =>
  Object.assign(new Error(message), { statusCode });

class TeacherPortalService {
  getContext = async (req) => {
    const teacherId = req?.user?.teacherId;
    if (!teacherId) throw new Error("Teacher profile is not linked to this account.");

    const pool = req.tenantPool;
    await teacherService.ensureTable(pool);
    await teacherService.ensureTeacherCoursesTable(pool);
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
                 SELECT 1 FROM teacher_courses tc
                 JOIN courses assigned_course ON assigned_course.id = tc.course_id
                 WHERE tc.teacher_id = $1
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
               OR EXISTS (
                 SELECT 1 FROM teacher_courses tc
                 WHERE tc.teacher_id = $1 AND tc.course_id = c.id
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
           FROM exam_teacher_assignments eta
           JOIN exam_formats ef ON ef.id = eta.exam_format_id
           LEFT JOIN classrooms c ON c.id = ef.class_id
           LEFT JOIN sections s ON s.id = ef.section_id
           JOIN exam_subjects es ON es.exam_format_id = ef.id
           JOIN courses assigned_course ON assigned_course.id = es.course_id
           JOIN teacher_courses tc
             ON tc.course_id = assigned_course.id AND tc.teacher_id = eta.teacher_id
           LEFT JOIN student_marks sm
             ON sm.exam_format_id = ef.id AND sm.exam_subject_id = es.id
           WHERE eta.teacher_id = $1
             AND assigned_course.is_active = TRUE
             AND assigned_course.classroom_id = ef.class_id
             AND (
               assigned_course.section_id IS NULL
               OR ef.section_id IS NULL
               OR assigned_course.section_id = ef.section_id
             )
           GROUP BY ef.id, eta.id, c.name, s.section_name
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

  getAssignedExams = async (req) => {
    const { pool, teacherId } = await this.getContext(req);
    const result = await pool.query(
      `SELECT ef.id, ef.exam_type, ef.term, ef.exam_date,
              ef.is_published, ef.pass_mark_percentage,
              ef.class_id, c.name AS class_name,
              ef.section_id, s.section_name,
              eta.status, eta.submitted_at,
              COUNT(DISTINCT course.id)::int AS course_count,
              COUNT(DISTINCT sm.id)::int AS marks_entered
       FROM exam_teacher_assignments eta
       JOIN exam_formats ef ON ef.id = eta.exam_format_id
       JOIN classrooms c ON c.id = ef.class_id
       LEFT JOIN sections s ON s.id = ef.section_id
       JOIN exam_subjects es ON es.exam_format_id = ef.id
       JOIN courses course ON course.id = es.course_id
       JOIN teacher_courses tc
         ON tc.course_id = course.id AND tc.teacher_id = eta.teacher_id
       LEFT JOIN student_marks sm
         ON sm.exam_format_id = ef.id AND sm.exam_subject_id = es.id
       WHERE eta.teacher_id = $1
         AND course.is_active = TRUE
         AND course.classroom_id = ef.class_id
         AND (
           course.section_id IS NULL
           OR ef.section_id IS NULL
           OR course.section_id = ef.section_id
         )
       GROUP BY ef.id, eta.id, c.name, s.section_name
       ORDER BY ef.exam_date DESC NULLS LAST, ef.id DESC`,
      [teacherId],
    );
    return result.rows;
  };

  getAssignedExam = async (examFormatId, req) => {
    const { pool, teacherId } = await this.getContext(req);
    const examResult = await pool.query(
      `SELECT ef.id, ef.exam_type, ef.term, ef.exam_date,
              ef.is_published, ef.pass_mark_percentage,
              ef.class_id, c.name AS class_name,
              ef.section_id, s.section_name,
              eta.status, eta.submitted_at
       FROM exam_teacher_assignments eta
       JOIN exam_formats ef ON ef.id = eta.exam_format_id
       LEFT JOIN classrooms c ON c.id = ef.class_id
       LEFT JOIN sections s ON s.id = ef.section_id
       WHERE eta.exam_format_id = $1 AND eta.teacher_id = $2`,
      [examFormatId, teacherId],
    );
    if (!examResult.rows.length) {
      throw createRequestError(
        "This exam format has not been shared with your teacher account.",
        404,
      );
    }

    const [subjectsResult, studentsResult] = await Promise.all([
      pool.query(
        `SELECT es.id, es.course_id, es.subject_name,
                es.theory_max_marks, es.practical_max_marks,
                es.total_max_marks, course.course_name,
                course.course_code,
                COALESCE(course.section_id, ef.section_id) AS section_id,
                COALESCE(course_section.section_name, exam_section.section_name) AS section_name
         FROM exam_subjects es
         JOIN exam_formats ef ON ef.id = es.exam_format_id
         JOIN courses course ON course.id = es.course_id
         JOIN teacher_courses tc
           ON tc.course_id = course.id AND tc.teacher_id = $2
         LEFT JOIN sections course_section ON course_section.id = course.section_id
         LEFT JOIN sections exam_section ON exam_section.id = ef.section_id
         WHERE es.exam_format_id = $1
           AND course.is_active = TRUE
           AND course.classroom_id = ef.class_id
           AND (
             course.section_id IS NULL
             OR ef.section_id IS NULL
             OR course.section_id = ef.section_id
           )
         ORDER BY course.course_name, es.subject_name`,
        [examFormatId, teacherId],
      ),
      pool.query(
        `SELECT id, full_name, roll_no, section_id
         FROM students
         WHERE is_active = TRUE
           AND (
             classroom_id = (SELECT class_id FROM exam_formats WHERE id = $1)
             OR class_id = (SELECT class_id FROM exam_formats WHERE id = $1)
           )
           AND (
             (SELECT section_id FROM exam_formats WHERE id = $1) IS NULL
             OR section_id = (SELECT section_id FROM exam_formats WHERE id = $1)
           )
         ORDER BY roll_no NULLS LAST, full_name`,
        [examFormatId],
      ),
    ]);
    if (!subjectsResult.rows.length) {
      throw createRequestError(
        "Your course assignments no longer match this exam format.",
        403,
      );
    }

    const marksResult = await pool.query(
      `SELECT sm.id, sm.exam_subject_id, sm.student_id,
              sm.theory_marks, sm.practical_marks, sm.total_marks,
              sm.is_pass, sm.remarks
       FROM student_marks sm
       JOIN exam_subjects es ON es.id = sm.exam_subject_id
       WHERE sm.exam_format_id = $1
         AND es.id = ANY($2::integer[])`,
      [examFormatId, subjectsResult.rows.map((subject) => subject.id)],
    );
    return {
      exam: examResult.rows[0],
      subjects: subjectsResult.rows,
      students: studentsResult.rows,
      marks: marksResult.rows,
    };
  };

  saveAssignedExamMarks = async (examFormatId, data, req) => {
    const { pool, teacherId } = await this.getContext(req);
    const marks = data?.marks;
    if (!Array.isArray(marks) || marks.length === 0) {
      throw createRequestError("Provide at least one student mark to save.", 400);
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const assignmentResult = await client.query(
        `SELECT status FROM exam_teacher_assignments
         WHERE exam_format_id = $1 AND teacher_id = $2
         FOR UPDATE`,
        [examFormatId, teacherId],
      );
      if (!assignmentResult.rows.length) {
        throw createRequestError(
          "This exam format has not been shared with your teacher account.",
          404,
        );
      }
      if (assignmentResult.rows[0].status === "submitted") {
        throw createRequestError(
          "Marks have been submitted and can no longer be edited.",
          409,
        );
      }

      const [subjectsResult, studentsResult, examResult] = await Promise.all([
        client.query(
          `SELECT es.id, es.theory_max_marks, es.practical_max_marks,
                  es.total_max_marks, course.section_id
           FROM exam_subjects es
           JOIN exam_formats ef ON ef.id = es.exam_format_id
           JOIN courses course ON course.id = es.course_id
           JOIN teacher_courses tc
             ON tc.course_id = course.id AND tc.teacher_id = $2
           WHERE ef.id = $1
             AND course.is_active = TRUE
             AND course.classroom_id = ef.class_id
             AND (
               course.section_id IS NULL
               OR ef.section_id IS NULL
               OR course.section_id = ef.section_id
             )`,
          [examFormatId, teacherId],
        ),
        client.query(
          `SELECT id, section_id
           FROM students
           WHERE is_active = TRUE
             AND (
               classroom_id = (SELECT class_id FROM exam_formats WHERE id = $1)
               OR class_id = (SELECT class_id FROM exam_formats WHERE id = $1)
             )
             AND (
               (SELECT section_id FROM exam_formats WHERE id = $1) IS NULL
               OR section_id = (SELECT section_id FROM exam_formats WHERE id = $1)
             )`,
          [examFormatId],
        ),
        client.query(
          "SELECT pass_mark_percentage, section_id FROM exam_formats WHERE id = $1",
          [examFormatId],
        ),
      ]);
      if (!subjectsResult.rows.length || !examResult.rows.length) {
        throw createRequestError(
          "Your course assignments no longer match this exam format.",
          403,
        );
      }
      const subjectById = new Map(
        subjectsResult.rows.map((subject) => [String(subject.id), subject]),
      );
      const studentById = new Map(
        studentsResult.rows.map((student) => [String(student.id), student]),
      );
      const seenPairs = new Set();
      const passPercentage =
        Number(examResult.rows[0].pass_mark_percentage) || 40;

      for (const mark of marks) {
        const subjectId = String(mark?.exam_subject_id ?? "");
        const studentId = String(mark?.student_id ?? "");
        const subject = subjectById.get(subjectId);
        const student = studentById.get(studentId);
        const requiredSectionId = subject?.section_id || examResult.rows[0].section_id;
        if (
          !subject ||
          !student ||
          (requiredSectionId &&
            String(student.section_id) !== String(requiredSectionId))
        ) {
          throw createRequestError(
            "A mark references a student or course outside your shared exam assignment.",
            403,
          );
        }
        const pair = `${subjectId}:${studentId}`;
        if (seenPairs.has(pair)) {
          throw createRequestError(
            "Each student can only be included once per course.",
            400,
          );
        }
        seenPairs.add(pair);

        const parseMark = (value, maximum, label) => {
          if (value === null || value === undefined || String(value).trim() === "") {
            return null;
          }
          const parsed = Number(value);
          if (
            !Number.isFinite(parsed) ||
            parsed < 0 ||
            parsed > Number(maximum || 0)
          ) {
            throw createRequestError(
              `${label} must be between 0 and ${Number(maximum || 0)}.`,
              400,
            );
          }
          return parsed;
        };
        const theory = parseMark(
          mark.theory_marks,
          subject.theory_max_marks,
          "Theory marks",
        );
        const practical = parseMark(
          mark.practical_marks,
          subject.practical_max_marks,
          "Practical marks",
        );
        const total =
          theory === null && practical === null
            ? null
            : (theory || 0) + (practical || 0);
        if (
          total !== null &&
          total > Number(subject.total_max_marks || 0)
        ) {
          throw createRequestError(
            `Total marks cannot exceed ${Number(subject.total_max_marks || 0)}.`,
            400,
          );
        }
        const isPass =
          total !== null &&
          total >=
            (Number(subject.total_max_marks || 0) * passPercentage) / 100;

        const existingResult = await client.query(
          `SELECT id FROM student_marks
           WHERE exam_format_id = $1
             AND exam_subject_id = $2
             AND student_id = $3
           ORDER BY id
           LIMIT 1
           FOR UPDATE`,
          [examFormatId, subject.id, studentId],
        );
        if (total === null) {
          if (existingResult.rows[0]) {
            await client.query("DELETE FROM student_marks WHERE id = $1", [
              existingResult.rows[0].id,
            ]);
          }
          continue;
        }

        const values = [
          theory,
          practical,
          total,
          isPass,
          String(mark.remarks || "").trim() || null,
        ];
        if (existingResult.rows[0]) {
          await client.query(
            `UPDATE student_marks
             SET theory_marks = $1, practical_marks = $2, total_marks = $3,
                 is_pass = $4, remarks = $5, updated_at = CURRENT_TIMESTAMP
             WHERE id = $6`,
            [...values, existingResult.rows[0].id],
          );
        } else {
          await client.query(
            `INSERT INTO student_marks
               (exam_format_id, exam_subject_id, student_id, theory_marks,
                practical_marks, total_marks, is_pass, remarks)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [examFormatId, subject.id, studentId, ...values],
          );
        }
      }
      await client.query("COMMIT");
      return { saved: seenPairs.size };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  };

  submitAssignedExam = async (examFormatId, req) => {
    const { pool, teacherId } = await this.getContext(req);
    const detail = await this.getAssignedExam(examFormatId, req);
    if (!detail.students.length) {
      throw createRequestError(
        "There are no active students in this exam section to submit.",
        409,
      );
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const assignmentResult = await client.query(
        `SELECT status FROM exam_teacher_assignments
         WHERE exam_format_id = $1 AND teacher_id = $2
         FOR UPDATE`,
        [examFormatId, teacherId],
      );
      if (!assignmentResult.rows.length) {
        throw createRequestError(
          "This exam format has not been shared with your teacher account.",
          404,
        );
      }
      if (assignmentResult.rows[0].status === "submitted") {
        await client.query("COMMIT");
        return { status: "submitted" };
      }

      const incompleteResult = await client.query(
        `SELECT COALESCE(
                  SUM(
                    CASE
                      WHEN COALESCE(es.theory_max_marks, 0) > 0
                           AND sm.theory_marks IS NULL THEN 1
                      ELSE 0
                    END
                    +
                    CASE
                      WHEN COALESCE(es.practical_max_marks, 0) > 0
                           AND sm.practical_marks IS NULL THEN 1
                      ELSE 0
                    END
                  ),
                  0
                )::int AS incomplete_count
         FROM exam_subjects es
         JOIN exam_formats ef ON ef.id = es.exam_format_id
         JOIN courses course ON course.id = es.course_id
         JOIN teacher_courses tc
           ON tc.course_id = course.id AND tc.teacher_id = $2
         CROSS JOIN students st
         LEFT JOIN student_marks sm
           ON sm.exam_format_id = ef.id
          AND sm.exam_subject_id = es.id
          AND sm.student_id = st.id
         WHERE ef.id = $1
           AND course.is_active = TRUE
           AND course.classroom_id = ef.class_id
           AND (
             course.section_id IS NULL
             OR ef.section_id IS NULL
             OR course.section_id = ef.section_id
           )
           AND st.is_active = TRUE
           AND (
             st.classroom_id = ef.class_id OR st.class_id = ef.class_id
           )
           AND (
             COALESCE(course.section_id, ef.section_id) IS NULL
             OR st.section_id = COALESCE(course.section_id, ef.section_id)
           )
           `,
        [examFormatId, teacherId],
      );
      const incompleteCount = incompleteResult.rows[0]?.incomplete_count || 0;
      if (incompleteCount > 0) {
        throw createRequestError(
          `Complete all required marks before submitting. ${incompleteCount} mark field(s) are still empty.`,
          409,
        );
      }

      const updated = await client.query(
        `UPDATE exam_teacher_assignments
         SET status = 'submitted', submitted_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE exam_format_id = $1 AND teacher_id = $2
         RETURNING status, submitted_at`,
        [examFormatId, teacherId],
      );
      await client.query("COMMIT");
      return updated.rows[0];
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
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
