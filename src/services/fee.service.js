const { v4: uuidv4 } = require("uuid");

class FeeService {
  async getCategories(req) {
    const db = req.tenantPool;
    const result = await db.query(`SELECT * FROM fee_categories ORDER BY id DESC`);
    return result.rows;
  }

  async createCategory(payload, req) {
    const db = req.tenantPool;
    const { name, description } = payload;
    const result = await db.query(
      `INSERT INTO fee_categories (name, description) VALUES ($1, $2) RETURNING *`,
      [name, description]
    );
    return result.rows[0];
  }

  async getStructures(req) {
    const db = req.tenantPool;
    const query = `
      SELECT fs.*, c.name as class_name, s.section_name, fc.name as category_name
      FROM fee_structures fs
      LEFT JOIN classrooms c ON fs.class_id = c.id
      LEFT JOIN sections s ON fs.section_id = s.id
      JOIN fee_categories fc ON fs.category_id = fc.id
      ORDER BY fs.id DESC
    `;
    const result = await db.query(query);
    return result.rows;
  }

  async createStructure(payload, req) {
    const db = req.tenantPool;
    const {
      category_id, class_id, section_id, academic_year,
      student_type, frequency, amount, due_day,
      late_fee_type, late_fee_amount, grace_period_days
    } = payload;
    
    const result = await db.query(
      `INSERT INTO fee_structures 
      (category_id, class_id, section_id, academic_year, student_type, frequency, amount, due_day, late_fee_type, late_fee_amount, grace_period_days) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [category_id, class_id || null, section_id || null, academic_year, student_type, frequency, amount, due_day || null, late_fee_type, late_fee_amount || 0, grace_period_days || 0]
    );
    return result.rows[0];
  }

  async getStudentFees(filters, req) {
    const db = req.tenantPool;
    let query = `
      SELECT sf.*, st.full_name as student_name, st.admission_no, st.roll_no, c.name as class_name
      FROM student_fees sf
      JOIN students st ON sf.student_id = st.id
      LEFT JOIN classrooms c ON st.class_id = c.id
      WHERE 1=1
    `;
    const params = [];
    if (filters.student_id) {
      params.push(filters.student_id);
      query += ` AND sf.student_id = $${params.length}`;
    }
    if (filters.class_id) {
      params.push(filters.class_id);
      query += ` AND st.class_id = $${params.length}`;
    }
    
    query += ` ORDER BY sf.id DESC`;
    const result = await db.query(query, params);
    return result.rows;
  }

  async createStudentFee(payload, req) {
    const db = req.tenantPool;
    const { student_id, fee_structure_id, amount, due_date, concession_amount } = payload;
    
    // Fetch category name
    const structRes = await db.query(`
      SELECT fc.name FROM fee_structures fs 
      JOIN fee_categories fc ON fs.category_id = fc.id 
      WHERE fs.id = $1
    `, [fee_structure_id]);
    
    const category_name = structRes.rows[0]?.name || 'Unknown';
    const balance = amount - (concession_amount || 0);

    const result = await db.query(
      `INSERT INTO student_fees 
      (student_id, fee_structure_id, fee_category_name, amount, due_date, concession_amount, balance) 
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [student_id, fee_structure_id, category_name, amount, due_date, concession_amount || 0, balance]
    );
    return result.rows[0];
  }

