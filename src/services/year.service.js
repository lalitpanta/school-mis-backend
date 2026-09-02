const { getTenantPool } = require("../config/tenantDb");
const { getAvailableBsYears } = require("./bsCalendar.service");

class YearService {
  /**
   * Get available BS years from calendar reference (2082-2120)
   */
  getAvailableBsYears = () => {
    return getAvailableBsYears();
  };

  /**
   * Get BS month info from calendar reference
   */
  getBsMonthInfo = (bsYear, bsMonth) => {
    const { getBsMonthInfo } = require("./bsCalendar.service");
    return getBsMonthInfo(bsYear, bsMonth);
  };
  /**
   * Ensure the year table has all required columns.
   * Safe to call on every request — uses ADD COLUMN IF NOT EXISTS.
   */
  _ensureYearSchema = async (pool) => {
    await pool.query(`
      ALTER TABLE "year"
        ADD COLUMN IF NOT EXISTS year_label_ad  VARCHAR(255),
        ADD COLUMN IF NOT EXISTS year_label_bs  VARCHAR(255),
        ADD COLUMN IF NOT EXISTS start_date_ad  DATE,
        ADD COLUMN IF NOT EXISTS end_date_ad    DATE,
        ADD COLUMN IF NOT EXISTS start_date_bs  VARCHAR(255),
        ADD COLUMN IF NOT EXISTS end_date_bs    VARCHAR(255),
        ADD COLUMN IF NOT EXISTS is_current     BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    `);
  };

  /**
   * Create or update year
   */
  uploadYear = async (yearData, req) => {
    try {
      const pool = req?.tenantPool || require("../config/db");

      // Ensure all columns exist before trying to insert
      await this._ensureYearSchema(pool);

      const query = `
        INSERT INTO "year" (
          year_label, year_label_ad, year_label_bs,
          start_date_ad, end_date_ad, start_date_bs, end_date_bs,
          start_date, end_date, is_current
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (year_label)
        DO UPDATE SET
          year_label_ad = EXCLUDED.year_label_ad,
          year_label_bs = EXCLUDED.year_label_bs,
          start_date_ad = EXCLUDED.start_date_ad,
          end_date_ad   = EXCLUDED.end_date_ad,
          start_date_bs = EXCLUDED.start_date_bs,
          end_date_bs   = EXCLUDED.end_date_bs,
          start_date    = EXCLUDED.start_date,
          end_date      = EXCLUDED.end_date,
          is_current    = EXCLUDED.is_current,
          updated_at    = CURRENT_TIMESTAMP
        RETURNING *
      `;

      const values = [
        yearData.year_label,
        yearData.year_label_AD,
        yearData.year_label_BS,
        yearData.start_date_AD,
        yearData.end_date_AD,
        yearData.start_date_BS,
        yearData.end_date_BS,
        yearData.start_date_AD || yearData.start_date,
        yearData.end_date_AD   || yearData.end_date,
        yearData.is_current || false,
      ];

      const result = await pool.query(query, values);
      const year = result.rows[0];

      if (year && year.is_current) {
        // Inline the set_current_year logic — do NOT call the stored function
        // because it may not exist on tenants where migrations have not run yet.
        await pool.query(
          'UPDATE "year" SET is_current = false WHERE id <> $1',
          [year.id],
        );
        await pool.query(
          'UPDATE "year" SET is_current = true WHERE id = $1',
          [year.id],
        );
        const refreshed = await pool.query(
          'SELECT * FROM "year" WHERE id = $1',
          [year.id],
        );
        return refreshed.rows[0];
      }

      return year;
    } catch (err) {
      throw new Error(`Failed to upload year: ${err.message}`);
    }
  };

  /**
   * Get all years
   */
  getAllYears = async (req) => {
    try {
      const pool = req?.tenantPool || require("../config/db");
      await this._ensureYearSchema(pool);
      const query = 'SELECT * FROM "year" ORDER BY start_date DESC';
      const result = await pool.query(query);
      return result.rows;
    } catch (err) {
      throw new Error(`Failed to fetch years: ${err.message}`);
    }
  };

