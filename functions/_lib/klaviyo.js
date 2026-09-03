// Shared Klaviyo marketing client. Subscription, events, templates, campaigns, and
// campaign lifecycle live here; Cloudflare Email Service remains transactional-only.
export const KLAVIYO_REVISION = '2026-07-15';
export const KLAVIYO_CAMPAIGN_CREATE_REVISION = '2026-07-15.pre';

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

function apiHeaders(key, revision = KLAVIYO_REVISION) {
  return {
    Authorization: `Klaviyo-API-Key ${key}`,
    revision,
    'content-type': 'application/json',
    accept: 'application/vnd.api+json',
  };
}

async function klaviyoRequest(env, path, {
  method = 'GET',
  body,
  fetchImpl = globalThis.fetch,
  revision = KLAVIYO_REVISION,
} = {}) {
  const key = env?.KLAVIYO_PRIVATE_KEY;
  if (!key || typeof fetchImpl !== 'function') {
    return { ok: false, skipped: true, error: 'klaviyo_not_configured', retryable: false };
  }
  try {
    const response = await fetchImpl(`https://a.klaviyo.com${path}`, {
      method,
      headers: apiHeaders(key, revision),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const status = Number(response?.status) || 0;
    const payload = typeof response?.json === 'function'
      ? await response.json().catch(() => null)
      : null;
    const ok = status >= 200 && status < 300;
    const providerError = payload?.errors?.[0];
    return {
      ok,
      status,
      body: payload,
      retryable: !ok && (status === 429 || status >= 500),
      error: ok ? null : String(providerError?.code || providerError?.title || `klaviyo_http_${status || 'unknown'}`).slice(0, 160),
    };
  } catch (error) {
    return {
      ok: false,
      network: true,
      retryable: true,
      error: String(error?.message || 'klaviyo_network_failure').slice(0, 160),
    };
  }
}

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
export async function klaviyoSubscribe(env, email, listId, properties = {}, { fetchImpl = globalThis.fetch } = {}) {
  const key = env.KLAVIYO_PRIVATE_KEY;
  if (!key || !listId || !EMAIL_RE.test(String(email || ''))) {
    return { ok: false, skipped: true };
  }
  const profileProperties = cleanProfileProperties(properties);
  const attributes = {
    email: String(email).trim().toLowerCase(),
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
  const result = await klaviyoRequest(env, '/api/profile-subscription-bulk-create-jobs/', {
    method: 'POST', body: payload, fetchImpl,
  });
  return result.ok
    ? { ok: result.status === 202, status: result.status }
    : { ok: false, ...(result.skipped ? { skipped: true } : {}), ...(result.status ? { status: result.status } : {}), ...(!result.status && result.error ? { error: result.error } : {}) };
}

// Unsubscribe one profile from marketing on a list. Local suppression preserves
// opt-out intent; this accepted job removes the profile from Klaviyo audiences.
export async function klaviyoUnsubscribe(env, email, listId, {
  fetchImpl = globalThis.fetch,
  sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!env?.KLAVIYO_PRIVATE_KEY || !listId || !EMAIL_RE.test(normalized)) {
    return { ok: false, skipped: true };
  }
  const payload = {
    data: {
      type: 'profile-subscription-bulk-delete-job',
      attributes: {
        profiles: { data: [{ type: 'profile', attributes: { email: normalized } }] },
      },
      relationships: { list: { data: { type: 'list', id: listId } } },
    },
  };
  let result;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    result = await klaviyoRequest(env, '/api/profile-subscription-bulk-delete-jobs/', {
      method: 'POST', body: payload, fetchImpl,
    });
    if (result.ok || !result.retryable || attempt === 2) break;
    await sleepImpl(100 * (2 ** attempt));
  }
  return result.ok
    ? { ok: result.status === 202, status: result.status }
    : { ok: false, ...(result.skipped ? { skipped: true } : {}), ...(result.status ? { status: result.status } : {}), ...(result.error ? { error: result.error } : {}) };
}

function normalizedEmails(emails, max = 1000) {
  return [...new Set((Array.isArray(emails) ? emails : [])
    .map((email) => String(email || '').trim().toLowerCase())
    .filter((email) => EMAIL_RE.test(email)))].slice(0, max);
}

export async function klaviyoSubscribeMany(
  env,
  emails,
  listId,
  properties = {},
  { fetchImpl = globalThis.fetch } = {},
) {
  const clean = normalizedEmails(emails);
  if (!env?.KLAVIYO_PRIVATE_KEY || !listId || !clean.length) return { ok: false, skipped: true, count: 0 };
  const profileProperties = cleanProfileProperties(properties);
  const result = await klaviyoRequest(env, '/api/profile-subscription-bulk-create-jobs/', {
    method: 'POST',
    fetchImpl,
    body: {
      data: {
        type: 'profile-subscription-bulk-create-job',
        attributes: {
          profiles: {
            data: clean.map((email) => ({
              type: 'profile',
              attributes: {
                email,
                ...(Object.keys(profileProperties).length ? { properties: profileProperties } : {}),
                subscriptions: { email: { marketing: { consent: 'SUBSCRIBED' } } },
              },
            })),
          },
        },
        relationships: { list: { data: { type: 'list', id: listId } } },
      },
    },
  });
  return { ok: result.ok && result.status === 202, status: result.status, count: clean.length, error: result.error || undefined };
}

export async function klaviyoUnsubscribeMany(
  env,
  emails,
  listId,
  { fetchImpl = globalThis.fetch } = {},
) {
  const clean = normalizedEmails(emails);
  if (!env?.KLAVIYO_PRIVATE_KEY || !listId || !clean.length) return { ok: false, skipped: true, count: 0 };
  const result = await klaviyoRequest(env, '/api/profile-subscription-bulk-delete-jobs/', {
    method: 'POST',
    fetchImpl,
    body: {
      data: {
        type: 'profile-subscription-bulk-delete-job',
        attributes: {
          profiles: { data: clean.map((email) => ({ type: 'profile', attributes: { email } })) },
        },
        relationships: { list: { data: { type: 'list', id: listId } } },
      },
    },
  });
  return { ok: result.ok && result.status === 202, status: result.status, count: clean.length, error: result.error || undefined };
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
        headers: { Authorization: `Klaviyo-API-Key ${key}`, revision: KLAVIYO_REVISION, accept: 'application/vnd.api+json' },
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
export function buildEventPayload({ email, metric, properties = {}, value, uniqueId } = {}) {
  const attributes = {
    properties,
    metric: { data: { type: 'metric', attributes: { name: metric } } },
    profile: { data: { type: 'profile', attributes: { email } } },
  };
  const stableId = String(uniqueId || '').trim().slice(0, 255);
  if (stableId) attributes.unique_id = stableId;
  if (Number.isFinite(Number(value))) attributes.value = Number(value);
  return { data: { type: 'event', attributes } };
}

// Record a server-side metric event in Klaviyo. NOTE: an event does NOT send email — it only
// triggers a send if the owner has built a Klaviyo flow on that metric. Best-effort: skips
// (no throw) without a private key, metric name, or valid email.
export async function klaviyoTrack(env, {
  email,
  metric,
  properties,
  value,
  uniqueId,
  fetchImpl = globalThis.fetch,
} = {}) {
  const key = env.KLAVIYO_PRIVATE_KEY;
  if (!key || !metric || !EMAIL_RE.test(String(email || ''))) return { ok: false, skipped: true };
  const result = await klaviyoRequest(env, '/api/events/', {
    method: 'POST',
    body: buildEventPayload({
      email: String(email).trim().toLowerCase(), metric, properties, value, uniqueId,
    }),
    fetchImpl,
  });
  if (result.ok) return { ok: [200, 202].includes(result.status), status: result.status };
  return { ok: false, ...(result.status ? { status: result.status } : {}), error: result.error || true };
}

function campaignFailure(step, result) {
  return {
    ok: false,
    provider: 'klaviyo',
    step,
    retryable: result?.retryable === true,
    ...(result?.status ? { status: result.status } : {}),
    error: result?.error || `klaviyo_${step}_failed`,
  };
}

function marketingIdentity(env) {
  return {
    fromEmail: String(env.KLAVIYO_FROM_EMAIL || 'noreply@send.masest.co').trim(),
    fromLabel: String(env.KLAVIYO_FROM_LABEL || 'MASEST · VertKleen').trim(),
    replyTo: String(env.KLAVIYO_REPLY_TO || env.EMAIL_REPLY_TO || 'dev@masest.co').trim(),
  };
}

// Build and queue one list campaign. Success means Klaviyo accepted its async send job;
// it never claims final delivery. Call getKlaviyoCampaignStatus for reconciliation.
export async function publishKlaviyoCampaign(env, {
  name,
  subject,
  previewText = '',
  html,
  text = '',
  listId = env?.KLAVIYO_LIST_ID,
  smartSending = false,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!env?.KLAVIYO_PRIVATE_KEY || !listId) {
    return { ok: false, provider: 'klaviyo', retryable: false, error: 'klaviyo_campaign_not_configured' };
  }
  if (!/href\s*=\s*["']\{% unsubscribe_link %\}["']/i.test(String(html || ''))) {
    return { ok: false, provider: 'klaviyo', retryable: false, error: 'marketing_unsubscribe_required' };
  }
  const campaignName = String(name || subject || 'MASEST campaign').trim().slice(0, 255);
  const cleanSubject = String(subject || '').trim().slice(0, 255);
  if (!cleanSubject) return { ok: false, provider: 'klaviyo', retryable: false, error: 'campaign_subject_required' };

  const template = await klaviyoRequest(env, '/api/templates', {
    method: 'POST',
    fetchImpl,
    body: {
      data: {
        type: 'template',
        attributes: {
          name: `${campaignName} · ${new Date().toISOString()}`.slice(0, 255),
          editor_type: 'CODE',
          html: String(html),
          text: String(text || ''),
        },
      },
    },
  });
  const templateId = String(template.body?.data?.id || '');
  if (!template.ok || !templateId) return campaignFailure('create_template', template);

  const identity = marketingIdentity(env);
  // Create Campaign remains beta until Klaviyo's 2026-10-15 GA revision.
  // Source: https://developers.klaviyo.com/en/reference/create_campaign_beta
  const campaign = await klaviyoRequest(env, '/api/campaigns', {
    method: 'POST',
    fetchImpl,
    revision: KLAVIYO_CAMPAIGN_CREATE_REVISION,
    body: {
      data: {
        type: 'campaign',
        attributes: {
          name: campaignName,
          audiences: { included: [String(listId)] },
          send_strategy: { method: 'immediate' },
          send_options: { use_smart_sending: Boolean(smartSending) },
          'campaign-messages': {
            data: [{
              type: 'campaign-message',
              attributes: {
                definition: {
                  channel: 'email',
                  label: cleanSubject,
                  content: {
                    subject: cleanSubject,
                    preview_text: String(previewText || '').slice(0, 255),
                    from_email: identity.fromEmail,
                    from_label: identity.fromLabel,
                    reply_to_email: identity.replyTo,
                  },
                },
              },
            }],
          },
        },
      },
    },
  });
  const campaignId = String(campaign.body?.data?.id || '');
  if (!campaign.ok || !campaignId) return campaignFailure('create_campaign', campaign);

  const relationship = await klaviyoRequest(
    env,
    `/api/campaigns/${encodeURIComponent(campaignId)}/relationships/campaign-messages`,
    { fetchImpl },
  );
  const messageId = String(relationship.body?.data?.[0]?.id || '');
  if (!relationship.ok || !messageId) return campaignFailure('load_message', relationship);

  const assigned = await klaviyoRequest(env, '/api/campaign-message-assign-template', {
    method: 'POST',
    fetchImpl,
    body: {
      data: {
        type: 'campaign-message',
        id: messageId,
        relationships: { template: { data: { type: 'template', id: templateId } } },
      },
    },
  });
  if (!assigned.ok) return campaignFailure('assign_template', assigned);

  const send = await klaviyoRequest(env, '/api/campaign-send-jobs', {
    method: 'POST',
    fetchImpl,
    body: { data: { type: 'campaign-send-job', id: campaignId } },
  });
  if (!send.ok || send.status !== 202) return campaignFailure('queue_send', send);
  return {
    ok: true,
    queued: true,
    provider: 'klaviyo',
    campaignId,
    messageId,
    templateId,
    status: String(send.body?.data?.attributes?.status || 'queued').toLowerCase(),
  };
}

export async function getKlaviyoCampaignStatus(env, campaignId, { fetchImpl = globalThis.fetch } = {}) {
  if (!campaignId) return { ok: false, error: 'campaign_id_required' };
  const result = await klaviyoRequest(env, `/api/campaign-send-jobs/${encodeURIComponent(campaignId)}`, { fetchImpl });
  if (!result.ok) return campaignFailure('get_send_status', result);
  return {
    ok: true,
    campaignId: String(campaignId),
    status: String(result.body?.data?.attributes?.status || 'unknown').toLowerCase(),
  };
}
