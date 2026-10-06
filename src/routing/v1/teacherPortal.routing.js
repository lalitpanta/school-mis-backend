const express = require("express");
const teacherPortalController = require("../../controller/teacherPortal.controller");

const router = express.Router();

router.use(teacherPortalController.requireTeacher);

router.get("/overview", teacherPortalController.getOverview);
router.get("/classes/:classroomId/students", teacherPortalController.getClassStudents);
router.get("/exams", teacherPortalController.getAssignedExams);
router.get("/exams/:examFormatId", teacherPortalController.getAssignedExam);
router.post("/exams/:examFormatId/marks", teacherPortalController.saveAssignedExamMarks);
router.post("/exams/:examFormatId/submit", teacherPortalController.submitAssignedExam);
router.post("/leave", teacherPortalController.requestLeave);

module.exports = router;
