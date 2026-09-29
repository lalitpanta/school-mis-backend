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
      secure: config.smtp_secure !== undefined ? config.smtp_secure : port === 465,
      auth: {
        user: config.email_address,
        pass: config.app_password,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    });
  }

  async sendTestEmail(req, to, draftConfig) {
    if (!/^\S+@\S+\.\S+$/.test(String(to || "").trim())) {
      throw new Error("Enter a valid recipient email address.");
    }

    const config = draftConfig || (await this.getConfig(req));
    if (!config) {
      throw new Error("Email settings were not found. Enter SMTP settings first.");
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
      if (
        eventType === "student_created" &&
        payload.loginEmail &&
        payload.password &&
        (!templateHasLoginEmail || !templateHasPassword)
      ) {
        htmlBody += `<hr/><h3>Student Portal Login</h3>${templateHasLoginEmail ? "" : `<p><strong>Login email:</strong> ${escapeHtml(payload.loginEmail)}</p>`}${templateHasPassword ? "" : `<p><strong>Temporary password:</strong> ${escapeHtml(payload.password)}</p>`}<p>Please change your password after signing in.</p>`;
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

  /**
   * Core function to send an email using configured SMTP
   */
  async sendEmail(req, to, subject, html) {
    const config = await this.getConfig(req);
    if (!config || !config.email_address || !config.app_password) {
      throw new Error("Email configuration is missing or incomplete.");
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
