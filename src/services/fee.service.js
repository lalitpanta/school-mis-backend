const { v4: uuidv4 } = require("uuid");
const accountingService = require("./accounting.service");

const PAYMENT_MODES = new Set([
  "cash",
  "bank",
  "esewa",
  "khalti",
  "connectips",
  "cheque",
]);

function moneyToCents(value) {
  const text = String(value ?? "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
}

function centsToMoney(cents) {
  const whole = cents / 100n;
  const fraction = String(cents % 100n).padStart(2, "0");
  return `${whole}.${fraction}`;
}

class FeeService {
  async listGroups(req) {
    const result = await req.tenantPool.query(
      `SELECT * FROM fee_groups WHERE is_active = TRUE ORDER BY name`,
    );
    return result.rows;
  }

  async createGroup(payload, req) {
    const name = String(payload.name || "").trim();
    if (!name)
      throw Object.assign(new Error("Fee group name is required"), {
        status: 400,
      });
    try {
      const result = await req.tenantPool.query(
        `INSERT INTO fee_groups (name, description) VALUES ($1, $2) RETURNING *`,
        [name, payload.description || null],
      );
      return result.rows[0];
    } catch (error) {
      if (error.code === "23505")
        throw Object.assign(
          new Error("A fee group with this name already exists"),
          { status: 409 },
        );
      throw error;
    }
  }

  async getFeeStructure(id, req) {
    const result = await req.tenantPool.query(
      `
      SELECT fs.*, c.name AS class_name, s.section_name,
        COALESCE(json_agg(json_build_object(
          'id', fr.id, 'name', fr.name, 'amount', fr.amount,
          'category_id', fr.category_id, 'category_name', fc.name,
          'fee_group_id', fr.fee_group_id, 'frequency', fr.frequency,
          'charge_type', fr.charge_type, 'mandatory', fr.mandatory,
          'taxable', fr.taxable, 'refundable', fr.refundable
        ) ORDER BY fr.id) FILTER (WHERE fr.id IS NOT NULL), '[]') AS rules
      FROM fee_structures fs
      LEFT JOIN classrooms c ON c.id = fs.class_id
      LEFT JOIN sections s ON s.id = fs.section_id
      LEFT JOIN fee_rules fr ON fr.fee_structure_id = fs.id AND fr.is_active = TRUE
      LEFT JOIN fee_categories fc ON fc.id = fr.category_id
      WHERE fs.id = $1
      GROUP BY fs.id, c.name, s.section_name
    `,
      [id],
    );
    if (!result.rows[0])
      throw Object.assign(new Error("Fee structure not found"), {
        status: 404,
      });
    return result.rows[0];
  }

  async createManagedStructure(payload, req) {
    const db = req.tenantPool;
    if (
      !payload.structure_name ||
      !payload.academic_year ||
      !Array.isArray(payload.rules) ||
      !payload.rules.length
    ) {
      throw Object.assign(
        new Error(
          "Structure name, academic year, and at least one fee rule are required",
        ),
        { status: 400 },
      );
    }
    const validRules = payload.rules.map((rule) => ({
      ...rule,
      amount: Number(rule.amount),
    }));
    if (
      validRules.some(
        (rule) =>
          !rule.name?.trim() ||
          !Number.isFinite(rule.amount) ||
          rule.amount < 0,
      )
    ) {
      throw Object.assign(
        new Error("Each fee rule needs a name and a valid non-negative amount"),
        { status: 400 },
      );
    }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const header = await client.query(
        `
        INSERT INTO fee_structures
          (structure_name, category_id, amount, academic_year, class_id, section_id, status, version, effective_start_date, effective_end_date, created_by, updated_by)
        VALUES ($1,$2,$3,$4,$5,$6,'draft',1,$7,$8,$9,$9) RETURNING *
      `,
        [
          payload.structure_name,
          validRules[0].category_id || null,
          validRules.reduce((sum, rule) => sum + rule.amount, 0),
          payload.academic_year,
          payload.class_id || null,
          payload.section_id || null,
          payload.effective_start_date || null,
          payload.effective_end_date || null,
          req.user?.id || null,
        ],
      );
      const structure = header.rows[0];
      for (const rule of validRules) {
        await client.query(
          `
          INSERT INTO fee_rules
            (fee_structure_id, fee_group_id, category_id, name, amount, charge_type, frequency, mandatory, taxable, refundable, effective_start_date, effective_end_date, due_day)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        `,
          [
            structure.id,
            rule.fee_group_id || null,
            rule.category_id || null,
            rule.name,
            rule.amount,
            rule.charge_type || "recurring",
            rule.frequency || "monthly",
            rule.mandatory !== false,
            rule.taxable === true,
            rule.refundable === true,
            rule.effective_start_date || null,
            rule.effective_end_date || null,
            rule.due_day || null,
          ],
        );
      }
      const detail = await client.query(
        `SELECT * FROM fee_rules WHERE fee_structure_id = $1 ORDER BY id`,
        [structure.id],
      );
      const snapshot = { ...structure, rules: detail.rows };
      await client.query(
        `INSERT INTO fee_structure_versions (fee_structure_id, version, snapshot, created_by) VALUES ($1,1,$2,$3)`,
        [structure.id, JSON.stringify(snapshot), req.user?.id || null],
      );
      await this.audit(
        client,
        "fee_structure",
        structure.id,
        "created",
        null,
        snapshot,
        req,
      );
      await client.query("COMMIT");
      return this.getFeeStructure(structure.id, req);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async updateManagedStructure(id, payload, req) {
    const db = req.tenantPool;
    const current = await this.getFeeStructure(id, req);
    const nextVersion = Number(current.version || 1) + 1;
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE fee_structures SET version = $1, status = 'draft', updated_by = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
        [nextVersion, req.user?.id || null, id],
      );
      await client.query(
        `UPDATE fee_rules SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE fee_structure_id = $1`,
        [id],
      );
      const rules = payload.rules || current.rules;
      if (
        !Array.isArray(rules) ||
        !rules.length ||
        rules.some(
          (rule) =>
            !rule.name?.trim() ||
            !Number.isFinite(Number(rule.amount)) ||
            Number(rule.amount) < 0,
        )
      ) {
        throw Object.assign(
          new Error("At least one valid fee rule is required"),
          { status: 400 },
        );
      }
      await client.query(
        `UPDATE fee_structures SET structure_name = COALESCE($1, structure_name), academic_year = COALESCE($2, academic_year), class_id = $3, section_id = $4, effective_start_date = $5, effective_end_date = $6, amount = $7, category_id = $8 WHERE id = $9`,
        [
          payload.structure_name || null,
          payload.academic_year || null,
          payload.class_id || null,
          payload.section_id || null,
          payload.effective_start_date || null,
          payload.effective_end_date || null,
          rules.reduce((sum, rule) => sum + Number(rule.amount), 0),
          rules[0].category_id || null,
          id,
        ],
      );
      for (const rule of rules) {
        await client.query(
          `INSERT INTO fee_rules (fee_structure_id, fee_group_id, category_id, name, amount, charge_type, frequency, mandatory, taxable, refundable, effective_start_date, effective_end_date, due_day) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            id,
            rule.fee_group_id || null,
            rule.category_id || null,
            rule.name.trim(),
            Number(rule.amount),
            rule.charge_type || "recurring",
            rule.frequency || "monthly",
            rule.mandatory !== false,
            rule.taxable === true,
            rule.refundable === true,
            rule.effective_start_date || null,
            rule.effective_end_date || null,
            rule.due_day || null,
          ],
        );
      }
      const detail = await client.query(
        `SELECT * FROM fee_rules WHERE fee_structure_id = $1 AND is_active = TRUE ORDER BY id`,
        [id],
      );
      const snapshot = {
        ...current,
        ...payload,
        version: nextVersion,
        rules: detail.rows,
      };
      await client.query(
        `INSERT INTO fee_structure_versions (fee_structure_id, version, snapshot, created_by) VALUES ($1,$2,$3,$4)`,
        [id, nextVersion, JSON.stringify(snapshot), req.user?.id || null],
      );
      await this.audit(
        client,
        "fee_structure",
        id,
        "version_created",
        current,
        snapshot,
        req,
      );
      await client.query("COMMIT");
      return this.getFeeStructure(id, req);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async setStructureStatus(id, status, req) {
    if (!["draft", "active", "inactive", "archived"].includes(status))
      throw Object.assign(new Error("Invalid structure status"), {
        status: 400,
      });
    const before = await req.tenantPool.query(
      `SELECT * FROM fee_structures WHERE id = $1`,
      [id],
    );
    const result = await req.tenantPool.query(
      `UPDATE fee_structures SET status = $1, is_archived = ($1 = 'archived'), updated_by = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *`,
      [status, req.user?.id || null, id],
    );
    if (!result.rows[0])
      throw Object.assign(new Error("Fee structure not found"), {
        status: 404,
      });
    await this.audit(
      req.tenantPool,
      "fee_structure",
      id,
      status,
      before.rows[0] || null,
      result.rows[0],
      req,
    );
    return result.rows[0];
  }

  async duplicateStructure(id, req) {
    const source = await this.getFeeStructure(id, req);
    return this.createManagedStructure(
      {
        ...source,
        structure_name: `${source.structure_name || "Fee Structure"} copy`,
        status: "draft",
        rules: source.rules,
      },
      req,
    );
  }

  async assignStructure(payload, req) {
    if (
      !payload.fee_structure_id ||
      (!payload.student_id && !payload.class_id && !payload.section_id)
    )
      throw Object.assign(
        new Error("A structure and assignment scope are required"),
        { status: 400 },
      );
    const result = await req.tenantPool.query(
      `INSERT INTO fee_assignments (fee_structure_id, fee_structure_version_id, student_id, class_id, section_id, effective_date, override_amount, override_reason, approval_status, assigned_by) SELECT $1, id, $2,$3,$4,$5,$6,$7,$8,$9 FROM fee_structure_versions v JOIN fee_structures fs ON fs.id = v.fee_structure_id WHERE v.fee_structure_id = $1 AND v.version = fs.version AND fs.status = 'active' RETURNING *`,
      [
        payload.fee_structure_id,
        payload.student_id || null,
        payload.class_id || null,
        payload.section_id || null,
        payload.effective_date || new Date().toISOString().slice(0, 10),
        payload.override_amount || null,
        payload.override_reason || null,
        payload.approval_status || "pending",
        req.user?.id || null,
      ],
    );
    if (!result.rows[0])
      throw Object.assign(new Error("Active structure version not found"), {
        status: 400,
      });
    await this.audit(
      req.tenantPool,
      "fee_assignment",
      result.rows[0].id,
      "assigned",
      null,
      result.rows[0],
      req,
    );
    return result.rows[0];
  }

  async createInvoice(payload, req) {
    if (!payload.student_id || !payload.fee_structure_id)
      throw Object.assign(
        new Error("Student and active fee structure are required"),
        { status: 400 },
      );
    const db = req.tenantPool;
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const structure = await client.query(
        `
        SELECT fs.id, fs.academic_year, fs.status, fs.version, fsv.id AS version_id,
          s.class_id, s.section_id
        FROM fee_structures fs
        JOIN fee_structure_versions fsv ON fsv.fee_structure_id = fs.id AND fsv.version = fs.version
        JOIN students s ON s.id = $2 AND s.is_active = TRUE
        WHERE fs.id = $1 AND fs.status = 'active'
          AND (fs.class_id IS NULL OR fs.class_id = s.class_id)
          AND (fs.section_id IS NULL OR fs.section_id = s.section_id)
        FOR SHARE
      `,
        [payload.fee_structure_id, payload.student_id],
      );
      if (!structure.rows[0])
        throw Object.assign(
          new Error("Active fee structure is not applicable to this student"),
          { status: 400 },
        );
      const rules = await client.query(
        `SELECT id, name, amount, frequency, mandatory, taxable FROM fee_rules WHERE fee_structure_id = $1 AND is_active = TRUE ORDER BY id`,
        [payload.fee_structure_id],
      );
      if (!rules.rows.length)
        throw Object.assign(
          new Error("Active fee structure has no fee rules"),
          { status: 400 },
        );
      const items = rules.rows.map((rule) => ({
        fee_rule_id: rule.id,
        line_type: "fee",
        description: rule.name,
        amount: rule.amount,
        metadata: {
          frequency: rule.frequency,
          mandatory: rule.mandatory,
          taxable: rule.taxable,
        },
      }));
      const baseCents = items.reduce((sum, item) => {
        const amount = moneyToCents(item.amount);
        if (amount === null || amount < 0n)
          throw Object.assign(
            new Error("Fee rules contain an invalid monetary amount"),
            { status: 400 },
          );
        return sum + amount;
      }, 0n);
      const base = centsToMoney(baseCents);
      const discount = "0.00";
      const levy = "0.00";
      const fine = "0.00";
      const total = base;
      const settings = await client.query(
        `SELECT value FROM settings WHERE key = 'invoice_config' LIMIT 1`,
      );
      let invoiceConfig = {};
      if (settings.rows[0]?.value) {
        try {
          invoiceConfig = JSON.parse(settings.rows[0].value);
        } catch {
          invoiceConfig = {};
        }
      }
      const numberSequence = (
        await client.query(`SELECT nextval('fee_invoice_number_seq') AS value`)
      ).rows[0].value;
      const number = `${invoiceConfig.invoice_prefix || "INV"}-${new Date().getFullYear()}-${String(numberSequence).padStart(6, "0")}`;
      const snapshot = {
        ...invoiceConfig,
        generated_at: new Date().toISOString(),
        fee_structure_version: structure.rows[0].version_id,
      };
      const invoice = await client.query(
        `INSERT INTO fee_invoices (invoice_number, student_id, fee_structure_id, fee_structure_version_id, academic_year, due_date, subtotal, discount_total, levy_total, fine_total, total, invoice_snapshot, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [
          number,
          payload.student_id,
          structure.rows[0].id,
          structure.rows[0].version_id,
          structure.rows[0].academic_year,
          payload.due_date || null,
          base,
          discount,
          levy,
          fine,
          total,
          JSON.stringify(snapshot),
          req.user?.id || null,
        ],
      );
      for (const item of items)
        await client.query(
          `INSERT INTO fee_invoice_items (invoice_id, fee_rule_id, line_type, description, amount, metadata) VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            invoice.rows[0].id,
            item.fee_rule_id,
            item.line_type,
            item.description,
            item.amount,
            JSON.stringify(item.metadata),
          ],
        );
      await this.audit(
        client,
        "invoice",
        invoice.rows[0].id,
        "created",
        null,
        invoice.rows[0],
        req,
      );
      await client.query("COMMIT");
      return invoice.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async recordInvoicePayment(invoiceId, payload, req) {
    if (!payload.amount || !payload.payment_method || !payload.idempotency_key)
      throw Object.assign(
        new Error("Amount, payment method, and idempotency key are required"),
        { status: 400 },
      );
    if (!PAYMENT_MODES.has(payload.payment_method))
      throw Object.assign(new Error("Unsupported payment mode"), {
        status: 400,
      });
    if (payload.payment_method !== "cash" && !payload.payment_reference?.trim())
      throw Object.assign(
        new Error("Reference number is required for non-cash payments"),
        { status: 400 },
      );
    const amountCents = moneyToCents(payload.amount);
    if (amountCents === null || amountCents <= 0n)
      throw Object.assign(
        new Error("Amount must be a valid positive monetary value"),
        { status: 400 },
      );
    const db = req.tenantPool;
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query(
        `SELECT * FROM fee_payments WHERE idempotency_key = $1 FOR UPDATE`,
        [payload.idempotency_key],
      );
      if (existing.rows[0]) {
        await client.query("COMMIT");
        return existing.rows[0];
      }
      const invoice = await client.query(
        `SELECT * FROM fee_invoices WHERE id = $1 FOR UPDATE`,
        [invoiceId],
      );
      if (!invoice.rows[0])
        throw Object.assign(new Error("Invoice not found"), { status: 404 });
      const outstanding =
        (moneyToCents(invoice.rows[0].total) || 0n) -
        (moneyToCents(invoice.rows[0].amount_paid || "0") || 0n);
      if (amountCents > outstanding)
        throw Object.assign(
          new Error(
            `Payment exceeds outstanding balance of ${centsToMoney(outstanding)}`,
          ),
          { status: 400 },
        );
      const receipt = `RCT-${new Date().getFullYear()}-${String((await client.query(`SELECT nextval('fee_receipt_number_seq') AS value`)).rows[0].value).padStart(6, "0")}`;
      const payment = await client.query(
        `INSERT INTO fee_payments (invoice_id, receipt_number, amount, payment_method, provider_reference, payment_reference, idempotency_key, collector_id, received_by, remarks) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9) RETURNING *`,
        [
          invoiceId,
          receipt,
          centsToMoney(amountCents),
          payload.payment_method,
          payload.provider_reference || null,
          payload.payment_reference || null,
          payload.idempotency_key,
          req.user?.id || null,
          payload.remarks || null,
        ],
      );
      const invoiceItems = await client.query(
        `SELECT fii.*, COALESCE(SUM(fpa.amount), 0) AS allocated FROM fee_invoice_items fii LEFT JOIN fee_payment_allocations fpa ON fpa.invoice_item_id = fii.id WHERE fii.invoice_id = $1 GROUP BY fii.id ORDER BY fii.id`,
        [invoiceId],
      );
      let remaining = amountCents;
      for (const item of invoiceItems.rows) {
        const available =
          (moneyToCents(item.amount) || 0n) -
          (moneyToCents(item.allocated || "0") || 0n);
        const allocation = available < remaining ? available : remaining;
        if (allocation > 0n) {
          await client.query(
            `INSERT INTO fee_payment_allocations (payment_id, invoice_item_id, amount) VALUES ($1,$2,$3)`,
            [payment.rows[0].id, item.id, centsToMoney(allocation)],
          );
          remaining -= allocation;
        }
        if (remaining === 0n) break;
      }
      if (remaining !== 0n)
        throw Object.assign(
          new Error("Invoice has insufficient unallocated line-item balance"),
          { status: 409 },
        );
      const paid =
        (moneyToCents(invoice.rows[0].amount_paid || "0") || 0n) + amountCents;
      await client.query(
        `UPDATE fee_invoices SET amount_paid = $1, receipt_number = $2, status = CASE WHEN $1::numeric >= total THEN 'paid' ELSE 'partial' END, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
        [centsToMoney(paid), receipt, invoiceId],
      );
      const transactionRes = await client.query(
        `INSERT INTO accounts_transactions (txn_date, particulars, category, txn_type, amount, payment_mode, status, reference_id, student_id, created_by, notes) VALUES (CURRENT_DATE, $1, 'Student Fees', 'income', $2, $3, 'paid', $4, $5, $6, $7) RETURNING id`,
        [
          `Invoice payment - ${receipt}`,
          centsToMoney(amountCents),
          payload.payment_method === "cash"
            ? "cash"
            : payload.payment_method === "bank" ||
                payload.payment_method === "cheque"
              ? payload.payment_method
              : "online",
          receipt,
          invoice.rows[0].student_id,
          req.user?.id || null,
          payload.remarks || null,
        ],
      );
      await accountingService.postLegacyTransaction(
        client,
        {
          txn_date: new Date().toISOString().slice(0, 10),
          particulars: `Invoice payment - ${receipt}`,
          category: "Student Fees",
          txn_type: "income",
          amount: centsToMoney(amountCents),
          payment_mode:
            payload.payment_method === "cash"
              ? "cash"
              : payload.payment_method === "bank" ||
                  payload.payment_method === "cheque"
                ? payload.payment_method
                : "online",
          fiscal_year: undefined,
        },
        transactionRes.rows[0].id,
        req,
      );
      await client.query(
        `INSERT INTO fee_ledger_entries (student_id, receipt_id, entry_type, amount, reference, description, created_by) VALUES ($1,NULL,'payment',$2,$3,$4,$5)`,
        [
          invoice.rows[0].student_id,
          centsToMoney(amountCents),
          receipt,
          `Invoice ${invoice.rows[0].invoice_number}`,
          req.user?.id || null,
        ],
      );
      await this.audit(
        client,
        "invoice",
        invoiceId,
        "payment_recorded",
        invoice.rows[0],
        payment.rows[0],
        req,
      );
      await client.query("COMMIT");
      return payment.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listInvoices(req) {
    const result = await req.tenantPool.query(
      `SELECT fi.*, s.full_name AS student_name, s.admission_no FROM fee_invoices fi JOIN students s ON s.id = fi.student_id ORDER BY fi.id DESC LIMIT 100`,
    );
    return result.rows;
  }

  async getInvoice(id, req) {
    const invoice = await req.tenantPool.query(
      `SELECT fi.*, s.full_name AS student_name, s.admission_no, c.class_name, sec.section_name FROM fee_invoices fi JOIN students s ON s.id = fi.student_id LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN sections sec ON sec.id = s.section_id WHERE fi.id = $1`,
      [id],
    );
    if (!invoice.rows[0])
      throw Object.assign(new Error("Invoice not found"), { status: 404 });
    const items = await req.tenantPool.query(
      `SELECT * FROM fee_invoice_items WHERE invoice_id = $1 ORDER BY id`,
      [id],
    );
    return { ...invoice.rows[0], items: items.rows };
  }

  async requestReceiptCancellation(receiptId, reason, req) {
    if (!reason?.trim())
      throw Object.assign(new Error("Cancellation reason is required"), {
        status: 400,
      });
    const result = await req.tenantPool.query(
      `
      INSERT INTO fee_receipt_cancellations (receipt_id, reason, requested_by)
      SELECT $1, $2, $3 WHERE EXISTS (SELECT 1 FROM fee_receipts WHERE id = $1 AND status = 'active')
      RETURNING *
    `,
      [receiptId, reason.trim(), req.user?.id || null],
    );
    if (!result.rows[0])
      throw Object.assign(
        new Error("Active receipt not found or cancellation already requested"),
        { status: 400 },
      );
    await this.audit(
      req.tenantPool,
      "fee_receipt",
      receiptId,
      "cancellation_requested",
      null,
      result.rows[0],
      req,
    );
    return result.rows[0];
  }

  async approveReceiptCancellation(receiptId, req) {
    const client = await req.tenantPool.connect();
    try {
      await client.query("BEGIN");
      const cancellation = await client.query(
        `SELECT frc.*, fr.student_id, fr.total_amount, fr.receipt_number FROM fee_receipt_cancellations frc JOIN fee_receipts fr ON fr.id = frc.receipt_id WHERE frc.receipt_id = $1 AND frc.status = 'requested' FOR UPDATE`,
        [receiptId],
      );
      if (!cancellation.rows[0])
        throw Object.assign(new Error("Pending cancellation not found"), {
          status: 404,
        });
      const items = await client.query(
        `SELECT fpi.*, sf.fee_category_name FROM fee_payment_items fpi JOIN student_fees sf ON sf.id = fpi.student_fee_id WHERE fpi.receipt_id = $1 FOR UPDATE`,
        [receiptId],
      );
      for (const item of items.rows) {
        await client.query(
          `UPDATE student_fees SET paid_amount = GREATEST(COALESCE(paid_amount, 0) - $1::numeric, 0), balance = COALESCE(balance, 0) + $1::numeric, status = CASE WHEN COALESCE(paid_amount, 0) - $1::numeric <= 0 THEN 'unpaid' ELSE 'partial' END, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [item.amount_paid, item.student_fee_id],
        );
        await client.query(
          `INSERT INTO fee_ledger_entries (student_id, student_fee_id, receipt_id, entry_type, amount, reference, description, created_by) SELECT student_id, $1, $2, 'refund', $3, receipt_number, $4, $5 FROM fee_receipts WHERE id = $2`,
          [
            item.student_fee_id,
            receiptId,
            item.amount_paid,
            `Cancelled ${item.fee_category_name}`,
            req.user?.id || null,
          ],
        );
      }
      await client.query(
        `UPDATE fee_receipts SET status = 'cancelled', cancellation_reason = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [cancellation.rows[0].reason, receiptId],
      );
      await client.query(
        `UPDATE fee_receipt_cancellations SET status = 'approved', approved_by = $1, approved_at = CURRENT_TIMESTAMP WHERE receipt_id = $2`,
        [req.user?.id || null, receiptId],
      );
      const transactionRes = await client.query(
        `INSERT INTO accounts_transactions (txn_date, particulars, category, txn_type, amount, payment_mode, status, reference_id, student_id, created_by, notes) VALUES (CURRENT_DATE, $1, 'Fee Reversal', 'expense', $2, 'other', 'paid', $3, $4, $5, $6) RETURNING id`,
        [
          `Reversal - ${cancellation.rows[0].receipt_number}`,
          cancellation.rows[0].total_amount,
          cancellation.rows[0].receipt_number,
          cancellation.rows[0].student_id,
          req.user?.id || null,
          cancellation.rows[0].reason,
        ],
      );
      await accountingService.postLegacyTransaction(
        client,
        {
          txn_date: new Date().toISOString().slice(0, 10),
          particulars: `Reversal - ${cancellation.rows[0].receipt_number}`,
          category: "Fee Reversal",
          txn_type: "expense",
          amount: cancellation.rows[0].total_amount,
          payment_mode: "other",
        },
        transactionRes.rows[0].id,
        req,
      );
      await this.audit(
        client,
        "fee_receipt",
        receiptId,
        "cancellation_approved",
        cancellation.rows[0],
        { status: "cancelled" },
        req,
      );
      await client.query("COMMIT");
      return { receipt_id: Number(receiptId), status: "cancelled" };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async audit(db, entityType, entityId, action, beforeData, afterData, req) {
    await db.query(
      `INSERT INTO fee_audit_logs (entity_type, entity_id, action, before_data, after_data, actor_id) VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        entityType,
        entityId,
        action,
        beforeData ? JSON.stringify(beforeData) : null,
        afterData ? JSON.stringify(afterData) : null,
        req.user?.id || null,
      ],
    );
  }

  async listAudit(entityId, req) {
    const result = await req.tenantPool.query(
      `SELECT * FROM fee_audit_logs WHERE entity_id = $1 OR ($1 IS NULL AND entity_type LIKE 'fee_%') ORDER BY created_at DESC LIMIT 100`,
      [entityId || null],
    );
    return result.rows;
  }

  async getCategories(req) {
    const db = req.tenantPool;
    const result = await db.query(
      `SELECT * FROM fee_categories ORDER BY id DESC`,
    );
    return result.rows;
  }

  async createCategory(payload, req) {
    const db = req.tenantPool;
    const name = String(payload.name || "").trim();
    if (!name)
      throw Object.assign(new Error("Fee category name is required"), {
        status: 400,
      });
    try {
      const result = await db.query(
        `INSERT INTO fee_categories (name, description, is_active) VALUES ($1, $2, TRUE) RETURNING *`,
        [name, payload.description || null],
      );
      return result.rows[0];
    } catch (error) {
      if (error.code === "23505")
        throw Object.assign(
          new Error("A fee category with this name already exists"),
          { status: 409 },
        );
      throw error;
    }
  }

  async getStructures(req) {
    const db = req.tenantPool;
    const query = `
      SELECT fs.*, c.name as class_name, s.section_name,
        COALESCE(json_agg(json_build_object('id', fr.id, 'name', fr.name, 'amount', fr.amount, 'frequency', fr.frequency, 'mandatory', fr.mandatory)) FILTER (WHERE fr.id IS NOT NULL), '[]') AS rules
      FROM fee_structures fs
      LEFT JOIN classrooms c ON fs.class_id = c.id
      LEFT JOIN sections s ON fs.section_id = s.id
      LEFT JOIN fee_rules fr ON fr.fee_structure_id = fs.id AND fr.is_active = TRUE
      GROUP BY fs.id, c.name, s.section_name
      ORDER BY fs.id DESC
    `;
    const result = await db.query(query);
    return result.rows;
  }

  async createStructure(payload, req) {
    const db = req.tenantPool;
    const {
      category_id,
      class_id,
      section_id,
      academic_year,
      student_type,
      frequency,
      amount,
      due_day,
      late_fee_type,
      late_fee_amount,
      grace_period_days,
    } = payload;

    const result = await db.query(
      `INSERT INTO fee_structures 
      (category_id, class_id, section_id, academic_year, student_type, frequency, amount, due_day, late_fee_type, late_fee_amount, grace_period_days) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [
        category_id,
        class_id || null,
        section_id || null,
        academic_year,
        student_type,
        frequency,
        amount,
        due_day || null,
        late_fee_type,
        late_fee_amount || 0,
        grace_period_days || 0,
      ],
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

  async lookupStudents(search, req) {
    const value = String(search || "").trim();
    if (value.length < 2)
      throw Object.assign(
        new Error("Search must contain at least two characters"),
        { status: 400 },
      );
    const result = await req.tenantPool.query(
      `
      SELECT s.id, s.full_name, s.admission_no, s.roll_no, s.guardian_name, s.guardian_phone, s.guardian_email,
        c.class_name, sec.section_name
      FROM students s
      LEFT JOIN classes c ON c.id = s.class_id
      LEFT JOIN sections sec ON sec.id = s.section_id
      WHERE s.is_active = TRUE AND (CAST(s.id AS TEXT) = $1 OR LOWER(COALESCE(s.admission_no, '')) = LOWER($1) OR LOWER(s.full_name) LIKE LOWER($2))
      ORDER BY s.full_name
      LIMIT 20
    `,
      [value, `%${value}%`],
    );
    return result.rows;
  }

  async getStudentDue(studentId, req) {
    const result = await req.tenantPool.query(
      `
      SELECT s.id, s.full_name, s.admission_no, s.roll_no, s.guardian_name, s.guardian_phone, s.guardian_email,
        c.class_name, sec.section_name,
        COALESCE(json_agg(json_build_object(
          'id', sf.id, 'category', sf.fee_category_name, 'amount', sf.amount,
          'discount', COALESCE(sf.discount_amount, sf.concession_amount, 0),
          'fine', COALESCE(sf.fine_amount, 0), 'levy', COALESCE(sf.levy_amount, 0),
          'paid', sf.paid_amount, 'balance', sf.balance, 'due_date', sf.due_date,
          'status', sf.status, 'fee_rule_id', sf.fee_rule_id,
          'academic_year', fs.academic_year
        ) ORDER BY sf.due_date NULLS LAST, sf.id) FILTER (WHERE sf.id IS NOT NULL), '[]') AS dues
      FROM students s
      LEFT JOIN classes c ON c.id = s.class_id
      LEFT JOIN sections sec ON sec.id = s.section_id
      LEFT JOIN student_fees sf ON sf.student_id = s.id AND sf.status <> 'paid'
      LEFT JOIN fee_structures fs ON fs.id = sf.fee_structure_id
      WHERE s.id = $1 AND s.is_active = TRUE
      GROUP BY s.id, c.class_name, sec.section_name
    `,
      [studentId],
    );
    if (!result.rows[0])
      throw Object.assign(new Error("Active student not found"), {
        status: 404,
      });
    const student = result.rows[0];
    const dues = student.dues || [];
    return {
      ...student,
      dues,
      totals: dues.reduce(
        (summary, due) => {
          summary.base += Number(due.amount || 0);
          summary.discount += Number(due.discount || 0);
          summary.fine += Number(due.fine || 0);
          summary.levy += Number(due.levy || 0);
          summary.paid += Number(due.paid || 0);
          summary.outstanding += Number(due.balance || 0);
          return summary;
        },
        { base: 0, discount: 0, fine: 0, levy: 0, paid: 0, outstanding: 0 },
      ),
    };
  }

  async generateStudentDue(studentId, req) {
    const db = req.tenantPool;
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const student = await client.query(
        `SELECT id, class_id, section_id FROM students WHERE id = $1 AND is_active = TRUE FOR UPDATE`,
        [studentId],
      );
      if (!student.rows[0])
        throw Object.assign(new Error("Active student not found"), {
          status: 404,
        });
      const structures = await client.query(
        `
        SELECT DISTINCT ON (fr.id) fr.*, fs.id AS structure_id, fs.academic_year, fsv.id AS version_id
        FROM fee_assignments fa
        JOIN fee_structures fs ON fs.id = fa.fee_structure_id AND fs.status = 'active'
        JOIN fee_structure_versions fsv ON fsv.fee_structure_id = fs.id AND fsv.version = fs.version
        JOIN fee_rules fr ON fr.fee_structure_id = fs.id AND fr.is_active = TRUE
        WHERE (fa.student_id = $1 OR (fa.student_id IS NULL AND (fa.section_id = $2 OR (fa.section_id IS NULL AND fa.class_id = $3))))
        ORDER BY fr.id, fa.student_id NULLS LAST, fa.created_at DESC
      `,
        [studentId, student.rows[0].section_id, student.rows[0].class_id],
      );
      let generated = 0;
      for (const rule of structures.rows) {
        const result = await client.query(
          `
          INSERT INTO student_fees (student_id, fee_structure_id, fee_structure_version_id, fee_rule_id, fee_category_name, amount, charge_amount, due_date, balance)
          VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$6)
          ON CONFLICT (student_id, fee_rule_id, due_date) WHERE fee_rule_id IS NOT NULL DO NOTHING
          RETURNING id
        `,
          [
            studentId,
            rule.structure_id,
            rule.version_id,
            rule.id,
            rule.name,
            rule.amount,
            rule.effective_start_date || new Date().toISOString().slice(0, 10),
          ],
        );
        generated += result.rowCount;
        if (result.rows[0])
          await client.query(
            `INSERT INTO fee_ledger_entries (student_id, student_fee_id, entry_type, amount, description, created_by) VALUES ($1,$2,'charge',$3,$4,$5)`,
            [
              studentId,
              result.rows[0].id,
              rule.amount,
              rule.name,
              req.user?.id || null,
            ],
          );
      }
      await client.query("COMMIT");
      return { generated };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async createStudentFee(payload, req) {
    const db = req.tenantPool;
    const {
      student_id,
      fee_structure_id,
      amount,
      due_date,
      concession_amount,
    } = payload;

    // Fetch category name
    const structRes = await db.query(
      `
      SELECT fc.name FROM fee_structures fs 
      LEFT JOIN fee_categories fc ON fs.category_id = fc.id
      WHERE fs.id = $1
    `,
      [fee_structure_id],
    );

    const category_name = structRes.rows[0]?.name || "Unknown";
    const balance = amount - (concession_amount || 0);

    const result = await db.query(
      `INSERT INTO student_fees 
      (student_id, fee_structure_id, fee_category_name, amount, due_date, concession_amount, balance) 
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        student_id,
        fee_structure_id,
        category_name,
        amount,
        due_date,
        concession_amount || 0,
        balance,
      ],
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

    const structRes = await db.query(
      `
      SELECT fs.*, fc.name as category_name FROM fee_structures fs 
      JOIN fee_categories fc ON fs.category_id = fc.id 
      WHERE fs.id = $1
    `,
      [fee_structure_id],
    );

    const structure = structRes.rows[0];
    if (!structure) throw new Error("Fee structure not found");

    let count = 0;
    for (const student of students.rows) {
      await db.query(
        `INSERT INTO student_fees (student_id, fee_structure_id, fee_category_name, amount, due_date, balance) 
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          student.id,
          fee_structure_id,
          structure.category_name,
          structure.amount,
          due_date,
          structure.amount,
        ],
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
        [receipt.id],
      );
      receipt.items = itemsRes.rows;
    }

    return receipts;
  }

  async collectPayment(payload, req) {
    const db = req.tenantPool;
    const {
      student_id,
      payment_mode,
      items,
      cashier_name,
      payment_reference,
      remarks,
      idempotency_key,
    } = payload;
    if (
      !student_id ||
      !Array.isArray(items) ||
      !items.length ||
      !idempotency_key
    ) {
      throw Object.assign(
        new Error("Student, fee allocations, and idempotency key are required"),
        { status: 400 },
      );
    }
    if (!PAYMENT_MODES.has(payment_mode))
      throw Object.assign(new Error("Unsupported payment mode"), {
        status: 400,
      });
    if (payment_mode !== "cash" && !payment_reference?.trim())
      throw Object.assign(
        new Error("Reference number is required for non-cash payments"),
        { status: 400 },
      );
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query(
        `SELECT * FROM fee_receipts WHERE idempotency_key = $1 FOR UPDATE`,
        [idempotency_key],
      );
      if (existing.rows[0]) {
        await client.query("COMMIT");
        return existing.rows[0];
      }
      const totalCents = items.reduce((sum, item) => {
        const amount = moneyToCents(item.amount_paid);
        const fine = moneyToCents(item.late_fee_paid || "0");
        if (amount === null || fine === null || amount <= 0n || fine < 0n)
          throw Object.assign(
            new Error("Payment amounts must be valid positive monetary values"),
            { status: 400 },
          );
        return sum + amount + fine;
      }, 0n);
      if (
        new Set(items.map((item) => String(item.student_fee_id))).size !==
        items.length
      )
        throw Object.assign(
          new Error("Each fee due may only be allocated once per payment"),
          { status: 400 },
        );
      const student = await client.query(
        `SELECT id FROM students WHERE id = $1 AND is_active = TRUE`,
        [student_id],
      );
      if (!student.rows[0])
        throw Object.assign(new Error("Active student not found"), {
          status: 404,
        });
      const allocationRows = [];
      for (const item of items) {
        const amountCents = moneyToCents(item.amount_paid);
        const fineCents = moneyToCents(item.late_fee_paid || "0");
        const due = await client.query(
          `SELECT sf.*, fs.status AS structure_status, fs.version AS structure_version FROM student_fees sf LEFT JOIN fee_structures fs ON fs.id = sf.fee_structure_id WHERE sf.id = $1 AND sf.student_id = $2 FOR UPDATE`,
          [item.student_fee_id, student_id],
        );
        if (!due.rows[0])
          throw Object.assign(
            new Error("Fee due does not belong to the selected student"),
            { status: 400 },
          );
        const outstandingCents = moneyToCents(due.rows[0].balance || "0");
        if (outstandingCents === null || amountCents > outstandingCents)
          throw Object.assign(
            new Error(
              `Payment exceeds outstanding balance for ${due.rows[0].fee_category_name}`,
            ),
            { status: 400 },
          );
        allocationRows.push({
          due: due.rows[0],
          amount: centsToMoney(amountCents),
          fine: centsToMoney(fineCents),
        });
      }
      const receiptNumber = `REC-${new Date().getFullYear()}-${String((await client.query(`SELECT nextval('fee_receipt_number_seq') AS value`)).rows[0].value).padStart(6, "0")}`;
      const receiptRes = await client.query(
        `INSERT INTO fee_receipts (receipt_number, student_id, total_amount, payment_mode, cashier_name, payment_date, idempotency_key, payment_reference, collector_id, remarks)
         VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6, $7, $8, $9) RETURNING *`,
        [
          receiptNumber,
          student_id,
          centsToMoney(totalCents),
          payment_mode,
          cashier_name,
          idempotency_key,
          payment_reference || null,
          req.user?.id || null,
          remarks || null,
        ],
      );
      const receipt = receiptRes.rows[0];
      for (const allocation of allocationRows) {
        await client.query(
          `INSERT INTO fee_payment_items (receipt_id, student_fee_id, fee_rule_id, amount_paid, allocation_amount, late_fee_paid)
           VALUES ($1, $2, $3, $4, $4, $5)`,
          [
            receipt.id,
            allocation.due.id,
            allocation.due.fee_rule_id || null,
            allocation.amount,
            allocation.fine,
          ],
        );
        await client.query(
          `UPDATE student_fees 
           SET paid_amount = COALESCE(paid_amount, 0) + $1::numeric,
               balance = GREATEST(COALESCE(balance, 0) - $1::numeric, 0),
               status = CASE WHEN COALESCE(balance, 0) - $1::numeric <= 0 THEN 'paid' ELSE 'partial' END,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [allocation.amount, allocation.due.id],
        );
        await client.query(
          `INSERT INTO fee_ledger_entries (student_id, student_fee_id, receipt_id, entry_type, amount, reference, description, created_by) VALUES ($1,$2,$3,'payment',$4,$5,$6,$7)`,
          [
            student_id,
            allocation.due.id,
            receipt.id,
            centsToMoney(
              (moneyToCents(allocation.amount) || 0n) +
                (moneyToCents(allocation.fine) || 0n),
            ),
            receipt.receipt_number,
            allocation.due.fee_category_name,
            req.user?.id || null,
          ],
        );
      }
      const ledgerMode =
        payment_mode === "cash"
          ? "cash"
          : payment_mode === "bank" || payment_mode === "cheque"
            ? payment_mode
            : "online";
      const transactionRes = await client.query(
        `INSERT INTO accounts_transactions (txn_date, particulars, category, txn_type, amount, payment_mode, status, reference_id, student_id, created_by, notes) VALUES (CURRENT_DATE, $1, 'Student Fees', 'income', $2, $3, 'paid', $4, $5, $6, $7) RETURNING id`,
        [
          `Fee payment - ${receipt.receipt_number}`,
          centsToMoney(totalCents),
          ledgerMode,
          receipt.receipt_number,
          student_id,
          req.user?.id || null,
          remarks || null,
        ],
      );
      await accountingService.postLegacyTransaction(
        client,
        {
          txn_date: new Date().toISOString().slice(0, 10),
          particulars: `Fee payment - ${receipt.receipt_number}`,
          category: "Student Fees",
          txn_type: "income",
          amount: centsToMoney(totalCents),
          payment_mode: ledgerMode,
        },
        transactionRes.rows[0].id,
        req,
      );
      await this.audit(
        client,
        "fee_receipt",
        receipt.id,
        "payment_collected",
        null,
        receipt,
        req,
      );
      await client.query("COMMIT");
      return receipt;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async getDashboardStats(req) {
    const db = req.tenantPool;

    const today = new Date().toISOString().split("T")[0];

    const dailyCollectionRes = await db.query(
      `SELECT SUM(total_amount) as total FROM fee_receipts WHERE payment_date = $1 AND status = 'active'`,
      [today],
    );
    const dailyCollection = dailyCollectionRes.rows[0].total || 0;

    const totalExpectedRes = await db.query(
      `SELECT SUM(amount - concession_amount) as total FROM student_fees`,
    );
    const totalExpected = totalExpectedRes.rows[0].total || 0;

    const totalCollectedRes = await db.query(
      `SELECT SUM(paid_amount) as total FROM student_fees`,
    );
    const totalCollected = totalCollectedRes.rows[0].total || 0;

    const outstanding = totalExpected - totalCollected;

    return {
      dailyCollection,
      totalExpected,
      totalCollected,
      outstanding,
    };
  }
}

module.exports = new FeeService();
