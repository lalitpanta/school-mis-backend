const studentsService = require("../services/students.service");

class StudentsController {
  list = async (req, res, next) => {
    try {
      const rows = await studentsService.list(req);
      return res
        .status(200)
        .json({ message: "Students retrieved", data: rows });
    } catch (err) {
      next(err);
    }
  };

  get = async (req, res, next) => {
    try {
      if (
        req.user?.type === "student" &&
        Number(req.params.id) !== Number(req.user.studentId)
      ) {
        return res.status(403).json({ message: "Access denied" });
      }
      const student = await studentsService.get(req.params.id, req);
      if (!student)
        return res.status(404).json({ message: "Student not found" });
      return res
        .status(200)
        .json({ message: "Student retrieved", data: student });
    } catch (err) {
      next(err);
    }
  };

  getCurrentStudent = async (req, res, next) => {
    try {
      if (!req.user || req.user.type !== "student") {
        return res.status(403).json({ message: "Student access required" });
      }
      const student = await studentsService.get(req.user.studentId, req);
      if (!student)
        return res.status(404).json({ message: "Student not found" });
      return res
        .status(200)
        .json({ message: "Student profile retrieved", data: student });
    } catch (err) {
      next(err);
    }
  };

  getCurrentStudentCourses = async (req, res, next) => {
    try {
      if (req.user?.type !== "student" || !req.user.studentId) {
        return res.status(403).json({ message: "Student access required" });
      }
      const student = await studentsService.get(req.user.studentId, req);
      if (!student) {
        return res.status(404).json({ message: "Student not found" });
      }
      if (!student.classroom_id) {
        return res.status(200).json({ data: [] });
      }
      const resultService = require("../services/result.service");
      const courses = await resultService.getClassCourses(
        student.classroom_id,
        req,
      );
      return res.status(200).json({ data: courses });
    } catch (err) {
      next(err);
    }
  };

  getCurrentStudentExams = async (req, res, next) => {
    try {
      if (req.user?.type !== "student" || !req.user.studentId) {
        return res.status(403).json({ message: "Student access required" });
      }
      const student = await studentsService.get(req.user.studentId, req);
      if (!student) {
        return res.status(404).json({ message: "Student not found" });
      }
      if (!student.classroom_id) {
        return res.status(200).json({ data: [] });
      }
      const resultService = require("../services/result.service");
      const exams = await resultService.getExamFormats(
        {
          class_id: student.classroom_id,
          section_id: student.section_id,
          publishedOnly: true,
        },
        req,
      );
      return res.status(200).json({ data: exams });
    } catch (err) {
      next(err);
    }
  };

  updateCurrentStudent = async (req, res, next) => {
    try {
      if (!req.user || req.user.type !== "student" || !req.user.studentId) {
        return res.status(403).json({ message: "Student access required" });
      }
      const editableFields = [
        "phone_no",
        "address",
        "current_address",
        "home_district",
        "home_municipality",
        "home_ward",
        "home_full_address",
        "guardian_name",
        "guardian_email",
        "guardian_phone",
      ];
      const profileUpdates = Object.fromEntries(
        editableFields
          .filter((field) => Object.hasOwn(req.body || {}, field))
          .map((field) => [field, req.body[field]]),
      );
      const profilePicture = req.files?.profile_picture_file?.[0];
      if (profilePicture) {
        profileUpdates.profile_picture = `/uploads/students/${profilePicture.filename}`;
      }
      if (!Object.keys(profileUpdates).length) {
        return res.status(400).json({
          message: "Provide at least one editable profile field.",
        });
      }

      const updated = await studentsService.update(
        req.user.studentId,
        profileUpdates,
        req,
      );
      if (!updated) {
        return res.status(404).json({ message: "Student profile not found" });
      }
      return res.status(200).json({
        message: "Student profile updated.",
        data: updated,
      });
    } catch (err) {
      next(err);
    }
  };

