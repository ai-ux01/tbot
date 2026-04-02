/**
 * NSE session calendar in Asia/Kolkata (IST). Kite historical `from`/`to` use yyyy-mm-dd hh:mm:ss
 * in exchange-local sense; using IST calendar dates avoids wrong "today" when the server runs in UTC.
 */

/**
 * @param {Date} d
 * @returns {string} YYYY-MM-DD in Asia/Kolkata for this instant
 */
export function toDateStrIST(d) {
  if (!d || !(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

/**
 * Start of the IST calendar day containing `anchor` (instant at 00:00:00 IST).
 * @param {Date} anchor
 * @returns {Date}
 */
export function istStartOfCalendarDay(anchor) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(anchor);
  const y = parts.find((p) => p.type === 'year').value;
  const m = parts.find((p) => p.type === 'month').value;
  const day = parts.find((p) => p.type === 'day').value;
  return new Date(`${y}-${m}-${day}T00:00:00+05:30`);
}
