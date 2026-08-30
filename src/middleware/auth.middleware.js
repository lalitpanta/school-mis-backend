const { verifyToken, getTenantById } = require("../services/auth.service");

/**
 * Middleware to verify JWT token
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Access token required",
    });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(403).json({
      success: false,
      message: "Invalid or expired token",
    });
  }

  req.user = decoded;
  next();
}

/**
 * Middleware to verify admin role
 */
function requireAdmin(req, res, next) {
  if (req.user.type !== "system_admin") {
    return res.status(403).json({
      success: false,
      message: "Admin access required",
    });
  }
  next();
}

/**
 * Middleware to verify tenant role
 */
function requireTenant(req, res, next) {
  if (req.user.type !== "tenant") {
    return res.status(403).json({
      success: false,
      message: "Tenant access required",
    });
  }
  next();
}

/**
 * Middleware to enforce module access for tenant users
 */
function requireModule(moduleKey) {
  return (req, res, next) => {
    const modules = Array.isArray(req.user.modules) ? req.user.modules : [];
    if (!modules.includes(moduleKey)) {
      return res.status(403).json({
        success: false,
        message: "Module access denied",
      });
    }
    next();
  };
}

function requireAdminOrTenantModule(moduleKey) {
  return (req, res, next) => {
    if (req.user.type === "system_admin") {
      return next();
    }
    const modules = Array.isArray(req.user.modules) ? req.user.modules : [];
    if (!modules.includes(moduleKey)) {
      return res.status(403).json({
        success: false,
        message: "Module access denied",
      });
    }
    next();
  };
}

/**
 * Middleware to attach tenant database name to request
 */
async function attachTenantContext(req, res, next) {
  try {
    const { getTenantPool } = require("../config/tenantDb");

    if (req.user.type === "tenant") {
      // For tenant, database name and ID are already in token
      req.tenantId = req.user.id;
      req.tenantDatabaseName = req.user.databaseName;
      req.tenantPool = getTenantPool(req.user.id, req.user.databaseName);
    } else if (req.user.type === "system_admin") {
      // For admin, check X-Tenant-ID header if accessing tenant-specific endpoints
      const tenantIdFromHeader = req.headers["x-tenant-id"];
      if (tenantIdFromHeader) {
        req.tenantId = tenantIdFromHeader;
        const tenant = await getTenantById(tenantIdFromHeader);
        req.tenantDatabaseName = tenant.database_name;
        req.tenantPool = getTenantPool(
          tenantIdFromHeader,
          tenant.database_name,
        );
      }
    }
    next();
  } catch (error) {
    res.status(400).json({
      success: false,
      message: "Failed to attach tenant context",
    });
  }
}

module.exports = {
  authenticateToken,
  requireAdmin,
  requireTenant,
  requireModule,
  requireAdminOrTenantModule,
  attachTenantContext,
};