  async bulkGenerateStudentFees(payload, req) {
    const db = req.tenantPool;
    const { class_id, section_id, fee_structure_id, due_date } = payload;
    
    let studentQuery = `SELECT id FROM students WHERE class_id = $1`;
    const params = [class_id];
    if (section_id) {
      params.push(section_id);
      studentQuery += ` AND section_id = $2`;
    }
    const students = await db.query(studentQuery, params);
    
    const structRes = await db.query(`
      SELECT fs.*, fc.name as category_name FROM fee_structures fs 
      JOIN fee_categories fc ON fs.category_id = fc.id 
      WHERE fs.id = $1
    `, [fee_structure_id]);
    
    const structure = structRes.rows[0];
    if (!structure) throw new Error("Fee structure not found");
    
    let count = 0;
    for (const student of students.rows) {
      await db.query(
        `INSERT INTO student_fees (student_id, fee_structure_id, fee_category_name, amount, due_date, balance) 
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [student.id, fee_structure_id, structure.category_name, structure.amount, due_date, structure.amount]
      );
      count++;
    }
    
    return { generated: count };
  }

  async getReceipts(filters, req) {
    const db = req.tenantPool;
    let query = `
      SELECT fr.*, st.full_name as student_name, st.admission_no 
      FROM fee_receipts fr
      JOIN students st ON fr.student_id = st.id
      WHERE 1=1
    `;
    const params = [];
    if (filters.student_id) {
      params.push(filters.student_id);
      query += ` AND fr.student_id = $${params.length}`;
    }
    query += ` ORDER BY fr.id DESC`;
    const result = await db.query(query, params);
    
    const receipts = result.rows;
    for (let receipt of receipts) {
      const itemsRes = await db.query(
        `SELECT fpi.*, sf.fee_category_name FROM fee_payment_items fpi
         JOIN student_fees sf ON fpi.student_fee_id = sf.id
         WHERE fpi.receipt_id = $1`,
        [receipt.id]
      );
      receipt.items = itemsRes.rows;
    }
    
    return receipts;
  }

  async collectPayment(payload, req) {
    const db = req.tenantPool;
    const { student_id, payment_mode, items, cashier_name } = payload;
    
    const receipt_number = 'REC-' + Date.now().toString(36).toUpperCase();
    
    let total_amount = 0;
    
    await db.query('BEGIN');
    try {
      for (const item of items) {
        total_amount += parseFloat(item.amount_paid) + parseFloat(item.late_fee_paid || 0);
      }
      
      const receiptRes = await db.query(
        `INSERT INTO fee_receipts (receipt_number, student_id, total_amount, payment_mode, cashier_name, payment_date)
         VALUES ($1, $2, $3, $4, $5, CURRENT_DATE) RETURNING *`,
        [receipt_number, student_id, total_amount, payment_mode, cashier_name]
      );
      
      const receipt = receiptRes.rows[0];
      
      for (const item of items) {
        await db.query(
          `INSERT INTO fee_payment_items (receipt_id, student_fee_id, amount_paid, late_fee_paid)
           VALUES ($1, $2, $3, $4)`,
          [receipt.id, item.student_fee_id, item.amount_paid, item.late_fee_paid || 0]
        );
        
        await db.query(
          `UPDATE student_fees 
           SET paid_amount = paid_amount + $1, 
               balance = balance - $1,
               status = CASE WHEN balance - $1 <= 0 THEN 'paid' ELSE 'partial' END
           WHERE id = $2`,
          [item.amount_paid, item.student_fee_id]
        );
      }
      
      await db.query('COMMIT');
      return receipt;
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    }
  }

  async getDashboardStats(req) {
    const db = req.tenantPool;
    
    const today = new Date().toISOString().split('T')[0];
    
    const dailyCollectionRes = await db.query(
      `SELECT SUM(total_amount) as total FROM fee_receipts WHERE payment_date = $1 AND status = 'active'`,
      [today]
    );
    const dailyCollection = dailyCollectionRes.rows[0].total || 0;
    
    const totalExpectedRes = await db.query(`SELECT SUM(amount - concession_amount) as total FROM student_fees`);
    const totalExpected = totalExpectedRes.rows[0].total || 0;
    
    const totalCollectedRes = await db.query(`SELECT SUM(paid_amount) as total FROM student_fees`);
    const totalCollected = totalCollectedRes.rows[0].total || 0;
    
    const outstanding = totalExpected - totalCollected;
    
    return {
      dailyCollection,
      totalExpected,
      totalCollected,
      outstanding
    };
  }
}

module.exports = new FeeService();
