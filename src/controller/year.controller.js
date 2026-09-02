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

      // Validate BS year range
      if (bs_year < 2079 || bs_year > 2090) {
        return res.status(400).json({
          error: "bs_year must be between 2079 and 2090",
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
}

const yearCTRL = new YearController();
module.exports = yearCTRL;
