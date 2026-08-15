/* Money + date/time formatting, all timezone-aware (trip.timezone is authoritative). */

const CURRENCY_SYMBOLS = { JPY: '¥', USD: '$', EUR: '€', GBP: '£', CNY: '¥', TWD: 'NT$', KRW: '₩', HKD: 'HK$', AUD: 'A$', CAD: 'C$' };

function currencySymbol(code) {
  return CURRENCY_SYMBOLS[code] || (code ? code + ' ' : '¥');
}

function fmtMoney(n, currency) {
  const sym = currencySymbol(currency);
  const v = Math.round(Math.abs(n || 0)).toLocaleString('en-US');
  return sym + v;
}

function fmtSigned(n, currency) {
  const neg = n < 0;
  return (neg ? '−' : '+') + fmtMoney(Math.abs(n), currency);
}

/** Wrap a formatted "¥1,234" / "−¥1,234" string's currency symbol in a span
    for smaller, spaced-out display. Safe to apply anywhere in the UI —
    never applied to values headed for CSV/plain-text export. */
function styleCcy(str) {
  return str.replace(/(NT\$|HK\$|A\$|C\$|[¥$€£₩])/, '<span class="ccy-sym">$1</span>');
}
function fmtMoneyBig(n, currency) { return styleCcy(fmtMoney(n, currency)); }
function fmtSignedBig(n, currency) { return styleCcy(fmtSigned(n, currency)); }

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/** Offset (minutes) of an IANA timeZone at a given instant, handles DST. */
function tzOffsetMinutes(date, timeZone) {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const parts = {};
    dtf.formatToParts(date).forEach(p => { parts[p.type] = p.value; });
    const asUTC = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second)
    );
    return (asUTC - date.getTime()) / 60000;
  } catch (e) { return 0; }
}

/** Build a UTC ISO instant from wall-clock date/time strings interpreted in timeZone. */
function zonedToUtcIso(dateStr, timeStr, timeZone) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = (timeStr || '00:00').split(':').map(Number);
  let guess = Date.UTC(y, m - 1, d, hh, mm, 0);
  const offset = tzOffsetMinutes(new Date(guess), timeZone);
  return new Date(guess - offset * 60000).toISOString();
}

/** Split a UTC ISO instant into {date, time} strings as seen in timeZone. */
function utcIsoToZonedParts(iso, timeZone) {
  const date = new Date(iso);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  });
  const parts = {};
  dtf.formatToParts(date).forEach(p => { parts[p.type] = p.value; });
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function nowZonedParts(timeZone) {
  return utcIsoToZonedParts(new Date().toISOString(), timeZone);
}

function dayLabel(iso, timeZone) {
  const { date } = utcIsoToZonedParts(iso, timeZone);
  const [y, m, d] = date.split('-').map(Number);
  return MONTH_ABBR[m - 1] + ' ' + d;
}

function fullDateLabel(iso, timeZone) {
  const { date } = utcIsoToZonedParts(iso, timeZone);
  const [y, m, d] = date.split('-').map(Number);
  return MONTH_ABBR[m - 1] + ' ' + d + ', ' + y;
}

function daysBetween(aIso, bIso) {
  const a = new Date(aIso + 'T00:00:00Z').getTime();
  const b = new Date(bIso + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86400000);
}

function daysLeft(endDate, timeZone) {
  const today = nowZonedParts(timeZone).date;
  const d = daysBetween(today, endDate);
  return d;
}

function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
