const pool = require("../config/db");

// Get all packages
exports.getAllPackages = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM packages ORDER BY created_at DESC`
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("Error fetching packages:", error);
    res.status(500).json({ success: false, message: "Server error fetching packages." });
  }
};

// Create a new package
exports.createPackage = async (req, res) => {
  const { package_name, description, accessed_modules, price, time_period, is_active } = req.body;
  
  if (!package_name || price === undefined) {
    return res.status(400).json({ success: false, message: "Package name and price are required." });
  }

  try {
    const modulesJson = JSON.stringify(accessed_modules || []);
    const result = await pool.query(
      `INSERT INTO packages (package_name, description, accessed_modules, price, time_period, is_active)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [package_name, description, modulesJson, price, time_period, is_active !== undefined ? is_active : true]
    );

    res.status(201).json({ success: true, data: result.rows[0], message: "Package created successfully." });
  } catch (error) {
    console.error("Error creating package:", error);
    res.status(500).json({ success: false, message: "Server error creating package." });
  }
};

// Update a package
exports.updatePackage = async (req, res) => {
  const { id } = req.params;
  const { package_name, description, accessed_modules, price, time_period, is_active } = req.body;

  try {
    const modulesJson = accessed_modules ? JSON.stringify(accessed_modules) : null;
    
    // Build dynamic query depending on what's provided, or just update all fields
    const result = await pool.query(
      `UPDATE packages
       SET package_name = $1, description = $2, accessed_modules = COALESCE($3, accessed_modules),
           price = $4, time_period = $5, is_active = $6, updated_at = CURRENT_TIMESTAMP
       WHERE id = $7 RETURNING *`,
      [package_name, description, modulesJson, price, time_period, is_active, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Package not found." });
    }

    res.json({ success: true, data: result.rows[0], message: "Package updated successfully." });
  } catch (error) {
    console.error("Error updating package:", error);
    res.status(500).json({ success: false, message: "Server error updating package." });
  }
};

// Delete a package
exports.deletePackage = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `DELETE FROM packages WHERE id = $1 RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Package not found." });
    }

    res.json({ success: true, message: "Package deleted successfully." });
  } catch (error) {
    console.error("Error deleting package:", error);
    res.status(500).json({ success: false, message: "Server error deleting package." });
  }
};
