module.exports = {
  up: async (queryInterface, Sequelize) => {
    const pool = queryInterface.sequelize;

    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS teacher_courses (
          id SERIAL PRIMARY KEY,
          teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
          course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
          assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(teacher_id, course_id),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_teacher_courses_teacher_id ON teacher_courses(teacher_id);
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_teacher_courses_course_id ON teacher_courses(course_id);
      `);

      console.log("[Migration] teacher_courses table created successfully");
    } catch (err) {
      console.error("[Migration] Error creating teacher_courses table:", err.message);
      throw err;
    }
  },

  down: async (queryInterface, Sequelize) => {
    const pool = queryInterface.sequelize;

    try {
      await pool.query(`
        DROP TABLE IF EXISTS teacher_courses CASCADE;
      `);

      console.log("[Migration] teacher_courses table dropped successfully");
    } catch (err) {
      console.error("[Migration] Error dropping teacher_courses table:", err.message);
      throw err;
    }
  }
};
