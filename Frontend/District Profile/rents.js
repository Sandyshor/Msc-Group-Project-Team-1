// The one rent figure for each district and room type, shown everywhere on the site: the district profile,
// Compare districts, the results page and the AI assistant. The backend works it out the same way
// (Backend/district_rent.py), so keep the two in step.
//
// For each size: the district's own Daft listings (median) first, then the RTB 2025 average (whole homes),
// then the Daft.ie Rental Report 2026 Q1 average for its part of Dublin.

export const RENT_KINDS = [
  // kind, label, what it is
  ['single', 'Single room', 'one person'],
  ['double', 'Double room', 'one person'],
  ['sharing', 'Double sharing', 'per person · twin room'],
  ['studio', 'Studio', ''],
  ['1 bed', '1 bed', ''],
  ['2 bed', '2 bed', ''],
  ['3 bed', '3 bed', ''],
  ['4+ bed', '4+ bed', ''],
];
export const ROOM_KINDS = ['single', 'double', 'sharing'];
export const HOME_KINDS = ['studio', '1 bed', '2 bed', '3 bed', '4+ bed'];

const REPORT_KEY = { single: 'single', double: 'double', sharing: 'sharing', '1 bed': 'oneBed', '2 bed': 'twoBed' };

// { value, note, source: 'listings' | 'rtb' | 'report', listing? } or null when there's no figure
export function rentFor(data, code, kind) {
  const r = data?.rent?.[code] || {};
  const listing = ROOM_KINDS.includes(kind) ? r.rooms?.[kind] : r.homes?.[kind];
  if (listing?.median) {
    return { value: listing.median, source: 'listings', listing,
      note: `median of ${listing.n} listing${listing.n > 1 ? 's' : ''}` };
  }
  const rtb = data?.rtb?.[code]?.district?.[kind];
  if (rtb && HOME_KINDS.includes(kind)) return { value: rtb, source: 'rtb', note: 'RTB 2025 average' };
  const report = data?.roomReport?.areas?.[code]?.[REPORT_KEY[kind]];
  if (report) {
    return { value: report, source: 'report', note: kind === 'sharing' ? 'Daft.ie report · estimate' : 'Daft.ie report 2026 Q1' };
  }
  return null;
}
