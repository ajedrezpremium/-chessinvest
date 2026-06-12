const https = require('https');
const logger = require('./logger');
const { cache } = require('./cache');

const CACHE_TTL_MS = 10 * 60 * 1000;
const FF_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

const IMPACT_ICON = { 'High': '🔴', 'Medium': '🟡', 'Low': '🟢' };

async function fetchEconomicCalendar() {
  const cached = cache.get('economic_calendar');
  if (cached) return cached;

  try {
    const events = await fetchForexFactory();
    const filtered = events
      .filter(e => e.impact === 'High' || e.impact === 'Medium')
      .slice(0, 20);

    const result = {
      events: filtered,
      highImpact: filtered.filter(e => e.impact === 'High'),
      count: filtered.length,
      fetchedAt: new Date().toISOString(),
    };

    cache.set('economic_calendar', result, CACHE_TTL_MS);
    return result;
  } catch (err) {
    logger.warn(`Economic calendar fetch failed: ${err.message}. Using generated schedule.`);
    const generated = generateEconomicSchedule();
    cache.set('economic_calendar', generated, CACHE_TTL_MS);
    return generated;
  }
}

function fetchForexFactory() {
  return new Promise((resolve, reject) => {
    https.get(FF_URL, { timeout: 8000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.map(e => ({
            title: e.title,
            country: e.country,
            date: e.date,
            impact: e.impact,
            forecast: e.forecast || '—',
            previous: e.previous || '—',
          })));
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}`));
        }
      });
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('Timeout')); });
  });
}

function generateEconomicSchedule() {
  const now = new Date();
  const day = now.getDate();
  const month = now.getMonth();
  const year = now.getFullYear();

  const events = [
    { title: 'Fed Interest Rate Decision', country: 'US', impact: 'High', relativeDate: getNextFedDate(now) },
    { title: 'FOMC Meeting Minutes', country: 'US', impact: 'High', relativeDate: getNextFedMinutesDate(now) },
    { title: 'Non-Farm Payrolls (NFP)', country: 'US', impact: 'High', relativeDate: getNextWeekday(now, 5, 1) },
    { title: 'CPI m/m', country: 'US', impact: 'High', relativeDate: getNextWeekday(now, 3, 2) },
    { title: 'ECB Interest Rate Decision', country: 'EU', impact: 'High', relativeDate: getNextWeekday(now, 4, 2) },
    { title: 'BOE Interest Rate Decision', country: 'UK', impact: 'High', relativeDate: getNextWeekday(now, 4, 3) },
    { title: 'Initial Jobless Claims', country: 'US', impact: 'Medium', relativeDate: getNextWeekday(now, 4, 0) },
    { title: 'GDP q/q', country: 'US', impact: 'High', relativeDate: getNextQuarterlyGDP(now) },
    { title: 'Retail Sales m/m', country: 'US', impact: 'Medium', relativeDate: getNextWeekday(now, 3, 3) },
    { title: 'Industrial Production m/m', country: 'US', impact: 'Medium', relativeDate: getNextWeekday(now, 3, 2) },
  ];

  const formatted = events.filter(e => e.relativeDate).map(e => ({
    title: e.title,
    country: e.country,
    impact: e.impact,
    date: e.relativeDate.toISOString(),
    forecast: '—',
    previous: '—',
  }));

  return {
    events: formatted,
    highImpact: formatted.filter(e => e.impact === 'High'),
    count: formatted.length,
    fetchedAt: now.toISOString(),
  };
}

function getNextWeekday(now, targetDay, occurrence) {
  const d = new Date(now);
  d.setDate(d.getDate() + ((targetDay + 7 - d.getDay()) % 7) + (occurrence - 1) * 7);
  if (d <= now) d.setDate(d.getDate() + 7);
  d.setHours(13, 30, 0, 0);
  return d;
}

function getNextFedDate(now) {
  const meetings = [
    { month: 0, weeks: [4] }, { month: 2, weeks: [3] }, { month: 4, weeks: [1] },
    { month: 5, weeks: [3] }, { month: 6, weeks: [4] }, { month: 8, weeks: [2] },
    { month: 10, weeks: [1] }, { month: 11, weeks: [3] },
  ];
  const year = now.getFullYear();
  for (const m of meetings) {
    const d = new Date(year, m.month, 1);
    const wed = getNthWeekday(d, m.weeks[0], 3);
    wed.setHours(14, 0, 0, 0);
    if (wed > now) return wed;
  }
  return new Date(year + 1, 0, 29, 14, 0);
}

function getNthWeekday(date, n, dayOfWeek) {
  const d = new Date(date);
  const firstDay = d.getDay();
  const diff = (dayOfWeek - firstDay + 7) % 7;
  d.setDate(d.getDate() + diff + (n - 1) * 7);
  return d;
}

function getNextFedMinutesDate(now) {
  const fed = getNextFedDate(now);
  const minutes = new Date(fed);
  minutes.setDate(minutes.getDate() + 21);
  if (minutes <= now) {
    const nextFed = new Date(fed);
    nextFed.setMonth(nextFed.getMonth() + 6);
    minutes.setTime(nextFed.getTime() + 21 * 86400000);
  }
  return minutes;
}

function getNextQuarterlyGDP(now) {
  const quarters = [3, 6, 9, 12];
  for (const q of quarters) {
    const d = new Date(now.getFullYear(), q - 1, 25);
    d.setHours(13, 30, 0, 0);
    if (d > now) return d;
  }
  return new Date(now.getFullYear() + 1, 2, 25, 13, 30);
}

function formatCalendarContext(calendar) {
  if (!calendar?.events?.length) return '';

  const now = new Date();
  let text = '📅 CALENDARIO ECONÓMICO PRÓXIMOS EVENTOS:\n';

  for (const e of calendar.events) {
    const eventDate = new Date(e.date);
    const daysUntil = Math.round((eventDate - now) / 86400000);
    const icon = IMPACT_ICON[e.impact] || '⚪';
    const when = daysUntil <= 0 ? '🔴 HOY' : daysUntil === 1 ? '⚠️ MAÑANA' : `📆 ${daysUntil}d`;
    const flag = e.country === 'US' ? '🇺🇸' : e.country === 'EU' ? '🇪🇺' : e.country === 'UK' ? '🇬🇧' : '🌍';
    text += `${icon} ${when} ${flag} ${e.title}`;
    if (e.forecast !== '—') text += ` (Prev: ${e.forecast})`;
    if (e.previous !== '—') text += ` (Ant: ${e.previous})`;
    text += '\n';
  }

  return text;
}

module.exports = { fetchEconomicCalendar, formatCalendarContext, generateEconomicSchedule };