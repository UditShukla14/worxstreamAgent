/**
 * Date/Time Context — provides current date and time for agent prompts.
 *
 * Agents need this to correctly resolve relative date phrases like
 * "last month", "this week", "last quarter" when filtering invoices,
 * estimates, bills, etc.
 */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Returns a short context string with current date and time (UTC).
 * Injected into agent prompts so they can resolve relative dates correctly.
 *
 * @returns {string} e.g. "Current date: Tuesday, March 17, 2025 (2025-03-17). Current time: 14:30 UTC."
 */
export function getCurrentDateTimeContext(timeZone = '') {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const h = now.getUTCHours();
  const min = now.getUTCMinutes();

  const dateStr = `${WEEKDAYS[now.getUTCDay()]}, ${MONTHS[m]} ${d}, ${y}`;
  const isoDate = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const timeStr = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;

  if (timeZone) {
    const local = new Intl.DateTimeFormat('en-US', {
      timeZone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(now);
    return `Current date and time in the user's timezone (${timeZone}): ${local}. UTC now: ${isoDate} ${timeStr}. The user's timezone is ${timeZone}: interpret every time they state (e.g. "7pm") and every relative date in it, and never ask them for a timezone or quote times in UTC. Use this to resolve relative dates like "last month", "this week", "last quarter", or any date range the user specifies.`;
  }
  return `Current date: ${dateStr} (${isoDate}). Current time: ${timeStr} UTC. Use this to resolve relative dates like "last month", "this week", "last quarter", or any date range the user specifies.`;
}
