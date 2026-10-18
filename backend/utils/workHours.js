/**
 * Working hours are typed (or auto-filled) as free text, so adding them up needs ONE shared rule.
 * It understands what the entry form writes and what people type by hand:
 *      "8 hrs"   "8 hrs 30 mins"   "6.8"   "6.8 hrs"   "8h 30m"   "45 mins"   "8:30"
 * and refuses anything that is not a length of time:
 *      "130 km" (a distance)   "No work"   ""   "50"  (more than a day has hours)
 * The answer is in whole MINUTES, so sums never suffer from decimal rounding noise (6.8 + 8.1 is exactly 14.9 hours).
 */
const DAY = 24 * 60;
const H = '(?:h|hr|hrs|hour|hours)';
const M = '(?:m|min|mins|minute|minutes)';
const RE_DECIMAL = new RegExp(`^(\\d+(?:\\.\\d+)?)\\s*${H}?$`, 'i');                 // 6.8   6.8 hrs   8 hrs
const RE_HM = new RegExp(`^(\\d+)\\s*${H}\\s*(\\d+)\\s*${M}$`, 'i');                  // 8 hrs 30 mins   8h 30m
const RE_MIN = new RegExp(`^(\\d+)\\s*${M}$`, 'i');                                   // 45 mins
const RE_CLOCK = /^(\d{1,2}):([0-5]\d)$/;                                             // 8:30

function parseWorkingMinutes(text) {
  const s = String(text == null ? '' : text).trim();
  if (!s) return null;
  let min = null, m;
  if ((m = RE_DECIMAL.exec(s))) min = Math.round(parseFloat(m[1]) * 60);
  else if ((m = RE_HM.exec(s))) min = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  else if ((m = RE_MIN.exec(s))) min = parseInt(m[1], 10);
  else if ((m = RE_CLOCK.exec(s))) min = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  return min !== null && Number.isFinite(min) && min <= DAY ? min : null;               // more than a day: not a day's working time
}

/** 894 minutes → 14.9 hours (two decimals at most). */
const hoursFromMinutes = min => Math.round((min / 60) * 100) / 100;

module.exports = { parseWorkingMinutes, hoursFromMinutes, DAY };
