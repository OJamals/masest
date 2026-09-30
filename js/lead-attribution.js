// Shared browser/server boundary for optional, non-authoritative acquisition context.
const CAMPAIGN_FIELDS = ['utm_source', 'utm_medium', 'utm_campaign'];
const PUBLIC_PATH = /^\/(?:$|(?:products|industries|blog|comparisons|job-plans)\/[a-z0-9][a-z0-9-]*\/?$|(?:products|industries|blog|comparisons|services|programs|proof|about|resources|contact|private-label)\/?$)/;

function campaignLabel(value) {
  if (typeof value !== 'string') return '';
  const label = value.trim();
  return /^[a-z0-9][a-z0-9 _.-]{0,119}$/i.test(label) && !/^[\d ().-]{7,}$/.test(label) ? label : '';
}

export function normalizeLeadAttribution(value) {
  try {
    if (typeof value === 'string') {
      if (value.length > 2048) return null;
      value = JSON.parse(value);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const result = { version: 1 };
    const path = typeof value.landing_path === 'string'
      ? value.landing_path.split(/[?#]/)[0].replace(/\.html$/, '') : '';
    if (path.length <= 240 && PUBLIC_PATH.test(path)) result.landing_path = path;
    try {
      const ref = new URL(value.referrer_origin);
      if (/^https?:$/.test(ref.protocol) && !ref.username && !ref.password
          && ref.hostname !== 'masest.co' && !ref.hostname.endsWith('.masest.co')
          && ref.origin.length <= 240) result.referrer_origin = ref.origin;
    } catch { /* direct, internal, or unavailable referrer */ }
    for (const key of CAMPAIGN_FIELDS) {
      const label = campaignLabel(value[key]);
      if (label) result[key] = label;
    }
    return Object.keys(result).length > 1 ? result : null;
  } catch { return null; }
}

export function leadAttribution(quote = {}) {
  return normalizeLeadAttribution(quote.payload?.attribution)
    || normalizeLeadAttribution(quote.payload);
}

export function leadAcquisitionLabel(attribution) {
  const value = normalizeLeadAttribution(attribution);
  if (!value) return 'Unknown';
  let host = '';
  try { host = new URL(value.referrer_origin).hostname.replace(/^www\./, ''); } catch { /* no external referrer */ }
  const search = ({ 'google.com': 'Google', 'bing.com': 'Bing', 'duckduckgo.com': 'DuckDuckGo', 'search.yahoo.com': 'Yahoo' })[host];
  const source = value.utm_source || search || host || (value.landing_path ? 'Direct or unknown' : 'Unknown');
  const medium = value.utm_medium || (value.utm_source ? 'Unspecified' : search ? 'Organic search' : host ? 'Referral' : 'Unknown');
  return [source, medium, value.utm_campaign].filter(Boolean).join(' / ');
}
