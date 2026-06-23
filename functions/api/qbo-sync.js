// POST /api/qbo-sync — cron/manual QBO sync worker entrypoint.
import { adminClient, json } from '../_lib/supabase.js';
import { getAccessToken, nextSyncState, syncOrder, syncRefund } from '../_lib/qbo.js';

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

async function requeueClaimed(sb, orders, err, table = 'orders') {
  const message = err?.message || String(err);
  await Promise.all((orders || []).map((order) => {
    const next = nextSyncState(order.qbo_attempts || 0);
    return sb.from(table)
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

// Distinct, non-guest company ids across a claimed batch (#37 N+1 fix).
export function uniqueCompanyIds(orders) {
  return [...new Set((orders || []).map((o) => o.company_id).filter(Boolean))];
}

// One batched `companies` read for the whole sync batch instead of one per order —
// a NET batch usually shares a buyer, so this collapses N reads to 1. Returns an
// { id: name } map for documentPlanFor; nameless rows are dropped (it falls back).
export async function companyNamesByIds(sb, ids) {
  if (!ids.length) return {};
  const { data, error } = await sb.from('companies').select('id,name').in('id', ids);
  if (error) throw new Error(error.message || 'qbo_company_read_failed');
  return Object.fromEntries((data || []).filter((c) => c.name).map((c) => [c.id, c.name]));
}

// #27 — tax-exempt buyers must get non-taxable QBO invoice lines. One batched read
// for the whole sync batch (like companyNamesByIds; not N+1). Kept separate from the
// name lookup so the #37 name-map contract stays untouched.
// ponytail: second batched query per run, not per order — merge into the name read
// only if QBO sync latency ever shows up in a profile.
export async function companyTaxExemptByIds(sb, ids) {
  if (!ids.length) return new Set();
  const { data, error } = await sb.from('companies').select('id,tax_exempt').in('id', ids);
  if (error) throw new Error(error.message || 'qbo_company_read_failed');
  return new Set((data || []).filter((c) => c.tax_exempt).map((c) => c.id));
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
    link: '/dashboard.html#orders',
  });
}

async function requeueOne(sb, order, err, table = 'orders') {
  const next = nextSyncState(order.qbo_attempts || 0);
  const message = err?.message || String(err);
  const { error } = await sb.from(table)
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

  // Resolve every buyer name in one query up front (#37). A failure here is a shared
  // dependency for the whole batch, so requeue all claimed orders like a token failure.
  let companyNames;
  let taxExemptIds;
  try {
    companyNames = await companyNamesByIds(sb, uniqueCompanyIds(orders));
    taxExemptIds = await companyTaxExemptByIds(sb, uniqueCompanyIds(orders));
  } catch (err) {
    const message = await requeueClaimed(sb, orders, err);
    return json(503, { error: 'qbo_company_lookup_failed', detail: message, claimed: orders.length, failed: orders.length });
  }

  const results = [];
  let synced = 0;
  let failed = 0;
  for (const order of orders) {
    try {
      const items = await orderItems(sb, order.id);
      const result = await syncOrder(sb, env, credentials.accessToken, credentials.realmId, order, items, companyNames, {
        taxExempt: taxExemptIds.has(order.company_id),
      });
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

// #22 — drain the refund queue: one reversing CreditMemo per qbo_refunds row.
// Mirrors runQboSync (claim → token → batched lookups → per-row sync/requeue) but
// loads each refund's parent order + items since refunds carry only an order_id.
export async function runQboRefundSync({ env, batch = 10 }) {
  const sb = adminClient(env);
  const { data: claimed, error } = await sb.rpc('claim_qbo_refunds', { batch });
  if (error) return json(500, { error: error.message || 'qbo_refund_claim_failed' });

  const refunds = claimed || [];
  if (!refunds.length) return json(200, { ok: true, claimed: 0, synced: 0, failed: 0 });

  let credentials;
  try {
    credentials = await getAccessToken(sb, env);
  } catch (err) {
    const message = await requeueClaimed(sb, refunds, err, 'qbo_refunds');
    return json(503, { error: 'qbo_unavailable', detail: message, claimed: refunds.length, failed: refunds.length });
  }

  let ordersById;
  let companyNames;
  let taxExemptIds;
  try {
    const orderIds = [...new Set(refunds.map((r) => r.order_id))];
    const { data: ords, error: oerr } = await sb.from('orders')
      .select('id,company_id,customer_email,payment_method,total,tax,stripe_payment_intent')
      .in('id', orderIds);
    if (oerr) throw new Error(oerr.message || 'qbo_refund_order_read_failed');
    ordersById = Object.fromEntries((ords || []).map((o) => [o.id, o]));
    const ids = uniqueCompanyIds(ords || []);
    companyNames = await companyNamesByIds(sb, ids);
    taxExemptIds = await companyTaxExemptByIds(sb, ids);
  } catch (err) {
    const message = await requeueClaimed(sb, refunds, err, 'qbo_refunds');
    return json(503, { error: 'qbo_refund_lookup_failed', detail: message, claimed: refunds.length, failed: refunds.length });
  }

  const results = [];
  let synced = 0;
  let failed = 0;
  for (const refund of refunds) {
    try {
      const order = ordersById[refund.order_id];
      if (!order) throw new Error('qbo_refund_order_missing');
      const items = await orderItems(sb, order.id);
      const result = await syncRefund(sb, env, credentials.accessToken, credentials.realmId, refund, order, items, companyNames, {
        taxExempt: taxExemptIds.has(order.company_id),
      });
      const { error: uerr } = await sb.from('qbo_refunds').update({
        qbo_sync_status: 'synced',
        qbo_credit_memo_id: result.creditMemoId,
        qbo_error: null,
        qbo_next_attempt_at: null,
      }).eq('id', refund.id);
      if (uerr) throw new Error(uerr.message || 'qbo_refund_update_failed');
      synced += 1;
      results.push({ id: refund.id, ok: true, credit_memo_id: result.creditMemoId });
    } catch (err) {
      const detail = await requeueOne(sb, refund, err, 'qbo_refunds');
      failed += 1;
      results.push({ id: refund.id, ok: false, error: detail });
    }
  }

  return json(200, { ok: failed === 0, claimed: refunds.length, synced, failed, results });
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
  // Drain both queues each run: order invoices then refund credit memos.
  const batch = boundedBatch(request);
  const ordersRes = await runQboSync({ env, batch });
  const refundsRes = await runQboRefundSync({ env, batch });
  const orders = await ordersRes.json().catch(() => ({}));
  const refunds = await refundsRes.json().catch(() => ({}));
  const status = ordersRes.status !== 200 ? ordersRes.status : refundsRes.status;
  return json(status, { ok: Boolean(orders.ok) && Boolean(refunds.ok), orders, refunds });
}
