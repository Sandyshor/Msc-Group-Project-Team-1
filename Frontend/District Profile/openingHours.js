// Reads OpenStreetMap opening hours ("Mo-Fr 09:00-18:00; Sa 10:00-17:00; Su off") into a week, and says whether a
// place is open now (Dublin time) and when that changes, like Google Maps. Handles day ranges and lists, several
// time ranges a day, times past midnight, "off"/"closed", "24/7" and public-holiday rules (left out). Anything it
// can't read with certainty (months, sunrise, week numbers...) returns null, and the panel shows the text as written.

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const CODES = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const toMin = (t) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
export const hhmm = (min) => {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

function parseDays(text) {
  const days = new Set();
  for (const part of text.split(',')) {
    const p = part.trim();
    const range = /^(Mo|Tu|We|Th|Fr|Sa|Su)\s*-\s*(Mo|Tu|We|Th|Fr|Sa|Su)$/.exec(p);
    if (range) {
      let i = CODES.indexOf(range[1]);
      const end = CODES.indexOf(range[2]);
      for (;;) { days.add(i); if (i === end) break; i = (i + 1) % 7; }
    } else if (CODES.includes(p)) days.add(CODES.indexOf(p));
    else return null;
  }
  return days;
}

function parseTimes(text) {
  const out = [];
  for (const part of text.split(',')) {
    const m = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\+?$/.exec(part.trim());
    if (!m) return null;
    const start = toMin(m[1]);
    let end = toMin(m[2]);
    if (start == null || end == null) return null;
    if (end <= start) end += 1440; // past midnight (22:00-02:00), or 00:00-24:00
    out.push([start, end]);
  }
  return out;
}

/** [[ranges for Monday], ..., [ranges for Sunday]] (minutes from midnight), or null if the text can't be read. */
export function parseOpeningHours(text) {
  const value = String(text || '').trim();
  if (!value) return null;
  if (value === '24/7') return Array.from({ length: 7 }, () => [[0, 1440]]);
  const week = Array.from({ length: 7 }, () => []);
  let any = false;
  for (const raw of value.split(';')) {
    let rule = raw.trim().replace(/"[^"]*"/g, '').trim(); // comments in quotes
    if (!rule) continue;
    if (/^PH\b/.test(rule) || /^SH\b/.test(rule)) continue; // public / school holidays: left out
    rule = rule.replace(/,\s*PH\b/, '').replace(/\bPH\s*,\s*/, '');
    const m = /^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*-\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))?\s*,?\s*)+)?\s*(.*)$/.exec(rule);
    if (!m) return null;
    const days = m[1] ? parseDays(m[1].trim().replace(/,$/, '')) : new Set([0, 1, 2, 3, 4, 5, 6]);
    if (!days) return null;
    const rest = m[2].trim();
    let times;
    if (/^(off|closed)$/i.test(rest)) times = [];
    else if (rest === '' && m[1]) times = [[0, 1440]]; // "Mo-Su" alone: open all day
    else if (/^24\/7$/.test(rest)) times = [[0, 1440]];
    else times = parseTimes(rest);
    if (!times) return null;
    days.forEach((d) => { week[d] = times; }); // a later rule replaces an earlier one for its days
    any = true;
  }
  return any ? week : null;
}

// Day of the week (0 = Monday) and minutes since midnight, in Dublin
function dublinNow(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Dublin', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map((p) => [p.type, p.value]));
  const day = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday);
  return { day, min: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** { open, text } e.g. { open: true, text: 'Open · closes 18:00' }, or null when the hours can't be read. */
export function openStatus(week, now) {
  if (!week) return null;
  const { day, min } = dublinNow(now);
  if (week.every((d) => d.length === 1 && d[0][0] === 0 && d[0][1] >= 1440)) return { open: true, text: 'Open 24 hours' };
  // open now? (today's ranges, or last night's range that runs past midnight)
  const yesterday = (day + 6) % 7;
  const current = week[day].find(([s, e]) => min >= s && min < e) || week[yesterday].find(([, e]) => e > 1440 && min < e - 1440);
  if (current) {
    const today = week[day].includes(current);
    const closesAt = today ? current[1] : current[1] - 1440;
    if (today && closesAt >= 1440 && week[(day + 1) % 7].some(([s]) => s === 0)) return { open: true, text: 'Open · past midnight' };
    return { open: true, text: `Open · closes ${hhmm(closesAt)}`, closingSoon: closesAt - (today ? min : min) <= 60 };
  }
  // when does it open next?
  for (let i = 0; i < 8; i += 1) {
    const d = (day + i) % 7;
    const next = week[d].filter(([s]) => i > 0 || s > min).sort((a, b) => a[0] - b[0])[0];
    if (next) return { open: false, text: `Closed · opens ${hhmm(next[0])}${i === 0 ? '' : i === 1 ? ' tomorrow' : ` ${DAYS[d]}`}` };
  }
  return { open: false, text: 'Closed' };
}

/** "09:00–18:00, 19:00–22:00", "Open 24 hours" or "Closed" for one day of a week from parseOpeningHours. */
export function dayText(ranges) {
  if (!ranges.length) return 'Closed';
  if (ranges.length === 1 && ranges[0][0] === 0 && ranges[0][1] >= 1440) return 'Open 24 hours';
  return ranges.map(([s, e]) => `${hhmm(s)}–${hhmm(e)}`).join(', ');
}

export const todayIndex = (now) => dublinNow(now).day;

/** The raw text made easier to read when it can't be parsed: "Mo-Fr" -> "Monday–Friday", "sunrise-sunset" -> ... */
export function readableHours(text) {
  const names = Object.fromEntries(CODES.map((c, i) => [c, DAYS[i]]));
  return String(text || '')
    .replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su)\b/g, (c) => names[c])
    .replace(/\bPH\b/g, 'public holidays').replace(/\boff\b/g, 'closed')
    .replace(/sunrise/g, 'sunrise').replace(/sunset/g, 'sunset').replace(/dawn/g, 'dawn').replace(/dusk/g, 'dusk')
    .replace(/\s*;\s*/g, '; ').replace(/(\d)-(\d)/g, '$1–$2');
}
