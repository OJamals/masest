// Shared Klaviyo client — single place for the subscription-bulk-create-jobs POST and the
// industry -> nurture-list resolution. Used by newsletter.js (general list) and quote.js
// (per-industry lead nurture). Best-effort: missing config is a no-op, never a throw.
const REVISION = '2024-10-15';

// Normalized industry label (from the quote form) -> env var holding that list's ID.
const INDUSTRY_LIST_ENV = {
  oil_gas: 'KLAVIYO_LIST_OIL_GAS',
  marine: 'KLAVIYO_LIST_MARINE',
  manufacturing: 'KLAVIYO_LIST_MANUFACTURING',
  food_beverage: 'KLAVIYO_LIST_FOOD_BEVERAGE',
  healthcare: 'KLAVIYO_LIST_HEALTHCARE',
  construction: 'KLAVIYO_LIST_CONSTRUCTION',
  military_government: 'KLAVIYO_LIST_MILITARY_GOV',
  education: 'KLAVIYO_LIST_EDUCATION',
  hvac_water_treatment: 'KLAVIYO_LIST_HVAC_WATER',
  plumbing: 'KLAVIYO_LIST_PLUMBING',
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function normalizeIndustry(industry) {
  return String(industry || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Resolve a Klaviyo list ID for an industry: mapped env id, else the NURTURE fallback,
// else null (nothing configured).
export function listIdForIndustry(env, industry) {
  const key = INDUSTRY_LIST_ENV[normalizeIndustry(industry)];
  const mapped = key ? env[key] : null;
  return mapped || env.KLAVIYO_LIST_NURTURE || null;
}

function cleanProfileProperties(properties = {}) {
  return Object.fromEntries(Object.entries(properties)
    .map(([key, value]) => [String(key || '').trim().slice(0, 60), value])
    .filter(([key, value]) => key && value !== undefined && value !== null && value !== '')
    .map(([key, value]) => [key, typeof value === 'boolean' ? value : String(value).trim().slice(0, 300)])
    .slice(0, 20));
}

// Subscribe one email to a Klaviyo list. Best-effort: skips (no throw) when the private
// key, list, or a valid email is missing. Returns { ok, skipped?, status? }.
export async function klaviyoSubscribe(env, email, listId, properties = {}) {
  const key = env.KLAVIYO_PRIVATE_KEY;
  if (!key || !listId || !EMAIL_RE.test(String(email || ''))) {
    return { ok: false, skipped: true };
  }
  const profileProperties = cleanProfileProperties(properties);
  const attributes = {
    email,
    ...(Object.keys(profileProperties).length ? { properties: profileProperties } : {}),
    subscriptions: { email: { marketing: { consent: 'SUBSCRIBED' } } },
  };
  const payload = {
    data: {
      type: 'profile-subscription-bulk-create-job',
      attributes: {
        profiles: {
          data: [{
            type: 'profile',
            attributes,
          }],
        },
      },
      relationships: { list: { data: { type: 'list', id: listId } } },
    },
  };
  const resp = await globalThis.fetch('https://a.klaviyo.com/api/profile-subscription-bulk-create-jobs/', {
    method: 'POST',
    headers: {
      Authorization: `Klaviyo-API-Key ${key}`,
      revision: REVISION,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
  return { ok: resp.status === 202, status: resp.status };
}

// List the subscribed email addresses on a Klaviyo list. Paginates via links.next.
// Best-effort: returns [] (no throw) when the key/list is missing or a page fails.
// `max` caps total profiles pulled per call. fetchImpl injectable for tests.
export async function klaviyoListProfiles(
  env,
  listId,
  { max = 5000, fetchImpl = globalThis.fetch, strict = false } = {},
) {
  const key = env.KLAVIYO_PRIVATE_KEY;
  if (!key || !listId) {
    if (strict) throw new Error('klaviyo_profiles_not_configured');
    return [];
  }
  const emails = [];
  const seen = new Set();
  let url = `https://a.klaviyo.com/api/lists/${encodeURIComponent(listId)}/profiles/?page%5Bsize%5D=100`;
  let guard = 0;
  while (url && emails.length < max && guard < 200) {
    guard += 1;
    let resp;
    try {
      resp = await fetchImpl(url, {
        headers: { Authorization: `Klaviyo-API-Key ${key}`, revision: REVISION, accept: 'application/json' },
      });
    } catch (error) {
      if (strict) throw new Error('klaviyo_profiles_network_failure', { cause: error });
      break;
    }
    if (!resp || !resp.ok) {
      if (strict) throw new Error(`klaviyo_profiles_http_${resp?.status || 'unknown'}`);
      break;
    }
    let body;
    try {
      body = await resp.json();
    } catch (error) {
      if (strict) throw new Error('klaviyo_profiles_invalid_response', { cause: error });
      break;
    }
    for (const row of body?.data || []) {
      const email = String(row?.attributes?.email || '').trim().toLowerCase();
      if (email && EMAIL_RE.test(email) && !seen.has(email)) { seen.add(email); emails.push(email); }
    }
    url = body?.links?.next || null;
  }
  if (strict && url) throw new Error('klaviyo_profiles_truncated');
  return emails.slice(0, max);
}

// Subscribe a quote lead to its industry nurture list. Best-effort.
export async function subscribeLeadByIndustry(env, { email, industry } = {}) {
  const listId = listIdForIndustry(env, industry);
  if (!listId) return { ok: false, skipped: true };
  const r = await klaviyoSubscribe(env, email, listId);
  return { ...r, listId };
}

// Build a Klaviyo Events-API payload for a server-side metric (e.g. a pipeline stage
// change). Pure — unit-tested without network.
export function buildEventPayload({ email, metric, properties = {}, value } = {}) {
  const attributes = {
    properties,
    metric: { data: { type: 'metric', attributes: { name: metric } } },
    profile: { data: { type: 'profile', attributes: { email } } },
  };
  if (Number.isFinite(Number(value))) attributes.value = Number(value);
  return { data: { type: 'event', attributes } };
}

// Record a server-side metric event in Klaviyo. NOTE: an event does NOT send email — it only
// triggers a send if the owner has built a Klaviyo flow on that metric. Best-effort: skips
// (no throw) without a private key, metric name, or valid email.
export async function klaviyoTrack(env, { email, metric, properties, value } = {}) {
  const key = env.KLAVIYO_PRIVATE_KEY;
  if (!key || !metric || !EMAIL_RE.test(String(email || ''))) return { ok: false, skipped: true };
  try {
    const resp = await globalThis.fetch('https://a.klaviyo.com/api/events/', {
      method: 'POST',
      headers: {
        Authorization: `Klaviyo-API-Key ${key}`,
        revision: REVISION,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(buildEventPayload({ email, metric, properties, value })),
    });
    return { ok: resp.status === 202 || resp.status === 200, status: resp.status };
  } catch {
    return { ok: false, error: true };
  }
}
