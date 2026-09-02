const yearSVC = require("../validation/year.validation");
const yearService = require("../services/year.service");

class YearController {
  /**
   * Create or update year
   */
  upload_year = async (req, res, next) => {
    try {
      const yearData = await yearSVC.year(req.body);

      const result = await yearService.uploadYear(yearData, req);

      return res.status(201).json({
        message: "Year data uploaded successfully",
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * Get all years or specific year by ID
   */
  get_year = async (req, res, next) => {
    try {
      const yearId = req.params.id;

      if (yearId) {
        // Get specific year by ID
        const result = await yearService.getYearById(yearId, req);

        if (!result) {
          return res.status(404).json({ error: "Year not found" });
        }

        return res.status(200).json({
          message: "Year data retrieved successfully",
          data: result,
        });
      } else {
        // Get all years
        const results = await yearService.getAllYears(req);

        return res.status(200).json({
          message: "Year data retrieved successfully",
          data: results,
        });
      }
    } catch (err) {
      next(err);
    }
  };

  /**
   * Delete year by ID
   */
  delete_year = async (req, res, next) => {
    try {
      const yearId = req.params.id;

      const result = await yearService.deleteYear(yearId, req);

      if (!result) {
        return res.status(404).json({ error: "Year not found" });
      }

      return res.status(200).json({
        message: `Year with id ${yearId} deleted successfully`,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * Seed complete Nepali year with all months and correct AD/BS date mappings
   */
  seed_nepali_year = async (req, res, next) => {
    try {
      const { bs_year, set_as_current = false } = req.body;

      if (!bs_year || typeof bs_year !== 'number') {
        return res.status(400).json({
          error: "bs_year is required and must be a number (e.g., 2081)",
        });
      }

      // Validate BS year range - now 2082-2120
      if (bs_year < 2082 || bs_year > 2120) {
        return res.status(400).json({
          error: "bs_year must be between 2082 and 2120",
        });
      }

      const result = await yearService.seedNepaliYear(bs_year, set_as_current, req);

      return res.status(201).json({
        message: `Nepali year ${bs_year} seeded successfully with all months`,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * Get available academic years for dropdown (BS: 2082-2120, AD: 2025-2050)
   */
  get_year_options = async (req, res, next) => {
    try {
      const { mode = "BS" } = req.query;
      let options = [];
      if (mode === "BS") {
        options = yearService.getAvailableBsYears();
      } else if (mode === "AD") {
        options = Array.from({ length: 26 }, (_, i) => 2025 + i);
      } else {
        return res.status(400).json({ error: 'mode must be "BS" or "AD"' });
      }
      return res.status(200).json({
        message: `Year options for mode ${mode}`,
        data: { mode, years: options },
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * Get auto-calculated month boundaries (dates computed from BS calendar reference)
   */
  get_month_auto = async (req, res, next) => {
    try {
      const { year_id, month_index } = req.query;
      if (!year_id || !month_index) {
        return res.status(400).json({ error: "year_id and month_index are required" });
      }
      const pool = req?.tenantPool || require("../config/db");
      const yearResult = await pool.query('SELECT * FROM "year" WHERE id = $1', [year_id]);
      if (yearResult.rows.length === 0) {
        return res.status(404).json({ error: "Year not found" });
      }
      const year = yearResult.rows[0];
      const monthIdx = parseInt(month_index, 10);
      if (!year.year_label_bs) {
        return res.status(400).json({ error: "Year does not have BS year info" });
      }
      const bsYear = parseInt(year.year_label_bs.split('/')[0], 10);
      const monthInfo = yearService.getBsMonthInfo(bsYear, monthIdx);
      const monthNames = ["Baisakh", "Jestha", "Ashadh", "Shrawan", "Bhadra", "Ashwin", "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra"];
      return res.status(200).json({
        message: "Auto-calculated month info",
        data: {
          year_id,
          month_index: monthIdx,
          ...monthInfo,
          month_name: monthNames[monthIdx - 1],
        },
      });
    } catch (err) {
      next(err);
    }
  };
}

const yearCTRL = new YearController();
module.exports = yearCTRL;
