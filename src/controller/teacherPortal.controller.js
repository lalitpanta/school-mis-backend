const teacherPortalService = require("../services/teacherPortal.service");

const roleName = (role) =>
  String(typeof role === "string" ? role : role?.role_name || "")
    .trim()
    .toLowerCase();

class TeacherPortalController {
  requireTeacher = (req, res, next) => {
    const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
    if (
      req.user?.type !== "staff" ||
      !req.user?.teacherId ||
      !roles.some((role) => roleName(role) === "teacher")
    ) {
      return res.status(403).json({
        success: false,
        message: "A linked Teacher account is required to access this portal.",
      });
    }
    next();
  };

  rejectTeacher = (req, res, next) => {
    const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
    if (
      req.user?.type === "staff" &&
      roles.some((role) => roleName(role) === "teacher")
    ) {
      return res.status(403).json({
        success: false,
        message: "Use the dedicated teacher portal for teacher account access.",
      });
    }
    next();
  };

  getOverview = async (req, res, next) => {
    try {
      const data = await teacherPortalService.getOverview(req);
      return res.status(200).json({ success: true, data });
    } catch (error) {
      return next(error);
    }
  };

  getClassStudents = async (req, res, next) => {
    try {
      const students = await teacherPortalService.getClassStudents(
        req.params.classroomId,
        req.query.sectionId,
        req,
      );
      if (!students) {
        return res.status(404).json({
          success: false,
          message: "Class not found or not assigned to this teacher.",
        });
      }
      return res.status(200).json({ success: true, data: students });
    } catch (error) {
      return next(error);
    }
  };

  requestLeave = async (req, res, next) => {
    try {
      const data = await teacherPortalService.requestLeave(req, req.body || {});
      return res.status(201).json({ success: true, data });
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message });
    }
  };
}

module.exports = new TeacherPortalController();
