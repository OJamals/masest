// Browser beacons describe activity, not authoritative leads or paid orders.
// PostgREST caps each response; paginate instead of assuming limit(10000) bypasses it.
export async function loadTrafficWindow(sb, since, until, maxRows = 10000) {
  const rows = [];
  let matched = null;
  while (rows.length < maxRows) {
    const { data, error, count } = await sb.from('page_views')
      .select('path,referrer,ua_family,visitor,created_at,event,utm_source,utm_medium,utm_campaign', { count: 'exact' })
      .gte('created_at', since)
      .lt('created_at', until)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(rows.length, Math.min(rows.length + 999, maxRows - 1));
    if (error) throw error;
    if (typeof count === 'number') matched = count;
    const page = data || [];
    rows.push(...page);
    if (!page.length || (matched !== null && rows.length >= matched)) break;
  }
  return { rows, matched, truncated: matched === null ? rows.length >= maxRows : rows.length < matched };
}

export function trafficMetrics(rows) {
  const counts = Object.create(null);
  const pageviews = rows.filter((row) => (row.event || 'pageview') === 'pageview');
  for (const row of rows) {
    const event = row.event || 'pageview';
    counts[event] = (counts[event] || 0) + 1;
  }
  return {
    counts,
    pageviews,
    unique: new Set(pageviews.map((row) => row.visitor).filter(Boolean)).size,
  };
}
