const { verifyToken, getTenantById } = require("../services/auth.service");

/**
 * Middleware to verify JWT token
 */
async function authenticateToken(req, res, next) {
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
  if (!decoded.sid && ["tenant", "staff"].includes(decoded.type)) {
    try {
      const sessions = require("../services/activeSession.service");
      const session = await sessions.registerLegacySession({
        token,
        decodedToken: decoded,
        req,
      });
      if (
        !session ||
        session.revoked_at ||
        (session.expires_at && new Date(session.expires_at) <= new Date())
      ) {
        return res.status(401).json({
          success: false,
          message: "Session has ended. Please sign in again.",
        });
      }
      decoded.sid = session.session_id;
    } catch (error) {
      console.error("Legacy session registration failed:", error.message);
      return res.status(503).json({
        success: false,
        message: "Unable to register this session right now.",
      });
    }
  }
  if (decoded.sid) {
    try {
      const sessions = require("../services/activeSession.service");
      const active = await sessions.isSessionActive(decoded.sid);
      if (!active) {
        return res.status(401).json({
          success: false,
          message: "Session has ended. Please sign in again.",
        });
      }
      sessions.touchActiveSession(decoded.sid).catch((error) => {
        console.error("Session activity update failed:", error.message);
      });
    } catch (error) {
      console.error("Session validation failed:", error.message);
      return res.status(503).json({
        success: false,
        message: "Unable to validate this session right now.",
      });
    }
  }
  return next();
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

function requireTenantUser(req, res, next) {
  if (
    !["tenant", "staff", "student", "system_admin"].includes(req.user.type) ||
    !req.tenantPool
  ) {
    return res
      .status(403)
      .json({ success: false, message: "Tenant access required" });
  }
  next();
}

async function refreshStaffRoleAccess(req) {
  if (req.user?.type !== "staff") return;
  if (!req.tenantPool) {
    throw new Error("Tenant database is unavailable for staff authorization");
  }
  if (!req.roleAccessRefresh) {
    req.roleAccessRefresh = (async () => {
      const roleService = require("../services/role.service");
      await roleService.ensureRoleActiveColumn(req.tenantPool);
      const result = await req.tenantPool.query(
        `SELECT u.authority_mode, u.module_access, r.role_name, r.permissions
         FROM tenant_users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id
         LEFT JOIN roles r ON r.id = ur.role_id AND r.is_active = TRUE
         WHERE u.id = $1`,
        [req.user.id],
      );
      if (!result.rows.length) {
        throw new Error("Staff user no longer exists");
      }

      const roles = [];
      const rolePermissions = new Set();
      for (const row of result.rows) {
        if (row.role_name) roles.push(row.role_name);
        let permissions = row.permissions;
        if (typeof permissions === "string") {
          try {
            permissions = JSON.parse(permissions);
          } catch (error) {
            throw new Error(`Invalid role permissions data: ${error.message}`);
          }
        }
        if (Array.isArray(permissions)) {
          permissions.forEach((permission) =>
            rolePermissions.add(String(permission)),
          );
        } else if (permissions != null) {
          throw new Error("Role permissions must be stored as an array");
        }
      }

      let directAccess = result.rows[0].module_access || [];
      if (typeof directAccess === "string") {
        try {
          directAccess = JSON.parse(directAccess);
        } catch (error) {
          throw new Error(`Invalid staff module access data: ${error.message}`);
        }
      }
      if (!Array.isArray(directAccess)) {
        throw new Error("Staff module access must be stored as an array");
      }

      const settingsSubmodules = new Set([
        "school", "academic", "calendarsettings", "users", "roles",
        "notices", "integrations", "devices", "backup", "activitylog",
        "activesessions", "security", "departments", "classrooms",
        "courses", "rooms", "students", "theme", "profile",
      ]);
      const routeAliases = {
        teachers: "teacher",
        students: "student",
        employees: "employee",
        fee_management: "accounts",
        fees: "accounts",
      };
      const directPermissions = directAccess.map((moduleKey) => {
        const normalized = String(moduleKey).trim().toLowerCase();
        if (normalized.startsWith("settings.")) return `${normalized}.view`;
        if (settingsSubmodules.has(normalized)) {
          return `settings.${normalized}.view`;
        }
        return `${routeAliases[normalized] || normalized}.view`;
      });
      const permissions =
        result.rows[0].authority_mode === "direct_access"
          ? directPermissions
          : [...rolePermissions];

      const effectiveModules = new Set();
      for (const permission of permissions) {
        const parts = String(permission).toLowerCase().split(".");
        if (parts.length < 2 || parts[parts.length - 1] !== "view") continue;
        const permissionModule = parts.slice(0, -1).join(".");
        let routeModule = permissionModule;
        if (
          ["resultformat", "resultsubject"].includes(permissionModule) ||
          ["settings.resultformat", "settings.resultsubject"].includes(
            permissionModule,
          )
        ) {
          routeModule = "results";
        } else if (permissionModule.startsWith("settings.")) {
          routeModule = "settings";
        } else if (settingsSubmodules.has(permissionModule)) {
          routeModule = "settings";
        } else if (["fee_management", "fees"].includes(permissionModule)) {
          routeModule = "accounts";
        }
        effectiveModules.add(routeModule);
      }
      const supportedModules = new Set([
        "dashboard", "calendar", "attendance", "settings", "teacher",
        "student", "employee", "results", "result_portal",
        "daily_reports", "leave_management", "accounts",
      ]);
      req.user.permissions = permissions;
      req.user.roles = roles;
      req.user.modules = (Array.isArray(req.user.modules) ? req.user.modules : [])
        .filter((module) => supportedModules.has(module) && effectiveModules.has(module));
    })();
  }
  await req.roleAccessRefresh;
}

function requirePermission(...requiredPermissions) {
  return async (req, res, next) => {
    if (req.user.type === "tenant" || req.user.type === "system_admin")
      return next();
    try {
      await refreshStaffRoleAccess(req);
    } catch (error) {
      console.error("Failed to refresh staff role permissions:", error);
      return res.status(503).json({
        success: false,
        message: "Unable to verify current role permissions.",
      });
    }
    const permissions = Array.isArray(req.user.permissions)
      ? req.user.permissions
      : [];
    const roles = (Array.isArray(req.user.roles) ? req.user.roles : []).map(
      (role) => String(role).toLowerCase(),
    );
    const privilegedRole = roles.some((role) =>
      ["admin", "accountant", "finance manager"].includes(role),
    );
    if (
      !privilegedRole &&
      !requiredPermissions.some((permission) =>
        permissions.includes(permission),
      )
    ) {
      return res
        .status(403)
        .json({ success: false, message: "Permission denied" });
    }
    next();
  };
}

function requireSettingsPermission(fallbackModule = null) {
  const routes = [
    ["/active-sessions", "settings.activesessions"],
    ["/academic-calendar", "settings.calendarsettings"],
    ["/notifications", "settings.notices"],
    ["/sms", "settings.notices"],
    ["/audit-logs", "settings.activitylog"],
    ["/audit-stats", "settings.activitylog"],
    ["/test-email", "settings.integrations"],
    ["/email", "settings.integrations"],
    ["/classrooms", "settings.classrooms"],
    ["/sections", "settings.classrooms"],
    ["/classes", "settings.classrooms"],
    ["/students", "settings.students"],
    ["/departments", "settings.departments"],
    ["/classroom-layout", "settings.classrooms"],
    ["/security", "settings.security"],
    ["/integrations", "settings.integrations"],
    ["/devices", "settings.devices"],
    ["/backup", "settings.backup"],
    ["/activity-log", "settings.activitylog"],
    ["/rooms", "settings.rooms"],
    ["/courses", "settings.courses"],
    ["/notices", "settings.notices"],
    ["/theme", "settings.theme"],
    ["/school", "settings.school"],
    ["/users", "users"],
    ["/roles", "roles"],
    ["/permissions", "roles"],
    ["/fees", "settings.fees"],
    ["/teachers", "teacher"],
  ];

  return async (req, res, next) => {
    if (req.method === "OPTIONS") return next();
    if (req.user?.type === "tenant" || req.user?.type === "system_admin") {
      return next();
    }
    if (req.user?.type !== "staff") {
      return res
        .status(403)
        .json({ success: false, message: "Settings access denied" });
    }
    try {
      await refreshStaffRoleAccess(req);
    } catch (error) {
      console.error("Failed to refresh staff settings permissions:", error);
      return res.status(503).json({
        success: false,
        message: "Unable to verify current role permissions.",
      });
    }

    const requestPath = String(req.path || "/").toLowerCase();
    if (
      fallbackModule === "users" &&
      (requestPath === "/me" || requestPath.startsWith("/me/"))
    ) {
      return next();
    }
    const route = routes.find(
      ([prefix]) =>
        requestPath === prefix || requestPath.startsWith(`${prefix}/`),
    );
    const permissionModule = route?.[1] || fallbackModule || "settings";

    let action =
      req.method === "GET"
        ? "view"
        : req.method === "DELETE"
          ? "delete"
          : req.method === "POST"
            ? "create"
            : "edit";

    if (requestPath.endsWith("/read") || requestPath.endsWith("/logs")) {
      action = "view";
    } else if (
      requestPath.endsWith("/pin") ||
      requestPath.endsWith("/archive") ||
      requestPath.endsWith("/send-email") ||
      requestPath.endsWith("/revoke-others")
    ) {
      action = "edit";
    } else if (
      req.method === "POST" &&
      (requestPath.endsWith("/roles") ||
        requestPath.endsWith("/permissions") ||
        requestPath.endsWith("/reset-password"))
    ) {
      action = "edit";
    } else if (requestPath.endsWith("/logout")) {
      action = "view";
    } else if (
      req.method === "POST" &&
      ["/test-email", "/email/gmail/connect", "/sms/send"].some((suffix) =>
        requestPath.endsWith(suffix),
      )
    ) {
      action = "edit";
    }

    const permissions = Array.isArray(req.user.permissions)
      ? req.user.permissions.map((permission) => String(permission).toLowerCase())
      : [];
    const legacyModule = permissionModule.startsWith("settings.")
      ? permissionModule.slice("settings.".length)
      : permissionModule;
    const required = [`${permissionModule}.${action}`, `${legacyModule}.${action}`];
    if (action === "view") {
      required.push("settings.view");
    } else {
      required.push("settings.edit");
    }

    if (!required.some((permission) => permissions.includes(permission))) {
      return res
        .status(403)
        .json({ success: false, message: "Permission denied" });
    }
    return next();
  };
}

/**
 * Middleware to enforce module access for tenant users
 */
function requireModule(moduleKey) {
  return async (req, res, next) => {
    try {
      await refreshStaffRoleAccess(req);
    } catch (error) {
      console.error("Failed to refresh staff module permissions:", error);
      return res.status(503).json({
        success: false,
        message: "Unable to verify current role permissions.",
      });
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

function requireAdminOrTenantModule(moduleKey) {
  return async (req, res, next) => {
    if (req.user.type === "system_admin") {
      return next();
    }
    try {
      await refreshStaffRoleAccess(req);
    } catch (error) {
      console.error("Failed to refresh staff module permissions:", error);
      return res.status(503).json({
        success: false,
        message: "Unable to verify current role permissions.",
      });
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

    if (req.user.type === "tenant" || req.user.type === "staff") {
      req.tenantId = req.user.id;
      if (req.user.type === "staff") req.tenantId = req.user.tenantId;
      req.tenantDatabaseName = req.user.databaseName;
      req.tenantPool = getTenantPool(req.tenantId, req.user.databaseName);
    } else if (req.user.type === "student") {
      req.tenantId = req.user.tenantId;
      req.tenantDatabaseName = req.user.databaseName;
      req.tenantPool = getTenantPool(req.user.tenantId, req.user.databaseName);
      req.studentId = req.user.studentId;
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
  requireTenantUser,
  requirePermission,
  requireSettingsPermission,
  requireModule,
  requireAdminOrTenantModule,
  attachTenantContext,
};
