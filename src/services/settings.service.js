class SettingsService {
  static PLATFORM_SETTING_KEYS = [
    "system_name",
    "platform_name",
    "platform_tagline",
    "system_email",
    "support_email",
    "language",
    "timezone",
    "currency",
    "default_plan",
    "session_domain",
    "maintenance_mode",
    "allow_new_tenants",
    "auto_suspend_overdue_invoice",
    "enforce_2fa_admins",
    "enforce_2fa_tenant_admins",
    "restrict_login_by_ip_allowlist",
    "session_timeout_minutes",
    "minimum_password_length",
    "password_rotation_days",
    "api_rate_limit_per_minute",
    "default_storage_quota",
    "max_upload_file_size",
    "allowed_file_types",
    "storage_provider",
    "warn_tenants_at_60_percent",
    "block_uploads_at_100_percent",
    "auto_archive_files_older_than_years",
    "s3_access_key_id",
    "s3_secret_access_key",
    "s3_bucket_name",
    "azure_storage_account_name",
    "azure_storage_account_key",
    "azure_container_name",
    "gcp_project_id",
    "gcp_client_email",
    "gcp_private_key",
    "gcp_bucket_name",
    "enable_global_storage",
  ];

  static BOOLEAN_PLATFORM_SETTINGS = [
    "maintenance_mode",
    "allow_new_tenants",
    "auto_suspend_overdue_invoice",
    "enforce_2fa_admins",
    "enforce_2fa_tenant_admins",
    "warn_tenants_at_60_percent",
    "block_uploads_at_100_percent",
    "enable_global_storage",
  ];

  static INTEGER_PLATFORM_SETTINGS = [
    "session_timeout_minutes",
    "minimum_password_length",
    "password_rotation_days",
    "api_rate_limit_per_minute",
    "auto_archive_files_older_than_years",
  ];

  static JSON_PLATFORM_SETTINGS = ["restrict_login_by_ip_allowlist"];

  getPool(req) {
    if (
      req?.user?.type === "system_admin" ||
      req?.user?.type === "super_admin"
    ) {
      return require("../config/db");
    }
    return req?.tenantPool || require("../config/db");
  }

  isPlatformSettingKey(key) {
    return SettingsService.PLATFORM_SETTING_KEYS.includes(key);
  }

  normalizePlatformSettingValue(key, rawValue) {
    if (rawValue === null || rawValue === undefined) {
      return null;
    }

    if (SettingsService.JSON_PLATFORM_SETTINGS.includes(key)) {
      if (typeof rawValue === "string") {
        try {
          return JSON.parse(rawValue);
        } catch {
          return rawValue;
        }
      }
      return rawValue;
    }

    if (SettingsService.BOOLEAN_PLATFORM_SETTINGS.includes(key)) {
      if (typeof rawValue === "boolean") return rawValue;
      const lower = String(rawValue).toLowerCase();
      return lower === "true" || lower === "1" || lower === "yes";
    }

    if (SettingsService.INTEGER_PLATFORM_SETTINGS.includes(key)) {
      const parsed = parseInt(rawValue, 10);
      return Number.isNaN(parsed) ? null : parsed;
    }

    return String(rawValue);
  }

  async ensurePlatformSettingsRow(pool) {
    await pool.query(`
      INSERT INTO platform_settings (created_at, updated_at)
      SELECT CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      WHERE NOT EXISTS (SELECT 1 FROM platform_settings);
    `);
  }

  async getPlatformSettingsFromPool(pool) {
    await this.ensurePlatformSettingsRow(pool);
    const result = await pool.query("SELECT * FROM platform_settings LIMIT 1");
    const row = result.rows[0] || {};
    return SettingsService.PLATFORM_SETTING_KEYS.reduce((acc, key) => {
      acc[key] = row[key] !== undefined ? row[key] : null;
      return acc;
    }, {});
  }

  async getPlatformSettings(req) {
    return this.getPlatformSettingsFromPool(require("../config/db"));
  }

  async upsertPlatformSettings(settingsObject, req) {
    if (!settingsObject || Object.keys(settingsObject).length === 0) {
      return this.getPlatformSettings(req);
    }

    if (
      req?.user?.type !== "system_admin" &&
      req?.user?.type !== "super_admin"
    ) {
      throw new Error("Not authorized to update platform-level settings");
    }

    const pool = require("../config/db");
    await this.ensurePlatformSettingsRow(pool);

    const validEntries = {};
    Object.entries(settingsObject).forEach(([key, rawValue]) => {
      if (!this.isPlatformSettingKey(key)) return;
      const normalized = this.normalizePlatformSettingValue(key, rawValue);
      if (normalized !== undefined) {
        validEntries[key] = normalized;
      }
    });

    if (Object.keys(validEntries).length === 0) {
      return this.getPlatformSettings(req);
    }

    const setClauses = [];
    const values = [];
    let idx = 1;

    for (const [key, value] of Object.entries(validEntries)) {
      setClauses.push(`${key} = $${idx}`);
      values.push(value);
      idx += 1;
    }

    const query = `UPDATE platform_settings SET ${setClauses.join(", ")}, updated_at = CURRENT_TIMESTAMP`;
    await pool.query(query, values);
    return this.getPlatformSettings(req);
  }

  async ensureSchoolProfileTables(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS school_profile (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255),
        email VARCHAR(255),
        phone VARCHAR(100),
        address TEXT,
        website VARCHAR(255),
        motto TEXT,
        logo TEXT,
        established DATE,
        country VARCHAR(100),
        total_floors INTEGER,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS school_blocks (
        id SERIAL PRIMARY KEY,
        profile_id INTEGER NOT NULL REFERENCES school_profile(id) ON DELETE CASCADE,
        block_name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS school_floors (
        id SERIAL PRIMARY KEY,
        block_id INTEGER NOT NULL REFERENCES school_blocks(id) ON DELETE CASCADE,
        floor_number INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(block_id, floor_number)
      );
    `);
  }

  async getSettingsMap(keys, pool) {
    const result = await pool.query(
      'SELECT key, value FROM "settings" WHERE key = ANY($1)',
      [keys],
    );
    return result.rows.reduce((acc, row) => {
      try {
        acc[row.key] = JSON.parse(row.value);
      } catch {
        acc[row.key] = row.value;
      }
      return acc;
    }, {});
  }

  async getSchoolProfileFromPool(pool) {
    try {
      const profileResult = await pool.query(
        "SELECT * FROM school_profile LIMIT 1",
      );
      const row = profileResult.rows[0];
      if (!row) return null;

      const blocksResult = await pool.query(
        `SELECT b.id AS block_id, b.block_name, f.floor_number
         FROM school_blocks b
         LEFT JOIN school_floors f ON f.block_id = b.id
         WHERE b.profile_id = $1
         ORDER BY b.id, f.floor_number`,
        [row.id],
      );

      const blocksMap = new Map();
      blocksResult.rows.forEach((blockRow) => {
        if (!blocksMap.has(blockRow.block_id)) {
          blocksMap.set(blockRow.block_id, {
            id: blockRow.block_id,
            block_name: blockRow.block_name,
            floors: [],
          });
        }
        const block = blocksMap.get(blockRow.block_id);
        if (Number.isInteger(blockRow.floor_number)) {
          block.floors.push(blockRow.floor_number);
        }
      });

      const blocks = Array.from(blocksMap.values()).map((block) => ({
        ...block,
        floor_count: block.floors.length,
      }));

      const computedFloors = blocks.reduce(
        (sum, block) => sum + block.floor_count,
        0,
      );

      return {
        name: row.name,
        email: row.email,
        phone: row.phone,
        address: row.address,
        website: row.website,
        motto: row.motto,
        logo: row.logo,
        established: row.established,
        country: row.country,
        is_active: row.is_active,
        total_floors:
          row.total_floors !== null ? row.total_floors : computedFloors,
        blocks,
      };
    } catch (err) {
      if (err.message.includes('relation "school_profile" does not exist')) {
        return null;
      }
      throw err;
    }
  }

  async getCentralSchoolProfile() {
    return this.getSchoolProfileFromPool(require("../config/db"));
  }

  async getSchoolProfileFallback(req) {
    const pool = this.getPool(req);
    const fallback = await pool.query(
      'SELECT value FROM "settings" WHERE key = $1 LIMIT 1',
      ["school_profile"],
    );
    const raw = fallback.rows[0]?.value || null;
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async getSchoolProfile(req) {
    const pool = this.getPool(req);
    const localProfile = await this.getSchoolProfileFromPool(pool);
    if (localProfile) {
      return localProfile;
    }
    return this.getSchoolProfileFallback(req);
  }

  async upsertSchoolProfile(profile, req) {
    const pool = this.getPool(req);
    const payload =
      typeof profile === "string" ? JSON.parse(profile) : profile || {};

    const normalizedProfile = {
      name: payload.name || null,
      email: payload.email || null,
      phone: payload.phone || null,
      address: payload.address || null,
      website: payload.website || null,
      motto: payload.motto || null,
      logo: payload.logo || null,
      established: payload.established || null,
      country: payload.country || null,
      is_active: payload.is_active !== undefined ? payload.is_active : true,
    };

    const blocks = Array.isArray(payload.blocks)
      ? payload.blocks
          .map((block) => ({
            block_name: block.block_name || block.name || "",
            floor_count: Math.max(
              1,
              parseInt(block.floor_count ?? block.floors?.length ?? 1, 10) || 1,
            ),
          }))
          .filter((block) => block.block_name.trim().length > 0)
      : null;

    if (Array.isArray(payload.blocks) && blocks.length > 0) {
      normalizedProfile.total_floors = blocks.reduce(
        (sum, block) => sum + block.floor_count,
        0,
      );
    } else if (Array.isArray(payload.blocks) && blocks.length === 0) {
      normalizedProfile.total_floors = 0;
    } else {
      normalizedProfile.total_floors =
        payload.total_floors !== undefined && payload.total_floors !== null
          ? Math.max(0, parseInt(payload.total_floors, 10) || 0)
          : null;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await this.ensureSchoolProfileTables(client);

      const existingProfile = await client.query(
        "SELECT id FROM school_profile LIMIT 1",
      );
      let profileId;
      if (existingProfile.rows.length > 0) {
        profileId = existingProfile.rows[0].id;
        await client.query(
          `UPDATE school_profile SET
             name = $1,
             email = $2,
             phone = $3,
             address = $4,
             website = $5,
             motto = $6,
             logo = $7,
             established = $8,
             country = $9,
             total_floors = $10,
             is_active = $11,
             updated_at = CURRENT_TIMESTAMP
           WHERE id = $12`,
          [
            normalizedProfile.name,
            normalizedProfile.email,
            normalizedProfile.phone,
            normalizedProfile.address,
            normalizedProfile.website,
            normalizedProfile.motto,
            normalizedProfile.logo,
            normalizedProfile.established,
            normalizedProfile.country,
            normalizedProfile.total_floors,
            normalizedProfile.is_active,
            profileId,
          ],
        );
      } else {
        const inserted = await client.query(
          `INSERT INTO school_profile
             (name, email, phone, address, website, motto, logo, established, country, total_floors, is_active, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
           RETURNING id`,
          [
            normalizedProfile.name,
            normalizedProfile.email,
            normalizedProfile.phone,
            normalizedProfile.address,
            normalizedProfile.website,
            normalizedProfile.motto,
            normalizedProfile.logo,
            normalizedProfile.established,
            normalizedProfile.country,
            normalizedProfile.total_floors,
            normalizedProfile.is_active,
          ],
        );
        profileId = inserted.rows[0].id;
      }

      if (Array.isArray(payload.blocks)) {
        await client.query(
          "DELETE FROM school_floors WHERE block_id IN (SELECT id FROM school_blocks WHERE profile_id = $1)",
          [profileId],
        );
        await client.query("DELETE FROM school_blocks WHERE profile_id = $1", [
          profileId,
        ]);

        if (blocks && blocks.length > 0) {
          for (const block of blocks) {
            const blockInsert = await client.query(
              `INSERT INTO school_blocks (profile_id, block_name, created_at, updated_at)
               VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
               RETURNING id`,
              [profileId, block.block_name.trim()],
            );
            const blockId = blockInsert.rows[0].id;

            for (
              let floorNumber = 1;
              floorNumber <= block.floor_count;
              floorNumber += 1
            ) {
              await client.query(
                `INSERT INTO school_floors (block_id, floor_number, created_at, updated_at)
                 VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                [blockId, floorNumber],
              );
            }
          }
        }
      }

      await client.query('DELETE FROM "settings" WHERE key = $1', [
        "school_profile",
      ]);
      await client.query("COMMIT");

      return this.getSchoolProfile(req);
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`Failed to save school profile: ${err.message}`);
    } finally {
      client.release();
    }
  }

  /**
   * Get all settings
   */
  getAllSettings = async (req) => {
    try {
      const pool = this.getPool(req);
      const query = 'SELECT key, value FROM "settings"';
      await pool.query('DELETE FROM "settings" WHERE key = $1', [
        "classroom_layout",
      ]);
      const result = await pool.query(query);
      const schoolProfile = await this.getSchoolProfile(req);
      const centralPlatformSettings = await this.getPlatformSettingsFromPool(
        require("../config/db"),
      );

      const settings = result.rows.reduce((acc, row) => {
        if (
          row.key === "classroom_layout" ||
          row.key === "school_profile" ||
          this.isPlatformSettingKey(row.key)
        ) {
          return acc;
        }
        try {
          acc[row.key] = JSON.parse(row.value);
        } catch (e) {
          acc[row.key] = row.value;
        }
        return acc;
      }, {});

      if (req?.tenantPool) {
        SettingsService.PLATFORM_SETTING_KEYS.forEach((key) => {
          settings[key] = centralPlatformSettings[key];
        });
        const centralProfile = await this.getCentralSchoolProfile();
        settings.platform_logo = centralProfile?.logo || null;
        settings.school_profile = {
          ...(centralProfile || {}),
          ...(schoolProfile || {}),
        };
      } else {
        SettingsService.PLATFORM_SETTING_KEYS.forEach((key) => {
          settings[key] = centralPlatformSettings[key];
        });
        const centralProfile = await this.getCentralSchoolProfile();
        settings.platform_logo = centralProfile?.logo || null;
        if (schoolProfile) {
          settings.school_profile = schoolProfile;
        }
      }

      return settings;
    } catch (err) {
      throw new Error(`Failed to fetch settings: ${err.message}`);
    }
  };

  /**
   * Get a specific setting by key
   */
  getSettingByKey = async (key, req) => {
    try {
      if (key === "classroom_layout") return null;
      if (key === "school_profile") return await this.getSchoolProfile(req);

      if (this.isPlatformSettingKey(key)) {
        const centralPlatformSettings = await this.getPlatformSettingsFromPool(
          require("../config/db"),
        );
        return centralPlatformSettings[key] ?? null;
      }

      const pool = this.getPool(req);
      const query = 'SELECT value FROM "settings" WHERE key = $1';
      const result = await pool.query(query, [key]);
      const raw = result.rows[0]?.value;

      if (raw !== undefined && raw !== null) {
        try {
          return JSON.parse(raw);
        } catch {
          return raw;
        }
      }

      return null;
    } catch (err) {
      throw new Error(`Failed to fetch setting ${key}: ${err.message}`);
    }
  };

  /**
   * Update or create a setting
   */
  updateSetting = async (key, value, req) => {
    try {
      if (key === "school_profile") {
        const profile = typeof value === "string" ? JSON.parse(value) : value;
        const result = await this.upsertSchoolProfile(profile, req);
        return { key: "school_profile", value: JSON.stringify(result) };
      }

      if (this.isPlatformSettingKey(key)) {
        if (
          req?.user?.type !== "system_admin" &&
          req?.user?.type !== "super_admin"
        ) {
          throw new Error("Not authorized to update superadmin settings");
        }

        const normalized = this.normalizePlatformSettingValue(key, value);
        const updatedSettings = await this.upsertPlatformSettings(
          { [key]: normalized },
          req,
        );
        return { key, value: JSON.stringify(updatedSettings[key]) };
      }

      const pool = this.getPool(req);
      const query = `
        INSERT INTO "settings" (key, value, updated_at)
        VALUES ($1, $2, CURRENT_TIMESTAMP)
        ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `;
      const result = await pool.query(query, [key, value]);
      return result.rows[0];
    } catch (err) {
      throw new Error(`Failed to update setting ${key}: ${err.message}`);
    }
  };

  /**
   * Delete a setting by key
   */
  deleteSetting = async (key, req) => {
    try {
      if (key === "school_profile") {
        const pool = this.getPool(req);
        await pool.query(
          "DELETE FROM school_floors WHERE block_id IN (SELECT id FROM school_blocks WHERE profile_id IN (SELECT id FROM school_profile))",
        );
        await pool.query(
          "DELETE FROM school_blocks WHERE profile_id IN (SELECT id FROM school_profile)",
        );
        await pool.query("DELETE FROM school_profile");
        return true;
      }

      if (this.isPlatformSettingKey(key)) {
        if (
          req?.user?.type !== "system_admin" &&
          req?.user?.type !== "super_admin"
        ) {
          throw new Error("Not authorized to delete superadmin settings");
        }
        const pool = require("../config/db");
        await this.ensurePlatformSettingsRow(pool);
        await pool.query(
          `UPDATE platform_settings SET ${key} = NULL, updated_at = CURRENT_TIMESTAMP`,
        );
        return true;
      }

      const pool = this.getPool(req);
      await pool.query('DELETE FROM "settings" WHERE key = $1', [key]);
      return true;
    } catch (err) {
      throw new Error(`Failed to delete setting ${key}: ${err.message}`);
    }
  };
}

const settingsService = new SettingsService();
module.exports = settingsService;
