const OAUTH_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;
const BACKOFF_CAP_MS = 6 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export function qboBaseUrl(env = {}) {
  return String(env.QBO_ENVIRONMENT || 'sandbox').toLowerCase() === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
}

function basicAuth(clientId, clientSecret) {
  return `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
}

export function needsRefresh(tokenRow, nowMs = Date.now()) {
  if (!tokenRow?.access_token || !tokenRow?.access_expires_at) return true;
  const expiresAt = Date.parse(tokenRow.access_expires_at);
  if (Number.isNaN(expiresAt)) return true;
  return expiresAt - nowMs <= TOKEN_REFRESH_SKEW_MS;
}

export function backoffMs(attempts) {
  return Math.min((2 ** Math.max(0, Number(attempts) || 0)) * 60_000, BACKOFF_CAP_MS);
}

export function nextSyncState(attempts, nowMs = Date.now()) {
  const next = (Number(attempts) || 0) + 1;
  if (next >= MAX_ATTEMPTS) {
    return { qbo_sync_status: 'error', qbo_attempts: next, qbo_next_attempt_at: null };
  }
  return {
    qbo_sync_status: 'pending',
    qbo_attempts: next,
    qbo_next_attempt_at: new Date(nowMs + backoffMs(next)).toISOString(),
  };
}

export function docNumber(orderId) {
  return String(orderId || '').replaceAll('-', '').slice(0, 21);
}

function lineFor(item, itemRefs) {
  const itemRef = itemRefs?.[item.sku];
  if (!itemRef) throw new Error(`qbo_item_ref_missing:${item.sku}`);
  return {
    DetailType: 'SalesItemLineDetail',
    Amount: Number(item.line_total || 0),
    Description: item.name || item.sku,
    SalesItemLineDetail: {
      ItemRef: { value: itemRef },
      Qty: Number(item.qty || 0),
      UnitPrice: Number(item.unit_price || 0),
    },
  };
}

function baseDocumentPayload({ order, items, customerRef, itemRefs }) {
  return {
    CustomerRef: { value: customerRef },
    DocNumber: docNumber(order.id),
    PrivateNote: `MASEST order ${order.id}`,
    Line: (items || []).map((item) => lineFor(item, itemRefs)),
    TxnTaxDetail: { TotalTax: Number(order.tax || 0) },
  };
}

export function buildSalesReceiptPayload(input) {
  return baseDocumentPayload(input);
}

export function buildInvoicePayload(input) {
  return {
    ...baseDocumentPayload(input),
    Balance: Number(input.order?.total || 0),
  };
}

export async function getAccessToken(sb, env = {}, options = {}) {
  const now = options.now || new Date();
  const fetchImpl = options.fetchImpl || fetch;
  const { data: tokenRow, error } = await sb
    .from('qbo_tokens')
    .select('realm_id,refresh_token,access_token,access_expires_at')
    .eq('id', 1)
    .maybeSingle();

  if (error) throw new Error(error.message || 'qbo_token_read_failed');
  if (!tokenRow?.refresh_token && !tokenRow?.access_token) throw new Error('qbo_not_connected');

  if (!needsRefresh(tokenRow, now.getTime())) {
    return { accessToken: tokenRow.access_token, realmId: tokenRow.realm_id || env.QBO_REALM_ID || '' };
  }

  if (!tokenRow.refresh_token) throw new Error('qbo_refresh_token_missing');
  if (!env.QBO_CLIENT_ID || !env.QBO_CLIENT_SECRET) throw new Error('qbo_oauth_not_configured');

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokenRow.refresh_token,
  });
  const response = await fetchImpl(OAUTH_URL, {
    method: 'POST',
    headers: {
      authorization: basicAuth(env.QBO_CLIENT_ID, env.QBO_CLIENT_SECRET),
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`qbo_token_refresh_failed:${response.status}:${detail.slice(0, 200)}`);
  }

  const refreshed = await response.json();
  const accessToken = refreshed.access_token;
  if (!accessToken) throw new Error('qbo_token_refresh_missing_access_token');

  const realmId = tokenRow.realm_id || env.QBO_REALM_ID || '';
  const payload = {
    realm_id: realmId,
    access_token: accessToken,
    refresh_token: refreshed.refresh_token || tokenRow.refresh_token,
    access_expires_at: new Date(now.getTime() + Number(refreshed.expires_in || 3600) * 1000).toISOString(),
    updated_at: now.toISOString(),
  };
  await sb.from('qbo_tokens').update(payload).eq('id', 1);

  return { accessToken, realmId };
}
