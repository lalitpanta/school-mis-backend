const activeSessionService = require("../services/activeSession.service");

function getTenantId(req) {
  if (!["tenant", "staff"].includes(req.user?.type)) return null;
  return req.tenantId || req.user?.tenantId || (req.user?.type === "tenant" ? req.user.id : null);
}

class ActiveSessionController {
  list = async (req, res, next) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) {
        return res.status(403).json({ success: false, message: "Tenant access required" });
      }
      const sessions = await activeSessionService.listTenantSessions(tenantId);
      return res.status(200).json({
        success: true,
        data: sessions,
        currentSessionId: req.user?.sid || null,
      });
    } catch (error) {
      next(error);
    }
  };

  revoke = async (req, res, next) => {
    try {
      const tenantId = getTenantId(req);
      const { sessionId } = req.params;
      if (!tenantId) {
        return res.status(403).json({ success: false, message: "Tenant access required" });
      }
      if (sessionId === req.user?.sid) {
        return res.status(400).json({ success: false, message: "Use sign out to end the current session" });
      }
      const revoked = await activeSessionService.revokeTenantSession({
        tenantId,
        sessionId,
        currentSessionId: req.user?.sid,
        req,
      });
      if (!revoked) {
        return res.status(404).json({ success: false, message: "Active session not found" });
      }
      return res.status(200).json({ success: true, message: "Session signed out" });
    } catch (error) {
      next(error);
    }
  };

  revokeOthers = async (req, res, next) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId || !req.user?.sid) {
        return res.status(403).json({ success: false, message: "An active tenant session is required" });
      }
      const count = await activeSessionService.revokeOtherTenantSessions({
        tenantId,
        currentSessionId: req.user.sid,
        req,
      });
      return res.status(200).json({ success: true, data: { revokedCount: count } });
    } catch (error) {
      next(error);
    }
  };

  endCurrent = async (req, res, next) => {
    try {
      const tenantId = getTenantId(req);
      if (tenantId && req.user?.sid) {
        await activeSessionService.endCurrentSession({
          tenantId,
          sessionId: req.user.sid,
          req,
        });
      }
      return res.status(200).json({ success: true });
    } catch (error) {
      next(error);
    }
  };
}

module.exports = new ActiveSessionController();