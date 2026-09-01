const express = require("express");
const masterRouter = express.Router();
const {
  authenticateToken,
  requireAdmin,
  requireTenant,
  requireModule,
  requireAdminOrTenantModule,
  attachTenantContext,
} = require("../middleware/auth.middleware");
const resultController = require("../controller/result.controller");
const auditCTRL = require("../controller/audit.controller");

// Authentication routes (public & protected)
masterRouter.use("/auth", require("./v1/auth.routing"));

// Public result lookup route (no auth required)
masterRouter.get("/results/public", resultController.getPublicStudentResults);

// Super-admin audit routes
masterRouter.get(
  "/settings/audit-logs",
  authenticateToken,
  requireAdmin,
  auditCTRL.getAuditLogs,
);
masterRouter.get(
  "/settings/audit-stats",
  authenticateToken,
  requireAdmin,
  auditCTRL.getAuditStats,
);

// School/Tenant specific routes
masterRouter.use(
  "/year",
  authenticateToken,
  requireTenant,
  attachTenantContext,
  requireModule("calendar"),
  require("./v1/year.routing"),
);
masterRouter.use(
  "/month",
  authenticateToken,
  requireTenant,
  attachTenantContext,
  requireModule("calendar"),
  require("./v1/month_class_data.routing"),
);
masterRouter.use(
  "/day",
  authenticateToken,
  requireTenant,
  attachTenantContext,
  requireModule("calendar"),
  require("./v1/day_classification.routing"),
);
masterRouter.use(
  "/calendar",
  authenticateToken,
  requireTenant,
  attachTenantContext,
  requireModule("calendar"),
  require("./v1/calendar.routing"),
);
masterRouter.use(
  "/calendar-days",
  authenticateToken,
  requireTenant,
  attachTenantContext,
  requireModule("calendar"),
  require("./v1/calendar_days.routing"),
);
masterRouter.use(
  "/day-category",
  authenticateToken,
  requireTenant,
  attachTenantContext,
  requireModule("calendar"),
  require("./v1/day_category.routing"),
);
masterRouter.use(
  "/settings",
  authenticateToken,
  attachTenantContext,
  requireAdminOrTenantModule("settings"),
  require("./v1/settings.routing"),
);

masterRouter.use(
  "/results",
  authenticateToken,
  requireTenant,
  attachTenantContext,
  requireModule("results"),
  require("./v1/result.routing"),
);

masterRouter.use(
  "/teachers",
  authenticateToken,
  requireTenant,
  attachTenantContext,
  require("./v1/teacher.routing"),
);

masterRouter.use(
  "/roles",
  authenticateToken,
  requireTenant,
  attachTenantContext,
  requireModule("settings"),
  require("./v1/role.routing"),
);

masterRouter.use(
  "/permissions",
  authenticateToken,
  requireTenant,
  attachTenantContext,
  requireModule("settings"),
  require("./v1/permission.routing"),
);

masterRouter.use(
  "/users",
  authenticateToken,
  requireTenant,
  attachTenantContext,
  requireModule("settings"),
  require("./v1/user.routing"),
);

masterRouter.use(
  "/users-with-roles",
  authenticateToken,
  requireTenant,
  attachTenantContext,
  require("./v1/user-role.routing"),
);

masterRouter.use(
  "/departments",
  authenticateToken,
  requireTenant,
  attachTenantContext,
  require("./v1/department.routing"),
);

masterRouter.use(
  "/employees",
  authenticateToken,
  requireTenant,
  attachTenantContext,
  require("./v1/employees.routing"),
);

masterRouter.use(
  "/classes",
  authenticateToken,
  requireTenant,
  attachTenantContext,
  require("./v1/classes.routing"),
);

masterRouter.use(
  "/sections",
  authenticateToken,
  requireTenant,
  attachTenantContext,
  require("./v1/sections.routing"),
);

masterRouter.use(
  "/rooms",
  authenticateToken,
  requireTenant,
  attachTenantContext,
  require("./v1/rooms.routing"),
);

masterRouter.use(
  "/attendance",
  authenticateToken,
  requireTenant,
  attachTenantContext,
  require("./v1/attendance.routing"),
);

masterRouter.use(
  "/devices",
  authenticateToken,
  requireTenant,
  attachTenantContext,
  require("./v1/device.routing"),
);

masterRouter.use(
  "/daily-reports",
  authenticateToken,
  requireTenant,
  attachTenantContext,
  require("./v1/dailyReports.routing"),
);

masterRouter.use(
  "/students",
  authenticateToken,
  requireTenant,
  attachTenantContext,
  require("./v1/students.routing"),
);

masterRouter.use(
  "/fees",
  authenticateToken,
  requireTenant,
  attachTenantContext,
  require("./v1/fee.routing")
);

masterRouter.use(
  "/leave",
  authenticateToken,
  requireTenant,
  attachTenantContext,
  requireModule("leave_management"),
  require("./v1/leave.routing")
);

masterRouter.use(
  "/dashboard",
  authenticateToken,
  requireTenant,
  attachTenantContext,
  require("./v1/dashboard.routing")
);

masterRouter.use(
  "/accounts",
  authenticateToken,
  requireTenant,
  attachTenantContext,
  requireModule("accounts"),
  require("./v1/accounts.routing")
);

// Health check
masterRouter.get("/health", (req, res) => res.json({ status: "ok" }));

// Super-admin routes (design & demo APIs)
masterRouter.use(
  "/super-admin",
  authenticateToken,
  require("./v1/superadmin.routing"),
);

module.exports = masterRouter;
