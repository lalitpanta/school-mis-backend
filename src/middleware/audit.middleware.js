const { recordAuditEvent } = require("../services/auditLog.service");

function sanitizePayload(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const clone = Array.isArray(payload) ? [...payload] : { ...payload };

  const forbiddenKeys = new Set([
    "password",
    "password_hash",
    "token",
    "accessToken",
    "refreshToken",
    "secret",
    "authorization",
    "cookie",
    "session",
  ]);

  function walk(value) {
    if (Array.isArray(value)) {
      return value.map(walk);
    }
    if (value && typeof value === "object") {
      const out = {};
      for (const [key, nested] of Object.entries(value)) {
        out[key] = forbiddenKeys.has(key.toLowerCase()) ? "[redacted]" : walk(nested);
      }
      return out;
    }
    return value;
  }

  return walk(clone);
}

function inferEntityFromPath(path = "") {
  const cleaned = path.split("?")[0].replace(/^\/+/, "");
  const segments = cleaned.split("/").filter(Boolean);
  if (!segments.length) return "record";

  const candidates = [
    "students",
    "teachers",
    "employees",
    "users",
    "roles",
    "permissions",
    "classes",
    "sections",
    "rooms",
    "departments",
    "devices",
    "attendance",
    "fees",
    "calendar",
    "day-category",
    "year",
    "month",
    "day",
    "daily-reports",
    "results",
    "accounts",
    "settings",
  ];

  const match = segments.find((segment) => candidates.includes(segment));
  return match ? match.replace(/-/g, " ") : segments[0];
}

function inferCategory(entityName) {
  const normalized = String(entityName || "").toLowerCase();
  if (["students", "teachers", "employees", "classes", "sections", "rooms", "departments", "attendance", "daily reports", "results", "calendar", "year", "month", "day"].includes(normalized)) {
    return "academic";
  }
  if (["users", "roles", "permissions"].includes(normalized)) {
    return "user_roles";
  }
  if (["fees", "accounts"].includes(normalized)) {
    return "billing";
  }
  return "system_config";
}

function getActionLabel(method) {
  if (method === "POST") return "create";
  if (method === "PUT" || method === "PATCH") return "update";
  if (method === "DELETE") return "delete";
  return "access";
}

function getTitleLabel(entityName, method) {
  const action = getActionLabel(method);
  const entity = entityName || "record";
  if (action === "create") return `${entity} created`;
  if (action === "update") return `${entity} updated`;
  if (action === "delete") return `${entity} deleted`;
  return `${entity} accessed`;
}

function auditMutationRequest(req, res, next) {
  if (!req.user || !["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return next();
  }

  const path = req.originalUrl || req.url || "";
  if (path.includes("/auth/") || path.includes("/health")) {
    return next();
  }

  const actor = req.user || {};
  const entityName = inferEntityFromPath(path);
  const action = getActionLabel(req.method);

  const capture = () => {
    const payload = sanitizePayload(req.body || {});
    const metadata = {
      method: req.method,
      path,
      entity: entityName,
      payload: Object.keys(payload || {}).length ? payload : null,
    };

    recordAuditEvent({
      category: inferCategory(entityName),
      action,
      title: getTitleLabel(entityName, req.method),
      message: `${actor.email || "User"} performed ${action} on ${entityName} via ${path}.`,
      severity: action === "delete" ? "warning" : action === "create" ? "success" : "info",
      userEmail: actor.email || actor.userEmail || null,
      userType: actor.type || actor.userType || null,
      tenantId: req.tenantId || actor.tenantId || null,
      tenantName: req.tenantName || actor.tenantName || null,
      ipAddress: req.ip || null,
      device: req.headers?.["user-agent"] || null,
      metadata,
    }).catch((error) => {
      console.error("Route audit log failed:", error.message);
    });
  };

  const originalJson = res.json.bind(res);
  res.json = function patchedJson(body) {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      capture();
    }
    return originalJson(body);
  };

  const originalSend = res.send.bind(res);
  res.send = function patchedSend(body) {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      capture();
    }
    return originalSend(body);
  };

  next();
}

module.exports = auditMutationRequest;
