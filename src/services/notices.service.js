const settingsService = require('./settings.service');
const emailService = require('./email.service');

const DEFAULT_SMS_CONFIG = {
  provider: 'megaweblink',
  endpoint: 'https://sms.megaweblink.com.np/api/v1/sms/send/',
  enabled: false,
  api_key: '',
  api_key_configured: false,
  sender_id: {
    NT: '',
    Ncell: '',
  },
  provider_name: 'Mega Web Link SMS',
  message_type: 'plain',
  scheduling_enabled: false,
  scheduled_at: '',
  signature: '',
  country: 'NP',
  credits: 0,
};

class NoticesService {
  async _loadSetting(key, req, defaultValue) {
    const data = await settingsService.getSettingByKey(key, req);
    return data === null ? defaultValue : data;
  }

  async _saveSetting(key, value, req) {
    return settingsService.updateSetting(key, JSON.stringify(value), req);
  }

  async getNotices(req) {
    return this._loadSetting('notice_board', req, []);
  }

  async sendNoticeEmails(req, notice) {
    if (!notice || !notice.emailNotification) {
      return { sent: false, reason: 'email notification disabled' };
    }
    const recipients = Array.isArray(notice.recipientEmails) ? notice.recipientEmails : [];
    if (recipients.length === 0) {
      return { sent: false, reason: 'no recipients' };
    }
    const subject = `New notice: ${notice.title}`;
    const body = `<p>${notice.content}</p><p>Category: ${notice.category}</p>`;

    await Promise.all(recipients.map((to) => emailService.sendEmail(req, to, subject, body).catch((error) => {
      console.error(`Failed to send notice email to ${to}:`, error);
    })));

    return { sent: true, recipients: recipients.length };
  }

