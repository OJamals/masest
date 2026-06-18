// POST /api/qbo-sync — cron/manual QBO sync worker entrypoint.
import { adminClient, json } from '../_lib/supabase.js';
import { getAccessToken, nextSyncState } from '../_lib/qbo.js';

function boundedBatch(request) {
  const requested = Number(new URL(request.url).searchParams.get('batch') || 10);
  return Math.min(25, Math.max(1, Math.floor(requested) || 10));
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

export async function onRequestPost({ request, env }) {
  if (!env.QBO_SYNC_SECRET) return json(500, { error: 'qbo_sync_secret_not_configured' });
  if (request.headers.get('x-qbo-sync-secret') !== env.QBO_SYNC_SECRET) {
    return json(401, { error: 'unauthorized' });
  }

  const sb = adminClient(env);
  const batch = boundedBatch(request);
  const { data: claimed, error } = await sb.rpc('claim_qbo_orders', { batch });
  if (error) return json(500, { error: error.message || 'qbo_claim_failed' });

  const orders = claimed || [];
  if (!orders.length) return json(200, { ok: true, claimed: 0, synced: 0, failed: 0 });

  try {
    await getAccessToken(sb, env);
  } catch (err) {
    const message = await requeueClaimed(sb, orders, err);
    return json(503, { error: 'qbo_unavailable', detail: message, claimed: orders.length, failed: orders.length });
  }

  const message = await requeueClaimed(sb, orders, new Error('qbo_document_sync_not_implemented'));
  return json(501, { error: 'qbo_document_sync_not_implemented', detail: message, claimed: orders.length, failed: orders.length });
}
