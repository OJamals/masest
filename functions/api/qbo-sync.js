// POST /api/qbo-sync — cron/manual QBO sync worker entrypoint.
import { adminClient, json } from '../_lib/supabase.js';
import { getAccessToken, nextSyncState, syncOrder } from '../_lib/qbo.js';

function boundedBatch(request) {
  const requested = Number(new URL(request.url).searchParams.get('batch') || 10);
  return Math.min(25, Math.max(1, Math.floor(requested) || 10));
}

// Constant-time string comparison — avoids leaking the secret length/prefix via
// response-timing on the unauthenticated /api/qbo-sync endpoint.
function timingSafeEqual(a, b) {
  const sa = String(a || '');
  const sb = String(b || '');
  if (sa.length !== sb.length) return false;
  let diff = 0;
  for (let i = 0; i < sa.length; i++) diff |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
  return diff === 0;
}

const textEncoder = new TextEncoder();

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(String(value || '')));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function normalizeSecretHash(value) {
  const raw = String(value || '').trim().toLowerCase();
  const hash = raw.startsWith('sha256:') ? raw.slice(7) : raw;
  return /^[a-f0-9]{64}$/.test(hash) ? hash : '';
}

async function verifySyncSecret(request, env) {
  const provided = request.headers.get('x-qbo-sync-secret') || '';

  if (env.QBO_SYNC_SECRET) {
    return {
      configured: true,
      authorized: timingSafeEqual(provided, env.QBO_SYNC_SECRET)
    };
  }

  const sb = adminClient(env);
  const { data, error } = await sb.from('qbo_sync_settings')
    .select('secret_sha256')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;

  const storedHash = normalizeSecretHash(data?.secret_sha256);
  if (!storedHash) return { configured: false, authorized: false };

  const providedHash = await sha256Hex(provided);
  return {
    configured: true,
    authorized: timingSafeEqual(providedHash, storedHash)
  };
}

async function requeueClaimed(sb, orders, err) {
  const message = err?.message || String(err);
  await Promise.all((orders || []).map((order) => {
    const next = nextSyncState(order.qbo_attempts || 0);
    return sb.from('orders')
      .update({ ...next, qbo_error: message })
      .eq('id', order.id);
  }));
  return message;
}

async function orderItems(sb, orderId) {
  const { data, error } = await sb.from('order_items')
    .select('sku,name,qty,unit_price,line_total')
    .eq('order_id', orderId);
  if (error) throw new Error(error.message || 'qbo_order_items_read_failed');
  return data || [];
}

async function companyNamesFor(sb, order) {
  if (!order.company_id) return {};
  const { data, error } = await sb.from('companies')
    .select('name')
    .eq('id', order.company_id)
    .maybeSingle();
  if (error) throw new Error(error.message || 'qbo_company_read_failed');
  return data?.name ? { [order.company_id]: data.name } : {};
}

async function markSynced(sb, order, result) {
  const patch = {
    qbo_sync_status: 'synced',
    qbo_doc_id: result.docId,
    qbo_doc_type: result.docType,
    qbo_synced_at: new Date().toISOString(),
    qbo_error: null,
    qbo_next_attempt_at: null,
  };
  if (result.paymentId) patch.qbo_payment_id = result.paymentId;
  if (result.docType === 'invoice' || result.docType === 'invoice_payment') patch.qbo_invoice_id = result.docId;
  const { error } = await sb.from('orders').update(patch).eq('id', order.id);
  if (error) throw new Error(error.message || 'qbo_order_update_failed');
}

async function notifyInvoiceReady(sb, order, result) {
  if (result.docType !== 'invoice' || !order.company_id) return;
  await sb.from('notifications').insert({
    company_id: order.company_id,
    type: 'order',
    title: 'Order invoice ready',
    body: `QuickBooks invoice ${result.docId} is linked to your order.`,
    href: '/dashboard.html#orders',
  });
}

async function requeueOne(sb, order, err) {
  const next = nextSyncState(order.qbo_attempts || 0);
  const message = err?.message || String(err);
  const { error } = await sb.from('orders')
    .update({ ...next, qbo_error: message })
    .eq('id', order.id);
  if (error) throw new Error(error.message || 'qbo_order_requeue_failed');
  return message;
}

export async function runQboSync({ env, batch = 10 }) {
  const sb = adminClient(env);
  const { data: claimed, error } = await sb.rpc('claim_qbo_orders', { batch });
  if (error) return json(500, { error: error.message || 'qbo_claim_failed' });

  const orders = claimed || [];
  if (!orders.length) return json(200, { ok: true, claimed: 0, synced: 0, failed: 0 });

  let credentials;
  try {
    credentials = await getAccessToken(sb, env);
  } catch (err) {
    const message = await requeueClaimed(sb, orders, err);
    return json(503, { error: 'qbo_unavailable', detail: message, claimed: orders.length, failed: orders.length });
  }

  const results = [];
  let synced = 0;
  let failed = 0;
  for (const order of orders) {
    try {
      const items = await orderItems(sb, order.id);
      const companyNames = await companyNamesFor(sb, order);
      const result = await syncOrder(sb, env, credentials.accessToken, credentials.realmId, order, items, companyNames);
      await markSynced(sb, order, result);
      await notifyInvoiceReady(sb, order, result);
      synced += 1;
      results.push({ id: order.id, ok: true, doc_id: result.docId, doc_type: result.docType });
    } catch (err) {
      const detail = await requeueOne(sb, order, err);
      failed += 1;
      results.push({ id: order.id, ok: false, error: detail });
    }
  }

  return json(200, { ok: failed === 0, claimed: orders.length, synced, failed, results });
}

export async function onRequestPost({ request, env }) {
  let secretCheck;
  try {
    secretCheck = await verifySyncSecret(request, env);
  } catch (err) {
    return json(500, { error: 'qbo_sync_secret_lookup_failed', detail: err?.message || String(err) });
  }
  if (!secretCheck.configured) return json(500, { error: 'qbo_sync_secret_not_configured' });
  if (!secretCheck.authorized) {
    return json(401, { error: 'unauthorized' });
  }
  return runQboSync({ env, batch: boundedBatch(request) });
}
