const express = require("express");
const router = express.Router();
const {
  authenticateToken,
  requireAdmin,
} = require("../../middleware/auth.middleware");
const packageCtrl = require("../../controller/superadmin_package.controller");

// Simple demo endpoints for super-admin panel
router.get("/overview", authenticateToken, requireAdmin, async (req, res) => {
  // Return basic platform metrics (placeholder)
  res.json({
    success: true,
    data: {
      totalTenants: 128,
      activeTenants: 114,
      uptime: "99.94%",
      monthlyRecurring: "₹8.6L",
      openTickets: 7,
    },
  });
});

router.get(
  "/tenants/recent",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    // Placeholder: return empty list or sample tenants
    res.json({ success: true, data: [] });
  },
);

// Package management routes
router.get("/packages", authenticateToken, requireAdmin, packageCtrl.getAllPackages);
router.post("/packages", authenticateToken, requireAdmin, packageCtrl.createPackage);
router.put("/packages/:id", authenticateToken, requireAdmin, packageCtrl.updatePackage);
router.delete("/packages/:id", authenticateToken, requireAdmin, packageCtrl.deletePackage);

module.exports = router;
