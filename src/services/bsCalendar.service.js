// Keep this table aligned with frontend/src/utils/bsCalendar.js. Calendar days
// and sidebar rendering must derive weekday positions from the same data.
const BS_MONTH_LENGTHS = {
  2079: [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2080: [31, 31, 32, 32, 31, 30, 30, 30, 29, 29, 30, 30],
  2081: [31, 31, 32, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2082: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30],
  2083: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2084: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2085: [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2086: [31, 31, 32, 31, 31, 30, 30, 29, 30, 30, 29, 31],
};

const BS_YEAR_START_AD = {
  2079: '2022-04-14',
  2080: '2023-04-14',
  2081: '2024-04-13',
  2082: '2025-04-14',
  2083: '2026-04-14',
  2084: '2027-04-14',
  2085: '2028-04-13',
  2086: '2029-04-14',
};

const generateBsCalendarReference = () => {
  const reference = {};
  for (let year = 2082; year <= 2120; year++) {
    reference[year] = {};
    const lengths = BS_MONTH_LENGTHS[year] || BS_MONTH_LENGTHS[2086];
    const currentADDate = BS_YEAR_START_AD[year]
      ? new Date(`${BS_YEAR_START_AD[year]}T00:00:00Z`)
      : new Date(reference[year - 1][12].adEndDate);
    if (!BS_YEAR_START_AD[year]) {
      currentADDate.setUTCDate(currentADDate.getUTCDate() + 1);
    }

    for (let month = 1; month <= 12; month++) {
      const daysInMonth = lengths[month - 1];
      const adStartDate = new Date(currentADDate);
      const adEndDate = new Date(adStartDate);
      adEndDate.setUTCDate(adEndDate.getUTCDate() + daysInMonth - 1);

      reference[year][month] = {
        daysInMonth,
        adStartDate: adStartDate.toISOString().split('T')[0],
        adEndDate: adEndDate.toISOString().split('T')[0],
      };
      currentADDate.setUTCDate(currentADDate.getUTCDate() + daysInMonth);
    }
  }
  
  return reference;
};

const BS_CALENDAR_REFERENCE = generateBsCalendarReference();

const getBsMonthInfo = (bsYear, bsMonth) => {
  const year = BS_CALENDAR_REFERENCE[bsYear];
  if (!year) throw new Error(`BS year ${bsYear} not in reference`);
  const month = year[bsMonth];
  if (!month) throw new Error(`BS month ${bsMonth} not found for year ${bsYear}`);
  
  return {
    bsYear,
    bsMonth,
    daysInMonth: month.daysInMonth,
    adStartDate: month.adStartDate,
  };
};

const getAvailableBsYears = () => {
  return Object.keys(BS_CALENDAR_REFERENCE).map(Number).sort();
};

module.exports = {
  BS_CALENDAR_REFERENCE,
  getBsMonthInfo,
  getAvailableBsYears,
};