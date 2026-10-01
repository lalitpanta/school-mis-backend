const nodemailer = require("nodemailer");
const settingsService = require("./settings.service");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderSubject(template, variables = {}) {
  return String(template || "").replace(/{{\s*([\w.-]+)\s*}}/g, (_, key) => {
    const value = variables[key];
    return value === null || value === undefined ? "" : String(value);
  });
}

function renderHtml(template, variables = {}) {
  return String(template || "").replace(/{{\s*([\w.-]+)\s*}}/g, (_, key) =>
    escapeHtml(variables[key]),
  );
}

function safeHeader(value) {
  return String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

function createGmailRawMessage({ from, senderName, to, subject, html }) {
  const safeSenderName = safeHeader(senderName).replace(/["\\]/g, "\\$&");
  const safeFrom = safeHeader(from);
  const safeTo = safeHeader(to);
  const encodedSubject = `=?UTF-8?B?${Buffer.from(safeHeader(subject), "utf8").toString("base64")}?=`;
  const encodedHtml = Buffer.from(String(html || ""), "utf8")
    .toString("base64")
    .replace(/.{1,76}/g, "$&\r\n");
  const message = [
    `From: "${safeSenderName || "EduSphere MIS"}" <${safeFrom}>`,
    `To: ${safeTo}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    encodedHtml,
  ].join("\r\n");

  return Buffer.from(message, "utf8").toString("base64url");
}

class EmailService {
  /**
   * Retrieves the current email configuration from settings
   */
  async getConfig(req) {
    const config = await settingsService.getSettingByKey("email_config", req);
    return config || null;
  }

  /**
   * Retrieves the current email templates from settings
   */
  async getTemplates(req) {
    const templates = await settingsService.getSettingByKey(
      "email_templates",
      req,
    );
    return templates || {};
  }

  createTransporter(config) {
    if (!config?.email_address || !config?.app_password) {
      throw new Error("Enter the sender email address and app password.");
    }

    const host = config.smtp_host || "smtp.gmail.com";
    const port = Number(config.smtp_port || 465);
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("Enter a valid SMTP host and port.");
    }

    return nodemailer.createTransport({
      host,
      port,
      secure:
        config.smtp_secure !== undefined ? config.smtp_secure : port === 465,
      auth: {
        user: config.email_address,
        pass: config.app_password,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    });
  }

  async sendWithGmailApi(config, to, subject, html) {
    const { gmail_client_id, gmail_client_secret, gmail_refresh_token } =
      config || {};
    if (!gmail_client_id || !gmail_client_secret || !gmail_refresh_token) {
      throw new Error(
        "Gmail API requires an OAuth client ID, client secret, and refresh token.",
      );
    }
    if (!config.email_address) {
      throw new Error("Enter the Gmail address used for OAuth authorization.");
    }

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: gmail_client_id,
        client_secret: gmail_client_secret,
        refresh_token: gmail_refresh_token,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(15000),
    });
    const tokenResult = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenResult.access_token) {
      const reason =
        tokenResult.error_description ||
        tokenResult.error ||
        `HTTP ${tokenResponse.status}`;
      throw new Error(`Gmail OAuth token request failed: ${reason}`);
    }

    const raw = createGmailRawMessage({
      from: config.email_address,
      senderName: config.sender_name,
      to,
      subject,
      html,
    });
    const sendResponse = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenResult.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw }),
        signal: AbortSignal.timeout(15000),
      },
    );
    const sendResult = await sendResponse.json().catch(() => ({}));
    if (!sendResponse.ok) {
      const reason =
        sendResult.error?.message ||
        sendResult.error_description ||
        `HTTP ${sendResponse.status}`;
      throw new Error(`Gmail API send failed: ${reason}`);
    }

    return sendResult;
  }

  async sendTestEmail(req, to, draftConfig) {
    if (!/^\S+@\S+\.\S+$/.test(String(to || "").trim())) {
      throw new Error("Enter a valid recipient email address.");
    }

    const config = draftConfig || (await this.getConfig(req));
    if (!config) {
      throw new Error(
        "Email settings were not found. Enter SMTP settings first.",
      );
    }

    if (config.email_provider === "gmail_api") {
      const result = await this.sendWithGmailApi(
        config,
        String(to).trim(),
        "Gmail API configuration test",
        "<p>Your Gmail API configuration is working.</p><p>This is a test email from EduSphere MIS.</p>",
      );
      return {
        messageId: result.id,
        integrationEnabled: config.enabled === true,
        provider: "gmail_api",
      };
    }

    const transporter = this.createTransporter(config);
    try {
      await transporter.verify();
      const result = await transporter.sendMail({
        from: `"${config.sender_name || "EduSphere MIS"}" <${config.email_address}>`,
        to: String(to).trim(),
        subject: "SMTP configuration test",
        text: "Your SMTP settings are working. This is a test email from EduSphere MIS.",
        html: "<p>Your SMTP settings are working.</p><p>This is a test email from EduSphere MIS.</p>",
      });
      return {
        messageId: result.messageId,
        integrationEnabled: config.enabled === true,
        provider: "smtp",
      };
    } catch (error) {
      const details = error?.responseCode
        ? `${error.responseCode}: ${error.message}`
        : error?.code
          ? `${error.code}: ${error.message}`
          : error?.message || "Unknown SMTP error";
      throw new Error(`SMTP test failed. ${details}`);
    } finally {
      transporter.close();
    }
  }

  /**
   * Sends an email based on an event type
   * @param {Object} req - The request object (to extract tenantPool context)
   * @param {String} eventType - The type of event (e.g., 'student_created', 'user_created')
   * @param {Object} payload - Data to populate the template (e.g., { studentName: 'John', email: 'john@example.com' })
   */
  async sendEmailForEvent(req, eventType, payload = {}) {
    try {
      const config = await this.getConfig(req);
      // Check if email integration is configured and enabled for this event
      if (!config || !config.enabled) {
        return false;
      }

      const notifications = config.notifications || {};
      if (!notifications[eventType]) {
        // Notification for this event is disabled
        return false;
      }

      const templates = await this.getTemplates(req);
      const template = templates[eventType];

      if (!template || !template.subject || !template.body) {
        console.warn(`No email template configured for event: ${eventType}`);
        return false;
      }

      // Compile template
      const subject = renderSubject(template.subject, payload);
      let htmlBody = renderHtml(template.body, payload);

      const templateHasLoginEmail = /{{\s*loginEmail\s*}}/.test(template.body);
      const templateHasPassword = /{{\s*password\s*}}/.test(template.body);
      const templateHasLoginUrl = /{{\s*studentLoginUrl\s*}}/.test(template.body);
      const templateHasResetUrl = /{{\s*passwordResetUrl\s*}}/.test(template.body);
      if (
        eventType === "student_created" &&
        payload.loginEmail &&
        payload.password &&
        (!templateHasLoginEmail || !templateHasPassword)
      ) {
        htmlBody += `<hr/><h3>Student Portal Login</h3>${templateHasLoginEmail ? "" : `<p><strong>Login email:</strong> ${escapeHtml(payload.loginEmail)}</p>`}${templateHasPassword ? "" : `<p><strong>Temporary password:</strong> ${escapeHtml(payload.password)}</p>`}`;
      }
      if (eventType === "student_created" && payload.passwordResetUrl) {
        if (!templateHasLoginUrl && payload.studentLoginUrl) {
          htmlBody += `<p><a href="${escapeHtml(payload.studentLoginUrl)}">Open student login</a></p>`;
        }
        if (!templateHasResetUrl) {
          htmlBody += `<p><a href="${escapeHtml(payload.passwordResetUrl)}">Set or reset your password</a></p><p>This secure link expires in 60 minutes.</p>`;
        }
      }

      const to =
        payload.to ||
        (eventType === "user_created" ? config.admin_email : null);

      if (!to) {
        console.warn(`Skipping email for ${eventType}: no recipient found.`);
        return false;
      }

      // Send the email
      await this.sendEmail(req, to, subject, htmlBody);
      return true;
    } catch (err) {
      console.error(`Failed to send email for event ${eventType}:`, err);
      return false;
    }
  }

  async sendUserInvitation(req, payload = {}) {
    const config = await this.getConfig(req);
    if (!config || !config.enabled) {
      throw new Error("Email integration is disabled or not configured.");
    }
    if (!payload.to || !payload.passwordResetUrl || !payload.loginUrl) {
      throw new Error("The invitation email is missing required account links.");
    }

    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937;max-width:600px;margin:0 auto">
        <h2 style="color:#111827">Your school portal account is ready</h2>
        <p>Hello ${escapeHtml(payload.name || "there")},</p>
        <p>An account has been created for you${payload.tenantName ? ` at ${escapeHtml(payload.tenantName)}` : ""}.</p>
        <p><strong>Login email:</strong> ${escapeHtml(payload.to)}</p>
        <p><a href="${escapeHtml(payload.passwordResetUrl)}" style="display:inline-block;padding:12px 18px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:6px">Set your password</a></p>
        <p>This one-time setup link expires in 60 minutes.</p>
        <p><a href="${escapeHtml(payload.loginUrl)}">Open the school portal</a></p>
        <p>If you were not expecting this account, contact your school administrator.</p>
      </div>`;

    await this.sendEmail(
      req,
      payload.to,
      "Set up your school portal account",
      html,
    );
    return true;
  }

  /**
   * Core function to send an email using configured SMTP
   */
  async sendEmail(req, to, subject, html) {
    const config = await this.getConfig(req);
    if (!config || !config.email_address) {
      throw new Error("Email configuration is missing or incomplete.");
    }

    if (config.email_provider === "gmail_api") {
      return this.sendWithGmailApi(config, to, subject, html);
    }

    if (!config.app_password) {
      throw new Error("SMTP email configuration is missing its password.");
    }

    const transporter = this.createTransporter(config);

    const mailOptions = {
      from: `"${config.sender_name || "EduSphere MIS"}" <${config.email_address}>`,
      to,
      subject,
      html,
    };

    try {
      return await transporter.sendMail(mailOptions);
    } finally {
      transporter.close();
    }
  }
}

const emailService = new EmailService();
module.exports = emailService;
