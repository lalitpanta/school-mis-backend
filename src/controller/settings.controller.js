const settingsService = require("../services/settings.service");
const jwt = require("jsonwebtoken");

const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

function getGmailRedirectUri() {
  const apiUrl = (
    process.env.API_PUBLIC_URL || "https://school-mis-backend.onrender.com"
  ).replace(/\/$/, "");
  return `${apiUrl}/v1/settings/email/gmail/callback`;
}

function getIntegrationsUrl() {
  const frontendUrl = (
    process.env.FRONTEND_URL || "https://mis-frontend-g6g3.onrender.com"
  )
    .split(",")[0]
    .trim()
    .replace(/\/$/, "");
  return `${frontendUrl}/settings?tab=integrations`;
}

class SettingsController {
  /**
   * Get all settings
   * GET /api/settings
   */
  getAllSettings = async (req, res, next) => {
    try {
      const settings = await settingsService.getAllSettings(req);
      const emailConfig = settings.email_config;
      if (emailConfig && typeof emailConfig === "object") {
        settings.email_config = {
          ...emailConfig,
          app_password: "",
          gmail_client_secret: "",
          gmail_refresh_token: "",
          gmail_api_connected: Boolean(emailConfig.gmail_refresh_token),
          gmail_client_secret_configured: Boolean(
            emailConfig.gmail_client_secret,
          ),
          smtp_password_configured: Boolean(emailConfig.app_password),
        };
      }
      return res.status(200).json({
        message: "Settings retrieved successfully",
        data: settings,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * Update settings
   * PATCH /api/settings
   * Body: { calendar_type: "AD" }
   */
  updateSettings = async (req, res, next) => {
    try {
      const settingsToUpdate = req.body;
      const results = {};

      for (const [key, value] of Object.entries(settingsToUpdate)) {
        if (key === "classroom_layout") {
          await settingsService.deleteSetting(key, req);
          continue;
        }
        if (key === "school_profile") {
          const updatedProfile = await settingsService.upsertSchoolProfile(
            value,
            req,
          );
          results[key] = updatedProfile;
          continue;
        }
        // If value is an object, store as JSON string in DB
        let settingValue = value;
        if (key === "email_config") {
          const incoming =
            typeof value === "string" ? JSON.parse(value) : { ...value };
          const existing = await settingsService.getSettingByKey(key, req);
          for (const secretKey of [
            "app_password",
            "gmail_client_secret",
            "gmail_refresh_token",
          ]) {
            if (!incoming[secretKey] && existing?.[secretKey]) {
              incoming[secretKey] = existing[secretKey];
            }
          }
          delete incoming.gmail_api_connected;
          delete incoming.gmail_client_secret_configured;
          delete incoming.smtp_password_configured;
          settingValue = incoming;
        }
        const toStore =
          typeof settingValue === "string"
            ? settingValue
            : JSON.stringify(settingValue);
        const updated = await settingsService.updateSetting(key, toStore, req);
        // try to parse stored value for response
        try {
          const parsedValue = JSON.parse(updated.value);
          if (key === "email_config" && parsedValue && typeof parsedValue === "object") {
            results[key] = {
              ...parsedValue,
              app_password: "",
              gmail_client_secret: "",
              gmail_refresh_token: "",
              gmail_api_connected: Boolean(parsedValue.gmail_refresh_token),
              gmail_client_secret_configured: Boolean(
                parsedValue.gmail_client_secret,
              ),
              smtp_password_configured: Boolean(parsedValue.app_password),
            };
          } else {
            results[key] = parsedValue;
          }
        } catch {
          results[key] = updated.value;
        }
      }

      return res.status(200).json({
        message: "Settings updated successfully",
        data: results,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * Get school profile
   * GET /api/v1/settings/school
   */
  getSchoolProfile = async (req, res, next) => {
    try {
      const profile = await settingsService.getSchoolProfile(req);
      return res
        .status(200)
        .json({ message: "School profile retrieved", data: profile || {} });
    } catch (err) {
      next(err);
    }
  };

  /**
   * Update school profile
   * PUT /api/v1/settings/school
   */
  updateSchoolProfile = async (req, res, next) => {
    try {
      const profile = req.body || {};
      const stored = await settingsService.upsertSchoolProfile(profile, req);
      return res
        .status(200)
        .json({ message: "School profile updated", data: stored });
    } catch (err) {
      next(err);
    }
  };

  /**
   * Send a test email using current integration settings
   * POST /api/v1/settings/test-email
   * Body: { to?: string, eventType?: string }
   */
  sendTestEmail = async (req, res, next) => {
    try {
      const { to, config } = req.body || {};
      const emailService = require("../services/email.service");
      const result = await emailService.sendTestEmail(req, to, config);
      const providerName = result.provider === "gmail_api" ? "Gmail API" : "SMTP";
      return res.status(200).json({
        message: result.integrationEnabled
          ? `${providerName} test email sent. Check the recipient inbox.`
          : `${providerName} test email sent, but automated email notifications remain disabled until you enable and save the integration.`,
        data: result,
      });
    } catch (err) {
      return res
        .status(400)
        .json({ message: err.message || "SMTP test failed." });
    }
  };

  startGmailOAuth = async (req, res, next) => {
    try {
      if (!req.tenantId || !req.tenantPool) {
        return res.status(400).json({
          message: "Select a school before connecting a Gmail account.",
        });
      }
      const config = await settingsService.getSettingByKey("email_config", req);
      if (!config?.email_address || !config.gmail_client_id || !config.gmail_client_secret) {
        return res.status(400).json({
          message:
            "Save the Gmail sender address, OAuth Client ID, and Client Secret first.",
        });
      }
      if (!process.env.JWT_SECRET) {
        throw new Error("JWT_SECRET is not configured on the backend.");
      }

      const state = jwt.sign(
        {
          purpose: "gmail_oauth",
          tenantId: String(req.tenantId),
          nonce: require("crypto").randomUUID(),
        },
        process.env.JWT_SECRET,
        { expiresIn: "10m" },
      );
      const authorizationUrl = new URL(
        "https://accounts.google.com/o/oauth2/v2/auth",
      );
      authorizationUrl.search = new URLSearchParams({
        client_id: config.gmail_client_id,
        redirect_uri: getGmailRedirectUri(),
        response_type: "code",
        scope: `openid email ${GMAIL_SEND_SCOPE}`,
        access_type: "offline",
        prompt: "consent select_account",
        state,
      }).toString();

      return res.status(200).json({
        message: "Continue to Google to authorize Gmail sending.",
        data: { authorizationUrl: authorizationUrl.toString() },
      });
    } catch (err) {
      next(err);
    }
  };

  gmailOAuthCallback = async (req, res) => {
    let statePayload;
    try {
      if (!process.env.JWT_SECRET || !req.query.state) {
        throw new Error("OAuth state is missing or invalid.");
      }
      statePayload = jwt.verify(req.query.state, process.env.JWT_SECRET);
      if (statePayload.purpose !== "gmail_oauth" || !statePayload.tenantId) {
        throw new Error("OAuth state is invalid.");
      }
      if (req.query.error) {
        throw new Error("Google authorization was cancelled or denied.");
      }
      if (!req.query.code) {
        throw new Error("Google did not return an authorization code.");
      }

      const { getTenantById } = require("../services/auth.service");
      const { getTenantPool } = require("../config/tenantDb");
      const tenant = await getTenantById(statePayload.tenantId);
      const callbackReq = {
        tenantId: tenant.id,
        tenantPool: getTenantPool(tenant.id, tenant.database_name),
      };
      const config = await settingsService.getSettingByKey(
        "email_config",
        callbackReq,
      );
      if (!config?.gmail_client_id || !config.gmail_client_secret) {
        throw new Error("Saved Gmail OAuth client credentials were not found.");
      }

      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: String(req.query.code),
          client_id: config.gmail_client_id,
          client_secret: config.gmail_client_secret,
          redirect_uri: getGmailRedirectUri(),
          grant_type: "authorization_code",
        }),
        signal: AbortSignal.timeout(15000),
      });
      const tokenResult = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok || !tokenResult.access_token) {
        throw new Error(
          tokenResult.error_description ||
            tokenResult.error ||
            `Google token exchange failed (HTTP ${tokenResponse.status}).`,
        );
      }

      const profileResponse = await fetch(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        {
          headers: { Authorization: `Bearer ${tokenResult.access_token}` },
          signal: AbortSignal.timeout(15000),
        },
      );
      const profile = await profileResponse.json().catch(() => ({}));
      if (!profileResponse.ok || !profile.email) {
        throw new Error("Google did not return the authorized Gmail address.");
      }

      const refreshToken = tokenResult.refresh_token || config.gmail_refresh_token;
      if (!refreshToken) {
        throw new Error(
          "Google did not issue a refresh token. Retry authorization and approve access.",
        );
      }

      const updatedConfig = {
        ...config,
        email_provider: "gmail_api",
        email_address: profile.email,
        gmail_refresh_token: refreshToken,
        gmail_authorized_email: profile.email,
        gmail_connected_at: new Date().toISOString(),
      };
      await settingsService.updateSetting(
        "email_config",
        JSON.stringify(updatedConfig),
        callbackReq,
      );

      return res.redirect(`${getIntegrationsUrl()}&gmail_connected=1`);
    } catch (err) {
      console.error("Gmail OAuth callback failed:", err.message);
      if (statePayload?.purpose === "gmail_oauth") {
        return res.redirect(`${getIntegrationsUrl()}&gmail_error=oauth_failed`);
      }
      return res.status(400).send("Gmail authorization failed. Return to Settings and try again.");
    }
  };

  /**
   * Get notification settings
   * GET /api/v1/settings/notifications
   */
  getNotificationSettings = async (req, res, next) => {
    try {
      const settings = await settingsService.getSettingByKey(
        "notifications",
        req,
      );
      return res.status(200).json({
        message: "Notification settings retrieved",
        data: settings || {},
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * Update notification settings
   * PUT /api/v1/settings/notifications
   */
  updateNotificationSettings = async (req, res, next) => {
    try {
      const payload = req.body || {};
      const stored = await settingsService.updateSetting(
        "notifications",
        JSON.stringify(payload),
        req,
      );
      let parsed;
      try {
        parsed = JSON.parse(stored.value);
      } catch {
        parsed = stored.value;
      }
      return res
        .status(200)
        .json({ message: "Notification settings updated", data: parsed });
    } catch (err) {
      next(err);
    }
  };

  /**
   * Get theme settings
   * GET /api/v1/settings/theme
   */
  getThemeSettings = async (req, res, next) => {
    try {
      const theme = await settingsService.getSettingByKey("theme", req);
      return res
        .status(200)
        .json({ message: "Theme settings retrieved", data: theme || {} });
    } catch (err) {
      next(err);
    }
  };

  /**
   * Update theme settings
   * PUT /api/v1/settings/theme
   */
  updateThemeSettings = async (req, res, next) => {
    try {
      const payload = req.body || {};
      const stored = await settingsService.updateSetting(
        "theme",
        JSON.stringify(payload),
        req,
      );
      let parsed;
      try {
        parsed = JSON.parse(stored.value);
      } catch {
        parsed = stored.value;
      }
      return res
        .status(200)
        .json({ message: "Theme settings updated", data: parsed });
    } catch (err) {
      next(err);
    }
  };

  /**
   * Get all rooms
   * GET /api/v1/settings/rooms
   */
  getRooms = async (req, res, next) => {
    try {
      const roomsService = require("../services/rooms.service");
      const pool = req.tenantPool;
      await roomsService.ensure(pool);
      const rooms = await roomsService.getAll(pool);
      return res.status(200).json({
        message: "Rooms retrieved successfully",
        data: rooms,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * Get a single room
   * GET /api/v1/settings/rooms/:id
   */
  getRoom = async (req, res, next) => {
    try {
      const roomsService = require("../services/rooms.service");
      const pool = req.tenantPool;
      const room = await roomsService.getById(pool, req.params.id);
      if (!room) {
        return res.status(404).json({ message: "Room not found", data: null });
      }
      return res
        .status(200)
        .json({ message: "Room retrieved successfully", data: room });
    } catch (err) {
      next(err);
    }
  };

  /**
   * Create a new room
   * POST /api/v1/settings/rooms
   */
  createRoom = async (req, res, next) => {
    try {
      const roomsService = require("../services/rooms.service");
      const pool = req.tenantPool;
      await roomsService.ensure(pool);
      const room = await roomsService.create(pool, req.body);
      return res.status(201).json({
        message: "Room created successfully",
        data: room,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * Update a room
   * PUT /api/v1/settings/rooms/:id
   */
  updateRoom = async (req, res, next) => {
    try {
      const roomsService = require("../services/rooms.service");
      const pool = req.tenantPool;
      const room = await roomsService.update(pool, req.params.id, req.body);
      if (!room) {
        return res.status(404).json({ message: "Room not found", data: null });
      }
      return res
        .status(200)
        .json({ message: "Room updated successfully", data: room });
    } catch (err) {
      next(err);
    }
  };

  /**
   * Delete a room
   * DELETE /api/v1/settings/rooms/:id
   */
  deleteRoom = async (req, res, next) => {
    try {
      const roomsService = require("../services/rooms.service");
      const pool = req.tenantPool;
      await roomsService.delete(pool, req.params.id);
      return res.status(200).json({
        message: "Room deleted successfully",
        data: { id: req.params.id },
      });
    } catch (err) {
      next(err);
    }
  };
}

const settingsCTRL = new SettingsController();
module.exports = settingsCTRL;
