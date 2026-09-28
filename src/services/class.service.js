const { recordEntityAudit } = require("./auditLog.service");

class ClassService {
  ensure = async (pool) => {
    const sql = `
      CREATE TABLE IF NOT EXISTS classes (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        code VARCHAR(50),
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sections (
        id SERIAL PRIMARY KEY,
        class_id INT REFERENCES classes(id) ON DELETE CASCADE,
        name VARCHAR(50) NOT NULL,
        code VARCHAR(50),
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await pool.query(sql);
  };

  listClasses = async (req) => {
    try {
      const pool = req?.tenantPool || require('../config/db');
      await this.ensure(pool);
      const res = await pool.query('SELECT * FROM classes ORDER BY name');
      return res.rows;
    } catch (err) { throw new Error(`Failed to list classes: ${err.message}`); }
  };

  createClass = async (data, req) => {
    try {
      const pool = req?.tenantPool || require('../config/db');
      await this.ensure(pool);
      const res = await pool.query('INSERT INTO classes (name, code, is_active) VALUES ($1,$2,$3) RETURNING *', [data.name, data.code||null, data.is_active===undefined?true:data.is_active]);
      const createdClass = res.rows[0];

      try {
        await recordEntityAudit({
          req,
          entityType: "class",
          entityId: createdClass?.id ?? null,
          entityName: createdClass?.name || data?.name || "Class",
          action: "create",
          title: "Class created",
          message: `Created class ${createdClass?.name || data?.name || "record"}.`,
          severity: "success",
        });
      } catch (auditErr) {
        console.error("Class audit log failed:", auditErr.message);
      }

      return createdClass;
    } catch (err) { throw new Error(`Failed to create class: ${err.message}`); }
  };

  listSections = async (req) => {
    try {
      const pool = req?.tenantPool || require('../config/db');
      await this.ensure(pool);
      const res = await pool.query('SELECT * FROM sections ORDER BY name');
      return res.rows;
    } catch (err) { throw new Error(`Failed to list sections: ${err.message}`); }
  };

  createSection = async (data, req) => {
    try {
      const pool = req?.tenantPool || require('../config/db');
      await this.ensure(pool);
      const res = await pool.query('INSERT INTO sections (class_id, name, code, is_active) VALUES ($1,$2,$3,$4) RETURNING *', [data.class_id, data.name, data.code||null, data.is_active===undefined?true:data.is_active]);
      const createdSection = res.rows[0];

      try {
        await recordEntityAudit({
          req,
          entityType: "section",
          entityId: createdSection?.id ?? null,
          entityName: createdSection?.name || data?.name || "Section",
          action: "create",
          title: "Section created",
          message: `Created section ${createdSection?.name || data?.name || "record"}.`,
          severity: "success",
          metadata: {
            classId: data?.class_id || null,
          },
        });
      } catch (auditErr) {
        console.error("Section audit log failed:", auditErr.message);
      }

      return createdSection;
    } catch (err) { throw new Error(`Failed to create section: ${err.message}`); }
  };
}

module.exports = new ClassService();