  async createNotice(req, notice) {
    const existing = await this.getNotices(req);
    const created = {
      id: notice.id || `${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      title: String(notice.title || '').trim(),
      content: String(notice.content || '').trim(),
      category: notice.category || 'General',
      audience: notice.audience || 'All',
      audienceDetails: notice.audienceDetails || null,
      expiryDate: notice.expiryDate || null,
      pinned: !!notice.pinned,
      status: notice.status || 'draft',
      attachments: Array.isArray(notice.attachments) ? notice.attachments : [],
      emailNotification: !!notice.emailNotification,
      recipientEmails: Array.isArray(notice.recipientEmails) ? notice.recipientEmails : [],
      sendImmediately: !!notice.sendImmediately,
      createdBy: req.user?.id || 'system',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      read_by: [],
    };
    existing.unshift(created);
    await this._saveSetting('notice_board', existing, req);
    return created;
  }

  async updateNotice(req, id, updates) {
    const notices = await this.getNotices(req);
    const index = notices.findIndex((notice) => notice.id === id);
    if (index === -1) return null;
    const current = notices[index];
    const updated = {
      ...current,
      ...updates,
      title: updates.title !== undefined ? String(updates.title).trim() : current.title,
      content: updates.content !== undefined ? String(updates.content).trim() : current.content,
      category: updates.category || current.category,
      audience: updates.audience || current.audience,
      audienceDetails: updates.audienceDetails || current.audienceDetails,
      expiryDate: updates.expiryDate !== undefined ? updates.expiryDate : current.expiryDate,
      pinned: updates.pinned !== undefined ? !!updates.pinned : current.pinned,
      status: updates.status || current.status,
      attachments: Array.isArray(updates.attachments) ? updates.attachments : current.attachments,
      emailNotification: updates.emailNotification !== undefined ? !!updates.emailNotification : current.emailNotification,
      recipientEmails: Array.isArray(updates.recipientEmails) ? updates.recipientEmails : current.recipientEmails,
      sendImmediately: updates.sendImmediately !== undefined ? !!updates.sendImmediately : current.sendImmediately,
      updatedAt: new Date().toISOString(),
    };
    notices[index] = updated;
    await this._saveSetting('notice_board', notices, req);
    return updated;
  }

  async deleteNotice(req, id) {
    const notices = await this.getNotices(req);
    const filtered = notices.filter((notice) => notice.id !== id);
    if (filtered.length === notices.length) return false;
    await this._saveSetting('notice_board', filtered, req);
    return true;
  }

  async markNoticeRead(req, userId, noticeId) {
    const notices = await this.getNotices(req);
    const index = notices.findIndex((notice) => notice.id === noticeId);
    if (index === -1) return null;
    const notice = notices[index];
    const readBy = Array.isArray(notice.read_by) ? [...notice.read_by] : [];
    if (userId && !readBy.includes(userId)) {
      readBy.push(userId);
    }
    notice.read_by = readBy;
    notice.updatedAt = new Date().toISOString();
    notices[index] = notice;
    await this._saveSetting('notice_board', notices, req);
    return notice;
  }

  async togglePin(req, noticeId, pinned) {
    return this.updateNotice(req, noticeId, { pinned });
  }

  async archiveNotice(req, noticeId) {
    return this.updateNotice(req, noticeId, { status: 'archived' });
  }

  async getSmsConfig(req) {
    const config = await this._loadSetting('sms_config', req, null);
    const nextConfig = { ...DEFAULT_SMS_CONFIG, ...(config || {}) };
    return {
      ...nextConfig,
      sender_id: {
        NT: nextConfig.sender_id?.NT || '',
        Ncell: nextConfig.sender_id?.Ncell || '',
      },
      api_key: nextConfig.api_key ? '••••••••••••••••' : '',
      api_key_configured: Boolean(nextConfig.api_key || process.env.SMS_API_KEY),
    };
  }

  async saveSmsConfig(req, config) {
    const nextConfig = {
      ...DEFAULT_SMS_CONFIG,
      ...(config || {}),
      sender_id: {
        NT: config?.sender_id?.NT || config?.sender_id || '',
        Ncell: config?.sender_id?.Ncell || '',
      },
      provider: 'megaweblink',
      endpoint: 'https://sms.megaweblink.com.np/api/v1/sms/send/',
      message_type: config?.message_type || 'plain',
      provider_name: 'Mega Web Link SMS',
      api_key_configured: Boolean(config?.api_key || process.env.SMS_API_KEY),
    };

    if (config?.api_key) {
      process.env.SMS_API_KEY = config.api_key;
      nextConfig.api_key = '';
    } else if (!process.env.SMS_API_KEY) {
      nextConfig.api_key = '';
    }

    const result = await this._saveSetting('sms_config', nextConfig, req);
    return this.getSmsConfig(req, result);
  }

  async getSmsTemplates(req) {
    return this._loadSetting('sms_templates', req, []);
  }

  async createSmsTemplate(req, template) {
    const list = await this.getSmsTemplates(req);
    const created = {
      id: template.id || `${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      name: String(template.name || '').trim(),
      content: String(template.content || '').trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    list.unshift(created);
    await this._saveSetting('sms_templates', list, req);
    return created;
  }

  async updateSmsTemplate(req, id, updates) {
    const list = await this.getSmsTemplates(req);
    const index = list.findIndex((item) => item.id === id);
    if (index === -1) return null;
    const current = list[index];
    const updated = {
      ...current,
      name: updates.name !== undefined ? String(updates.name).trim() : current.name,
      content: updates.content !== undefined ? String(updates.content).trim() : current.content,
      updatedAt: new Date().toISOString(),
    };
    list[index] = updated;
    await this._saveSetting('sms_templates', list, req);
    return updated;
  }

  async deleteSmsTemplate(req, id) {
    const list = await this.getSmsTemplates(req);
    const filtered = list.filter((item) => item.id !== id);
    if (filtered.length === list.length) return false;
    await this._saveSetting('sms_templates', filtered, req);
    return true;
  }

  async getSmsLogs(req) {
    return this._loadSetting('sms_logs', req, []);
  }

  async saveSmsLog(req, logEntry) {
    const logs = await this.getSmsLogs(req);
    const nextLog = {
      id: logEntry.id || `${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      to: logEntry.to || 'unknown',
      message: logEntry.message || '',
      templateName: logEntry.templateName || null,
      recipientType: logEntry.recipientType || 'manual',
      scheduledAt: logEntry.scheduledAt || null,
      status: logEntry.status || 'sent',
      providerResponse: logEntry.providerResponse || null,
      createdBy: req.user?.id || 'system',
      createdAt: new Date().toISOString(),
    };
    logs.unshift(nextLog);
    await this._saveSetting('sms_logs', logs, req);
    return nextLog;
  }

  async sendSms(req, payload) {
    const config = await this.getSmsConfig(req);
    const toNumbers = Array.isArray(payload.to)
      ? payload.to
      : String(payload.recipientPhones || payload.to || '')
          .split(/[\n,;]+/)
          .map((value) => value.trim())
          .filter(Boolean);

    const text = String(payload.text || payload.message || '').trim();
    const templateName = payload.templateName || null;
    const recipientType = payload.recipientType || 'manual';
    const scheduledAt = payload.scheduledAt || payload.scheduled_at || config.scheduled_at || null;
    const senderId = payload.sender_id || config.sender_id || {};
    const messageType = payload.message_type || config.message_type || 'plain';

    if (!text) {
      throw new Error('SMS message cannot be empty.');
    }
    if (toNumbers.length === 0) {
      throw new Error('Please provide at least one recipient phone number.');
    }

    const endpoint = payload.endpoint || config.endpoint || 'https://sms.megaweblink.com.np/api/v1/sms/send/';
    const apiKey = process.env.SMS_API_KEY;

    if (!config.enabled || !apiKey) {
      throw new Error('SMS API key is not configured. Please configure your SMS provider first.');
    }

    const providerPayload = {
      to: toNumbers,
      text,
      sender_id: senderId,
      message_type: messageType,
    };

    if (config.scheduling_enabled || scheduledAt) {
      const finalScheduledDate = scheduledAt ? this._formatScheduledDate(scheduledAt) : this._formatScheduledDate(config.scheduled_at);
      if (!finalScheduledDate) {
        throw new Error('The scheduled date/time is invalid. Please use a valid future date and time.');
      }
      providerPayload.scheduled_at = finalScheduledDate;
    }

    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': apiKey,
        },
        body: JSON.stringify(providerPayload),
      });
    } catch (error) {
      throw new Error('The SMS service is temporarily unavailable. Please try again later or contact support.');
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = String(data?.error || data?.message || '').toLowerCase();
      if (message.includes('insufficient balance')) {
        throw new Error('SMS could not be sent because the SMS account has insufficient balance.');
      }
      if (message.includes('invalid api key') || message.includes('unauthorized') || response.status === 401) {
        throw new Error('The SMS API key is invalid or inactive. Please check your SMS configuration.');
      }
      if (message.includes('date') || message.includes('schedule') || message.includes('time') || response.status === 400) {
        throw new Error('The scheduled date/time is invalid. Please use a valid future date and time.');
      }
      throw new Error('The SMS service is temporarily unavailable. Please try again later or contact support.');
    }

    const logs = [];
    for (const to of toNumbers) {
      const logEntry = await this.saveSmsLog(req, {
        to,
        message: text,
        templateName,
        recipientType,
        scheduledAt: providerPayload.scheduled_at || null,
        status: response.ok ? 'sent' : 'failed',
        providerResponse: data?.message || 'SMS sent',
      });
      logs.push(logEntry);
    }

    return {
      sent: true,
      batch_id: data.batch_id || data.id || null,
      cost: data.cost || null,
      pages: data.pages || null,
      failed_numbers: data.failed_numbers || [],
      status: 'sent',
      logs,
      provider: 'megaweblink',
      response: data,
    };
  }

  _formatScheduledDate(value) {
    if (!value) return null;
    if (typeof value === 'string' && /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
      const formatted = new Date(value);
      if (Number.isNaN(formatted.getTime())) return null;
      return formatted.toISOString().slice(0, 19).replace('T', ' ');
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 19).replace('T', ' ');
  }
}

module.exports = new NoticesService();
