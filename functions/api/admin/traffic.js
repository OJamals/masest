// GET /api/admin/traffic?days=14 - first-party traffic aggregates page_views. Staff-only.
import { adminClient, requireStaff, json } from '../../_lib/supabase.js';
import { cached } from '../../_lib/cache.js';

// Aggregates up to 10k page_views rows in JS per load; the result is org-wide, so
// cache it briefly per `days` window (no-op until RATE_KV is bound). Staff auth runs
// BEFORE the cache lookup.
const TRAFFIC_TTL_SEC = 60;

const FUNNEL = [
  ['pageview', 'Page views'],
  ['quote_submit', 'Quote submits'],
  ['checkout_start', 'Checkout starts'],
  ['order_confirmed', 'Order confirmed'],
];
const CONVERSION_EVENTS = new Set(FUNNEL.slice(1).map(([event]) => event));

function rate(count, total) {
  return total ? Number((count / total).toFixed(4)) : 0;
}

function tally(arr, key, transform) {
  const m = {};
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
  const source = row.utm_source || 'direct';
  const medium = row.utm_medium || 'none';
  const campaign = row.utm_campaign || 'uncategorized';
  return `${source} / ${medium} / ${campaign}`;
}

export async function onRequestGet({ request, env }) {
  const { user, staff } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });

  const days = Math.min(90, Math.max(1, parseInt(new URL(request.url).searchParams.get('days') || '14', 10) || 14));
  const sb = adminClient(env);
  const payload = await cached(env, `cache:admin:traffic:v1:d=${days}`, TRAFFIC_TTL_SEC, () => computeTraffic(sb, days));
  return json(200, payload);
}

async function computeTraffic(sb, days) {
  const sinceIso = new Date(Date.now() - days * 86400e3).toISOString();

  let rows = [];
  try {
    const { data, error } = await sb.from('page_views')
      .select('path,referrer,ua_family,visitor,created_at,event,utm_source,utm_medium,utm_campaign')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(10000);
    if (error) throw error;
    rows = data || [];
  } catch {
    return {
      available: false,
      note: 'page_views not migrated yet apply schema-phase5.sql and schema-conversion.sql.',
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

  const eventCounts = rows.reduce((map, row) => {
    const key = row.event || 'pageview';
    map[key] = (map[key] || 0) + 1;
    return map;
  }, {});
  const pageviews = eventCounts.pageview || rows.length;
  const funnel = FUNNEL.map(([event, label]) => ({
    event,
    label,
    count: event === 'pageview' ? pageviews : (eventCounts[event] || 0),
    rate: event === 'pageview' ? 1 : rate(eventCounts[event] || 0, pageviews),
  }));
  const dayMap = {};
  for (const row of rows) {
    const day = String(row.created_at).slice(0, 10);
    if (!dayMap[day]) dayMap[day] = { day, count: 0, pageviews: 0, unique: new Set(), conversion_events: 0 };
    dayMap[day].count += 1;
    if ((row.event || 'pageview') === 'pageview') dayMap[day].pageviews += 1;
    if (row.visitor) dayMap[day].unique.add(row.visitor);
    if (CONVERSION_EVENTS.has(row.event)) dayMap[day].conversion_events += 1;
  }
  const byDay = Object.values(dayMap)
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((row) => ({ ...row, unique: row.unique.size }));

  return {
    available: true,
    days,
    total: rows.length,
    unique: new Set(rows.map((row) => row.visitor).filter(Boolean)).size,
    byDay,
    topPaths: tally(rows, 'path').slice(0, 15),
    topReferrers: tally(rows, 'referrer', refHost).slice(0, 10),
    byBrowser: tally(rows, 'ua_family'),
    events: Object.entries(eventCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ key, count })),
    funnel,
    topCampaigns: tally(rows, 'utm_source', campaignKey).slice(0, 12),
  };
}
