// Generate BS calendar reference for 2082-2120
// Deterministic pattern: Month 1-5: mixed 30-32 days, Month 6-9: 29-30 days, Month 10-12: 30 days
// Sequential AD dates calculated from base epoch
const BS_EPOCH_AD = new Date(2025, 3, 14); // BS 2082 Baisakh 1 = AD 2025-04-14

const generateBsCalendarReference = () => {
  const reference = {};
  const monthPattern = [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30]; // Deterministic days per month
  
  let currentADDate = new Date(BS_EPOCH_AD);
  
  for (let year = 2082; year <= 2120; year++) {
    reference[year] = {};
    
    for (let month = 1; month <= 12; month++) {
      const daysInMonth = monthPattern[month - 1];
      const adStartDate = new Date(currentADDate);
      
      // Format AD date as YYYY-MM-DD
      const adStartDateStr = adStartDate.toISOString().split('T')[0];
      
      reference[year][month] = {
        daysInMonth,
        adStartDate: adStartDateStr,
      };
      
      // Move to next month's start date
      currentADDate = new Date(adStartDate.getTime() + daysInMonth * 24 * 60 * 60 * 1000);
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