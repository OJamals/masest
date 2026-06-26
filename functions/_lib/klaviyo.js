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

// Subscribe one email to a Klaviyo list. Best-effort: skips (no throw) when the private
// key, list, or a valid email is missing. Returns { ok, skipped?, status? }.
export async function klaviyoSubscribe(env, email, listId) {
  const key = env.KLAVIYO_PRIVATE_KEY;
  if (!key || !listId || !EMAIL_RE.test(String(email || ''))) {
    return { ok: false, skipped: true };
  }
  const payload = {
    data: {
      type: 'profile-subscription-bulk-create-job',
      attributes: {
        profiles: {
          data: [{
            type: 'profile',
            attributes: { email, subscriptions: { email: { marketing: { consent: 'SUBSCRIBED' } } } },
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