  getCurrentStudentLeaveRequests = async (req, res, next) => {
    try {
      if (req.user?.type !== "student" || !req.user.id) {
        return res.status(403).json({ message: "Student access required" });
      }
      const { rows } = await req.tenantPool.query(
        `SELECT id, start_date, end_date, leave_type, reason, status, admin_reply, created_at
         FROM leave_requests
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [req.user.id],
      );
      return res.status(200).json({
        message: "Student leave requests retrieved",
        data: rows,
      });
    } catch (err) {
      next(err);
    }
  };

  createCurrentStudentLeaveRequest = async (req, res, next) => {
    try {
      if (req.user?.type !== "student" || !req.user.id) {
        return res.status(403).json({ message: "Student access required" });
      }
      const { start_date, end_date, leave_type, reason } = req.body || {};
      if (
        !start_date ||
        !end_date ||
        !reason?.trim() ||
        new Date(end_date) < new Date(start_date)
      ) {
        return res.status(400).json({
          message: "Valid dates and a reason are required",
        });
      }
      const { rows } = await req.tenantPool.query(
        `INSERT INTO leave_requests (user_id, start_date, end_date, leave_type, reason, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')
         RETURNING id, start_date, end_date, leave_type, reason, status, admin_reply, created_at`,
        [req.user.id, start_date, end_date, leave_type || "Other", reason.trim()],
      );
      return res.status(201).json({
        message: "Leave request submitted",
        data: rows[0],
      });
    } catch (err) {
      next(err);
    }
  };

  create = async (req, res, next) => {
    try {
      const payload = req.body || {};
      // handle profile picture
      if (
        req.files &&
        req.files.profile_picture_file &&
        req.files.profile_picture_file[0]
      ) {
        payload.profile_picture = `/uploads/students/${req.files.profile_picture_file[0].filename}`;
      }
      // handle document uploads (append JSON entries)
      if (req.files && req.files.documents && req.files.documents.length) {
        const titlesRaw = req.body.document_titles;
        let titles = [];
        if (titlesRaw) {
          try {
            titles = JSON.parse(titlesRaw);
          } catch (e) {
            titles = Array.isArray(titlesRaw) ? titlesRaw : [titlesRaw];
          }
        }
        const docs = req.files.documents.map((f, i) => ({
          id: Date.now().toString(36) + "-" + i,
          title: titles[i] || f.originalname,
          url: `/uploads/students/${f.filename}`,
          uploaded_at: new Date().toISOString(),
        }));
        payload.documents = docs;
      }
      const created = await studentsService.create(payload, req);

      // Trigger WhatsApp notification for new student
      if (created) {
        const whatsappService = require("../services/whatsapp.service");
        whatsappService
          .sendWhatsAppForEvent(req, "student_created", {
            to: created.phone_no || created.guardian_phone,
            studentName: created.full_name || "Student",
            admissionNo: created.admission_no || "N/A",
            schoolName: "Our School",
          })
          .catch((err) => console.error("WhatsApp error:", err));
      }

      return res
        .status(201)
        .json({ message: "Student created", data: created });
    } catch (err) {
      next(err);
    }
  };

  update = async (req, res, next) => {
    try {
      const payload = req.body || {};
      if (
        req.files &&
        req.files.profile_picture_file &&
        req.files.profile_picture_file[0]
      ) {
        payload.profile_picture = `/uploads/students/${req.files.profile_picture_file[0].filename}`;
      }
      if (req.files && req.files.documents && req.files.documents.length) {
        const existing = await studentsService.get(req.params.id, req);
        const existingDocs = existing?.documents || [];
        const titlesRaw = req.body.document_titles;
        let titles = [];
        if (titlesRaw) {
          try {
            titles = JSON.parse(titlesRaw);
          } catch (e) {
            titles = Array.isArray(titlesRaw) ? titlesRaw : [titlesRaw];
          }
        }
        const newDocs = req.files.documents.map((f, i) => ({
          id: Date.now().toString(36) + "-" + i,
          title: titles[i] || f.originalname,
          url: `/uploads/students/${f.filename}`,
          uploaded_at: new Date().toISOString(),
        }));
        payload.documents = Array.isArray(existingDocs)
          ? [...existingDocs, ...newDocs]
          : [...(existingDocs || []), ...newDocs];
      }
      const updated = await studentsService.update(req.params.id, payload, req);
      return res
        .status(200)
        .json({ message: "Student updated", data: updated });
    } catch (err) {
      next(err);
    }
  };

  remove = async (req, res, next) => {
    try {
      const deleted = await studentsService.remove(req.params.id, req);
      if (!deleted)
        return res.status(404).json({ message: "Student not found" });
      return res
        .status(200)
        .json({ message: "Student deleted", data: deleted });
    } catch (err) {
      next(err);
    }
  };

  removeDocument = async (req, res, next) => {
    try {
      const { id, docId } = req.params;
      const updated = await studentsService.removeDocument(id, docId, req);
      if (!updated)
        return res
          .status(404)
          .json({ message: "Student or document not found" });
      return res
        .status(200)
        .json({ message: "Document removed", data: updated });
    } catch (err) {
      next(err);
    }
  };

  importBulk = async (req, res, next) => {
    try {
      const payload = req.body?.students || [];
      const created = await studentsService.importBulk(payload, req);
      return res
        .status(200)
        .json({ message: "Students imported", data: created });
    } catch (err) {
      next(err);
    }
  };

  exportCsv = async (req, res, next) => {
    try {
      const csv = await studentsService.exportCsv(req);
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=students.csv");
      return res.status(200).send(csv);
    } catch (err) {
      next(err);
    }
  };
}

module.exports = new StudentsController();
