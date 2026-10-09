const express = require("express");
const router = express.Router();
const {
  loginAdmin,
  loginTenant,
  loginStaff,
  studentLoginController,
  requestStudentPasswordResetController,
  resetStudentPasswordController,
  resetTenantUserPasswordController,
  unifiedLoginController,
  requestPasswordResetController,
  verifyPasswordResetOtpController,
  resetPasswordWithOtpController,
  changeTenantPasswordController,
  changeTenantEmailController,
  changeStaffPasswordController,
  changeStaffEmailController,
  createNewTenant,
  getAllTenantsController,
  getTenantByIdController,
  updateTenantStatusController,
  updateTenantController,
  deleteTenantController,
  permanentlyDeleteTenantController,
  backupTenantController,
} = require("../../controller/auth.controller");
const {
  authenticateToken,
  requireAdmin,
  requireSettingsPermission,
  attachTenantContext,
} = require("../../middleware/auth.middleware");
const activeSessionCTRL = require("../../controller/activeSession.controller");

/**
 * Public routes
 */

// Admin login
router.post("/admin/login", loginAdmin);

// Tenant login
router.post("/tenant/login", loginTenant);

// Staff/User login
router.post("/staff/login", loginStaff);

// Student-only authentication and recovery
router.post("/student/login", studentLoginController);
router.post("/student/password/forgot", requestStudentPasswordResetController);
router.post("/student/password/reset", resetStudentPasswordController);
router.post("/user/password/reset", resetTenantUserPasswordController);

// Unified login (Admin, Tenant, or Staff)
router.post("/login", unifiedLoginController);

// Forgot password OTP flow
router.post("/password/forgot", requestPasswordResetController);
router.post("/password/verify-otp", verifyPasswordResetOtpController);
router.post("/password/reset", resetPasswordWithOtpController);

/**
 * Protected routes (require authentication)
 */

// Change tenant password
router.post(
  "/session/logout",
  authenticateToken,
  attachTenantContext,
  activeSessionCTRL.endCurrent,
);

// Change tenant password
router.post(
  "/tenant/change-password",
  authenticateToken,
  changeTenantPasswordController,
);

// Change tenant email
router.post(
  "/tenant/change-email",
  authenticateToken,
  changeTenantEmailController,
);

// Change staff/user password
router.post(
  "/staff/change-password",
  authenticateToken,
  changeStaffPasswordController,
);

// Change staff/user email
router.post(
  "/staff/change-email",
  authenticateToken,
  changeStaffEmailController,
);

// Create new tenant (admin only)
router.post("/tenant/create", authenticateToken, requireAdmin, createNewTenant);

// Get all tenants (admin only)
router.get(
  "/tenant/all",
  authenticateToken,
  requireAdmin,
  getAllTenantsController,
);

// Get tenant by ID
router.get("/tenant/:id", authenticateToken, getTenantByIdController);

// Update tenant status (admin only)
router.patch(
  "/tenant/:id/status",
  authenticateToken,
  requireAdmin,
  updateTenantStatusController,
);

// Update tenant details (admin only)
router.patch(
  "/tenant/:id",
  authenticateToken,
  requireAdmin,
  updateTenantController,
);

// Permanently delete tenant - drops database (admin only) - MUST come before generic /tenant/:id delete
router.delete(
  "/tenant/:id/permanent",
  authenticateToken,
  requireAdmin,
  permanentlyDeleteTenantController,
);

// Delete tenant (admin only) - soft delete
router.delete(
  "/tenant/:id",
  authenticateToken,
  requireAdmin,
  deleteTenantController,
);

// Admins can back up any tenant; tenants and authorized staff can back up their own.
function requireTenantBackupScope(req, res, next) {
  if (req.user?.type === "system_admin") return next();

  const userTenantId =
    req.user?.type === "tenant"
      ? req.user.id
      : req.user?.type === "staff"
        ? req.user.tenantId
        : null;

  if (!userTenantId || String(userTenantId) !== String(req.params.id)) {
    return res.status(403).json({
      success: false,
      message: "You can only download a backup for your own tenant.",
    });
  }
  return next();
}

router.get(
  "/tenant/:id/backup",
  authenticateToken,
  attachTenantContext,
  requireSettingsPermission("settings.backup"),
  requireTenantBackupScope,
  backupTenantController,
);

module.exports = router;
