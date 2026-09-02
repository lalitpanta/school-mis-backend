const BS_CALENDAR_REFERENCE = {
  2082: {
    1: { daysInMonth: 30, adStartDate: "2025-04-14" },
    2: { daysInMonth: 32, adStartDate: "2025-05-14" },
    3: { daysInMonth: 31, adStartDate: "2025-06-15" },
    4: { daysInMonth: 32, adStartDate: "2025-07-16" },
    5: { daysInMonth: 31, adStartDate: "2025-08-17" },
    6: { daysInMonth: 30, adStartDate: "2025-09-17" },
    7: { daysInMonth: 30, adStartDate: "2025-10-17" },
    8: { daysInMonth: 30, adStartDate: "2025-11-16" },
    9: { daysInMonth: 29, adStartDate: "2025-12-16" },
    10: { daysInMonth: 30, adStartDate: "2026-01-14" },
    11: { daysInMonth: 30, adStartDate: "2026-02-13" },
    12: { daysInMonth: 30, adStartDate: "2026-03-15" },
  },
};

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