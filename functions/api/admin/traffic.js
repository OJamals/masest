// GET /api/admin/traffic?days=14 - first-party traffic aggregates page_views. Staff-only.
import { adminClient, requireStaff, json } from '../../_lib/supabase.js';
import { cached } from '../../_lib/cache.js';
import { loadTrafficWindow, trafficMetrics } from '../../_lib/traffic-metrics.js';

// Aggregates up to 10k page_views rows in JS per load; the result is org-wide, so
// cache it briefly per `days` window (no-op until RATE_KV is bound). Staff auth runs
// BEFORE the cache lookup.
const TRAFFIC_TTL_SEC = 60;

const FUNNEL = [
  ['pageview', 'Page views'],
  ['quote_submit', 'Quote submission events'],
  ['checkout_start', 'Checkout starts'],
  ['order_confirmed', 'Paid confirmation views'],
];
const CONVERSION_EVENTS = new Set(FUNNEL.slice(1).map(([event]) => event));
const SEARCH_SOURCES = new Map([
  ['google.com', 'google'], ['bing.com', 'bing'],
  ['duckduckgo.com', 'duckduckgo'], ['search.yahoo.com', 'yahoo'],
]);

function rate(count, total) {
  return total ? Number((count / total).toFixed(4)) : 0;
}

function tally(arr, key, transform) {
  const m = Object.create(null);
  for (const row of arr) {
    const value = transform ? transform(row[key], row) : row[key];
    const k = value || '-';
    m[k] = (m[k] || 0) + 1;
  }
  return Object.entries(m)
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ key, count }));
}

function refHost(value) {
  if (!value) return 'direct';
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return 'other';
  }
}

function campaignKey(_, row) {
  const host = refHost(row.referrer);
  const search = SEARCH_SOURCES.get(host);
  const internal = host === 'masest.co' || host.endsWith('.masest.co');
  const source = row.utm_source || search || (internal ? 'unattributed internal' : host === 'direct' ? 'direct or unknown' : host);
  const medium = row.utm_medium || (row.utm_source ? 'unspecified' : search ? 'organic' : internal || host === 'direct' ? 'unknown' : 'referral');
  const campaign = row.utm_campaign || 'uncategorized';
  return `${source} / ${medium} / ${campaign}`;
}

export async function onRequestGet({ request, env }) {
  const { user, staff } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });

  const days = Math.min(90, Math.max(1, parseInt(new URL(request.url).searchParams.get('days') || '14', 10) || 14));
  const sb = adminClient(env);
  const payload = await cached(env, `cache:admin:traffic:v2:d=${days}`, TRAFFIC_TTL_SEC, () => computeTraffic(sb, days));
  return json(200, payload);
}

async function computeTraffic(sb, days) {
  const sinceIso = new Date(Date.now() - days * 86400e3).toISOString();

  let window;
  try {
    window = await loadTrafficWindow(sb, sinceIso, new Date().toISOString());
  } catch {
    return {
      available: false,
      note: 'Traffic data unavailable. Check the database connection and page_views schema.',
      total: 0,
      unique: 0,
      byDay: [],
      topPaths: [],
      topReferrers: [],
      byBrowser: [],
      events: [],
      funnel: [],
      topCampaigns: [],
    };
  }

  const { rows, matched, truncated } = window;
  const { counts: eventCounts, pageviews: pageviewRows, unique } = trafficMetrics(rows);
  const pageviews = pageviewRows.length;
  const funnel = FUNNEL.map(([event, label]) => ({
    event,
    label,
    count: event === 'pageview' ? pageviews : (eventCounts[event] || 0),
    rate: event === 'pageview' ? Number(pageviews > 0) : rate(eventCounts[event] || 0, pageviews),
  }));
  const dayMap = {};
  for (const row of rows) {
    const day = String(row.created_at).slice(0, 10);
    if (!dayMap[day]) dayMap[day] = { day, count: 0, pageviews: 0, unique: new Set(), conversion_events: 0 };
    dayMap[day].count += 1;
    if ((row.event || 'pageview') === 'pageview') {
      dayMap[day].pageviews += 1;
      if (row.visitor) dayMap[day].unique.add(row.visitor);
    }
    if (CONVERSION_EVENTS.has(row.event)) dayMap[day].conversion_events += 1;
  }
  const byDay = Object.values(dayMap)
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((row) => ({ ...row, unique: row.unique.size }));

  return {
    available: true,
    days,
    total: rows.length,
    pageviews,
    unique,
    matched,
    truncated,
    measurement_basis: 'browser_events',
    unique_basis: 'session_ids_with_pageviews',
    byDay,
    topPaths: tally(pageviewRows, 'path').slice(0, 15),
    topReferrers: tally(pageviewRows, 'referrer', refHost).slice(0, 10),
    byBrowser: tally(pageviewRows, 'ua_family'),
    events: Object.entries(eventCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ key, count })),
    funnel,
    topCampaigns: tally(pageviewRows, 'utm_source', campaignKey).slice(0, 12),
  };
}