  /**
   * Get year by ID
   */
  getYearById = async (yearId, req) => {
    try {
      const pool = req?.tenantPool || require("../config/db");
      const query = 'SELECT * FROM "year" WHERE id = $1';
      const result = await pool.query(query, [yearId]);
      return result.rows[0] || null;
    } catch (err) {
      throw new Error(`Failed to fetch year: ${err.message}`);
    }
  };

  /**
   * Get year by label
   */
  getYearByLabel = async (yearLabel, req) => {
    try {
      const pool = req?.tenantPool || require("../config/db");
      const query = 'SELECT * FROM "year" WHERE year_label = $1';
      const result = await pool.query(query, [yearLabel]);
      return result.rows[0] || null;
    } catch (err) {
      throw new Error(`Failed to fetch year: ${err.message}`);
    }
  };

  /**
   * Delete year by ID
   */
  deleteYear = async (yearId, req) => {
    try {
      const pool = req?.tenantPool || require("../config/db");
      const query = 'DELETE FROM "year" WHERE id = $1 RETURNING *';
      const result = await pool.query(query, [yearId]);
      return result.rows[0] || null;
    } catch (err) {
      throw new Error(`Failed to delete year: ${err.message}`);
    }
  };
  /**
   * Seed complete Nepali year with all 12 months and correct AD/BS date mappings
   * This creates the full academic year structure automatically
   */
  seedNepaliYear = async (bsYear, setAsCurrent, req) => {
    try {
      const pool = req?.tenantPool || require("../config/db");
      await this._ensureYearSchema(pool);

      // Use dynamic BS calendar reference (supports 2082-2120)
      const { getBsMonthInfo } = require("./bsCalendar.service");
      
      // Validate BS year is in supported range
      const availableYears = this.getAvailableBsYears();
      if (!availableYears.includes(bsYear)) {
        throw new Error(`BS year ${bsYear} is not supported. Available: 2082-2120`);
      }
      
      // Get year start date from first month (Baisakh)
      const firstMonth = getBsMonthInfo(bsYear, 1);
      const yearStartAD = new Date(firstMonth.adStartDate);

      const BS_MONTHS = [
        'Baisakh','Jestha','Ashadh','Shrawan','Bhadra','Ashwin',
        'Kartik','Mangsir','Poush','Magh','Falgun','Chaitra',
      ];



      const client = await pool.connect();
      
      try {
        await client.query('BEGIN');
        
        // Calculate AD year range (BS year spans 2 AD years)
        const adStartYear = bsYear - 57;  // Approximate AD year for start
        const adEndYear = adStartYear + 1;
        
        // Create year labels
        const yearLabel = bsYear.toString();
        const yearLabelBS = `${bsYear}/${(bsYear + 1).toString().slice(-2)}`;
        const yearLabelAD = `${adStartYear}/${adEndYear.toString().slice(-2)}`;
        
        // Calculate year start and end dates from calendar service
        // Year end is the last day of the 12th month
        let yearEndAD = new Date(yearStartAD);
        for (let m = 1; m <= 12; m++) {
          const monthInfo = getBsMonthInfo(bsYear, m);
          const monthEnd = new Date(monthInfo.adStartDate);
          monthEnd.setDate(monthEnd.getDate() + monthInfo.daysInMonth - 1);
          if (m === 12) {
            yearEndAD = monthEnd;
          }
        }
        
        const formatDate = (date) => date.toISOString().slice(0, 10);
        const startDateStr = formatDate(yearStartAD);
        const endDateStr = formatDate(yearEndAD);
        
        // Insert/Update year
        const yearQuery = `
          INSERT INTO "year" (
            year_label, year_label_ad, year_label_bs,
            start_date_ad, end_date_ad, start_date_bs, end_date_bs,
            start_date, end_date, is_current
          )
          VALUES (}

const yearService, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (year_label)
          DO UPDATE SET
            year_label_ad = EXCLUDED.year_label_ad,
            year_label_bs = EXCLUDED.year_label_bs,
            start_date_ad = EXCLUDED.start_date_ad,
            end_date_ad   = EXCLUDED.end_date_ad,
            start_date_bs = EXCLUDED.start_date_bs,
            end_date_bs   = EXCLUDED.end_date_bs,
            start_date    = EXCLUDED.start_date,
            end_date      = EXCLUDED.end_date,
            is_current    = EXCLUDED.is_current,
            updated_at    = CURRENT_TIMESTAMP
          RETURNING *
        `;
        
        const yearValues = [
          yearLabel, yearLabelAD, yearLabelBS,
          startDateStr, endDateStr, 
          `1 ${BS_MONTHS[0]} ${bsYear}`, `30 ${BS_MONTHS[11]} ${bsYear}`,
          startDateStr, endDateStr, setAsCurrent
        ];
        
        const yearResult = await client.query(yearQuery, yearValues);
        const createdYear = yearResult.rows[0];
        
        // Set as current year if requested
        if (setAsCurrent) {
          await client.query('UPDATE "year" SET is_current = false WHERE id <> $1', [createdYear.id]);
          await client.query('UPDATE "year" SET is_current = true WHERE id = $1', [createdYear.id]);
        }
        
        // Create months table if not exists
        await client.query(`
          CREATE TABLE IF NOT EXISTS "month_class_data" (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            year_id UUID REFERENCES "year"(id) ON DELETE CASCADE,
            month_name VARCHAR(100) NOT NULL,
            bs_month_index INTEGER,
            month_start_date_BS VARCHAR(255),
            month_end_date_BS VARCHAR(255),
            month_start_date_AD DATE,
            month_end_date_AD DATE,
            month_start_day_BS INTEGER,
            month_end_day_BS INTEGER,
            month_start_day_AD INTEGER,
            month_end_day_AD INTEGER,
            date_format VARCHAR(10) DEFAULT 'BS',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
        
        // Delete existing months for this year to avoid duplicates
        await client.query('DELETE FROM "month_class_data" WHERE year_id = $1', [createdYear.id]);


        
        // Calculate and insert all 12 months using dynamic calendar data
        const createdMonths = [];
        
        for (let monthIndex = 0; monthIndex < 12; monthIndex++) {
          const monthName = BS_MONTHS[monthIndex];
          const monthInfo = getBsMonthInfo(bsYear, monthIndex + 1);
          const daysInMonth = monthInfo.daysInMonth;
          
          // Calculate month start and end dates from calendar service
          const monthStart = new Date(monthInfo.adStartDate);
          const monthEnd = new Date(monthStart.getTime() + (daysInMonth - 1) * 24 * 60 * 60 * 1000);
          
          const monthQuery = `
            INSERT INTO "month_class_data" (
              year_id, month_name, bs_month_index,
              month_start_date_BS, month_end_date_BS,
              month_start_date_AD, month_end_date_AD,
              month_start_day_BS, month_end_day_BS,
              month_start_day_AD, month_end_day_AD,
              date_format
            ) VALUES (}

const yearService, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING *
          `;
          
          const monthValues = [
            createdYear.id,
            monthName,
            monthIndex + 1,
            `1 ${monthName} ${bsYear}`,
            `${daysInMonth} ${monthName} ${bsYear}`,
            formatDate(monthStart),
            formatDate(monthEnd),
            1,
            daysInMonth,
            monthStart.getDate(),
            monthEnd.getDate(),
            'BS'
          ];
          
          const monthResult = await client.query(monthQuery, monthValues);
          createdMonths.push(monthResult.rows[0]);

        }
        
        await client.query('COMMIT');
        
        return {
          year: createdYear,
          months: createdMonths,
          summary: {
            bsYear,
            adYearRange: `${adStartYear}-${adEndYear}`,
            monthsCreated: createdMonths.length,
            dateRange: `${startDateStr} to ${endDateStr}`,
            isCurrentYear: setAsCurrent
          }
        };
        
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      
    } catch (err) {
      throw new Error(`Failed to seed Nepali year ${bsYear}: ${err.message}`);
    }
  };
}

const yearService = new YearService();
module.exports = yearService;
