const STRIPE_API = 'https://api.stripe.com/v1';

export const REQUIRED_STRIPE_WEBHOOK_EVENTS = Object.freeze([
  'checkout.session.completed',
  'checkout.session.expired',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed',
  'invoice.paid',
  'charge.dispute.created',
  'charge.refunded',
]);

function text(value) {
  return String(value || '').trim();
}

export function stripeCredentialMode(value) {
  const key = text(value);
  if (!key) return 'missing';
  if (/^(?:sk|rk)_live(?:_|$)/.test(key)) return 'live';
  if (/^(?:sk|rk)_test(?:_|$)/.test(key)) return 'test';
  return 'unknown';
}

export function stripeLiveModeRequired(env = {}) {
  if (text(env.STRIPE_LIVE_MODE_REQUIRED).toLowerCase() === 'true') return true;
  try {
    const host = new URL(text(env.APP_URL)).hostname.toLowerCase();
    return host === 'masest.co' || host === 'www.masest.co';
  } catch {
    return false;
  }
}

export function expectedStripeWebhookUrl(env = {}) {
  const appUrl = text(env.APP_URL).replace(/\/+$/, '');
  return appUrl ? `${appUrl}/api/stripe-webhook` : null;
}

export function stripeRuntimeError(env = {}) {
  const mode = stripeCredentialMode(env.STRIPE_SECRET_KEY);
  if (mode === 'missing') return 'stripe_not_configured';
  if (mode === 'unknown') return 'stripe_key_invalid';
  if (!stripeLiveModeRequired(env)) return null;
  if (mode !== 'live') return 'stripe_live_mode_required';
  if (!text(env.STRIPE_WEBHOOK_SECRET).startsWith('whsec_')) return 'stripe_webhook_not_configured';
  return null;
}

export function stripeRuntimeConfig(env = {}) {
  const keyMode = stripeCredentialMode(env.STRIPE_SECRET_KEY);
  const liveRequired = stripeLiveModeRequired(env);
  const webhookSecret = text(env.STRIPE_WEBHOOK_SECRET).startsWith('whsec_');
  return {
    secret_key: keyMode === 'missing' ? 'missing' : 'present',
    key_mode: keyMode,
    live_required: liveRequired,
    webhook_secret: webhookSecret ? 'present' : 'missing',
    ready: stripeRuntimeError(env) === null,
  };
}

async function defaultListWebhookEndpoints(env, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || fetch;
  const response = await fetchImpl(`${STRIPE_API}/webhook_endpoints?limit=100`, {
    headers: { Authorization: `Bearer ${text(env.STRIPE_SECRET_KEY)}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error('stripe_webhook_status_failed');
    error.status = response.status;
    throw error;
  }
  return payload;
}

export async function stripeIntegrationStatus(env = {}, dependencies = {}) {
  const config = stripeRuntimeConfig(env);
  const expectedUrl = expectedStripeWebhookUrl(env);
  const baseWebhook = {
    url: expectedUrl,
    registered: false,
    enabled: false,
    events_ready: false,
    missing_events: [...REQUIRED_STRIPE_WEBHOOK_EVENTS],
    ready: false,
  };
  if (config.secret_key === 'missing' || config.key_mode === 'unknown' || !expectedUrl) {
    return { connected: false, config, webhook: baseWebhook };
  }

  const listWebhookEndpoints = dependencies.listWebhookEndpoints
    || ((runtimeEnv) => defaultListWebhookEndpoints(runtimeEnv, dependencies));
  let payload;
  try {
    payload = await listWebhookEndpoints(env);
  } catch {
    return { connected: false, config, webhook: baseWebhook };
  }
  const endpoints = Array.isArray(payload) ? payload : (payload?.data || []);
  const endpoint = endpoints.find((item) => text(item?.url).replace(/\/+$/, '') === expectedUrl);
  if (!endpoint) return { connected: true, config, webhook: baseWebhook };

  const events = new Set(Array.isArray(endpoint.enabled_events) ? endpoint.enabled_events : []);
  const wildcard = events.has('*');
  const missing = wildcard ? [] : REQUIRED_STRIPE_WEBHOOK_EVENTS.filter((event) => !events.has(event));
  const enabled = endpoint.status === 'enabled';
  const modeMatches = endpoint.livemode == null
    || endpoint.livemode === (config.key_mode === 'live');
  const webhook = {
    url: expectedUrl,
    registered: true,
    enabled,
    events_ready: missing.length === 0,
    missing_events: missing,
    ready: enabled && modeMatches && missing.length === 0 && config.webhook_secret === 'present',
  };
  return { connected: true, config, webhook };
}

async function defaultRetrieveShippingRate(env, id, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || fetch;
  const response = await fetchImpl(`${STRIPE_API}/shipping_rates/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${text(env.STRIPE_SECRET_KEY)}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return null;
  return payload;
}

export async function stripeShippingRatesStatus(env = {}, entries = [], dependencies = {}) {
  const keyMode = stripeCredentialMode(env.STRIPE_SECRET_KEY);
  const desiredLive = stripeLiveModeRequired(env);
  const retrieve = dependencies.retrieveShippingRate
    || ((id) => defaultRetrieveShippingRate(env, id, dependencies));
  const configured = (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry?.payload?.active === true)
    .map((entry) => ({ slug: text(entry.slug), id: text(entry.payload?.stripe_rate_id) }))
    .filter((entry) => entry.id);
  const rates = await Promise.all(configured.map(async (entry) => {
    let provider = null;
    try { provider = await retrieve(entry.id); } catch { /* status remains unavailable */ }
    const mode = provider?.livemode === true ? 'live' : provider?.livemode === false ? 'test' : 'unknown';
    const modeMatches = !desiredLive || mode === 'live';
    return {
      slug: entry.slug,
      found: Boolean(provider),
      active: provider?.active === true,
      mode,
      ready: Boolean(provider && provider.active === true && modeMatches),
    };
  }));
  return {
    key_mode: keyMode,
    count: rates.length,
    rates,
    ready: rates.length > 0 && rates.every((rate) => rate.ready),
  };
}

export async function stripeShippingRatesError(env = {}, ids = [], dependencies = {}) {
  if (!stripeLiveModeRequired(env)) return null;
  const entries = ids.map((id, index) => ({
    slug: `checkout-${index + 1}`,
    payload: { active: true, stripe_rate_id: id },
  }));
  const status = await stripeShippingRatesStatus(env, entries, dependencies);
  return status.ready ? null : 'stripe_shipping_rates_not_live';
}
