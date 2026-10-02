const express = require("express");
const teacherPortalController = require("../../controller/teacherPortal.controller");

const router = express.Router();

router.get("/overview", teacherPortalController.getOverview);
router.get("/classes/:classroomId/students", teacherPortalController.getClassStudents);
router.post("/leave", teacherPortalController.requestLeave);

module.exports = router;
