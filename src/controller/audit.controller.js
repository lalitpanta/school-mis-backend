const auditLogService = require("../services/auditLog.service");

class AuditController {
  getAuditLogs = async (req, res, next) => {
    try {
      const {
        limit,
        offset,
        search,
        category,
        severity,
        tenantName,
        tenantId: queryTenantId,
      } = req.query;

      const tenantId =
        queryTenantId ||
        req.tenantId ||
        req.user?.tenantId ||
        (req.user?.type === "tenant" ? req.user.id : null) ||
        (req.user?.type === "staff" ? req.user.tenantId : null);

      const result = await auditLogService.getAuditLogs({
        limit,
        offset,
        search,
        category,
        severity,
        tenantName,
        tenantId,
      });
      return res.status(200).json({
        success: true,
        message: "Audit logs retrieved successfully",
        data: result.items,
        meta: {
          total: result.total,
          limit: result.limit,
          offset: result.offset,
          categories: result.categories,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  getAuditStats = async (req, res, next) => {
    try {
      const { tenantName, tenantId: queryTenantId } = req.query;
      const tenantId =
        queryTenantId ||
        req.tenantId ||
        req.user?.tenantId ||
        (req.user?.type === "tenant" ? req.user.id : null) ||
        (req.user?.type === "staff" ? req.user.tenantId : null);

      const result = await auditLogService.getAuditStats({
        tenantName,
        tenantId,
      });
      return res.status(200).json({
        success: true,
        message: "Audit statistics retrieved successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };
}

const auditCTRL = new AuditController();
module.exports = auditCTRL;
