// GET /api/admin/qbo/status — staff-only QBO connection status.
import { adminClient, json, requireStaff } from '../../../_lib/supabase.js';
import { qboConfigStatus } from '../../../_lib/qbo-config.js';

export async function onRequestGet({ request, env }) {
  const { user, staff } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });

  const sb = adminClient(env);
  const { data, error } = await sb.from('qbo_tokens')
    .select('realm_id,refresh_token,access_token,access_expires_at,last_intuit_tid,updated_at')
    .eq('id', 1)
    .maybeSingle();
  if (error) return json(500, { error: error.message || 'qbo_status_failed' });

  const { data: syncRows, error: syncError } = await sb.from('orders')
    .select('qbo_sync_status');
  if (syncError) return json(500, { error: syncError.message || 'qbo_sync_status_failed' });

  const { data: qbo_failed_orders, error: failedError } = await sb.from('orders')
    .select('id,created_at,total,currency,payment_method,qbo_error,qbo_attempts,qbo_next_attempt_at,companies(name)')
    .eq('qbo_sync_status', 'error')
    .order('created_at', { ascending: false })
    .limit(10);
  if (failedError) return json(500, { error: failedError.message || 'qbo_failed_orders_failed' });

  let refund_sync_counts = {};
  let qbo_failed_refunds = [];
  try {
    const { data: refundRows } = await sb.from('qbo_refunds').select('qbo_sync_status');
    refund_sync_counts = (refundRows || []).reduce((counts, row) => {
      const status = row.qbo_sync_status || 'none';
      counts[status] = (counts[status] || 0) + 1;
      return counts;
    }, {});
    const { data: failedRefunds } = await sb.from('qbo_refunds')
      .select('id,order_id,amount,fully_refunded,qbo_error,qbo_attempts,qbo_next_attempt_at,created_at')
      .eq('qbo_sync_status', 'error')
      .order('created_at', { ascending: false })
      .limit(10);
    qbo_failed_refunds = failedRefunds || [];
  } catch {
    refund_sync_counts = {};
    qbo_failed_refunds = [];
  }

  const sync_counts = (syncRows || []).reduce((counts, row) => {
    const status = row.qbo_sync_status || 'none';
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});

  return json(200, {
    connected: Boolean(data?.refresh_token || data?.access_token),
    qbo_config: qboConfigStatus(env),
    realm_id: data?.realm_id || null,
    access_expires_at: data?.access_expires_at || null,
    last_intuit_tid: data?.last_intuit_tid || null,
    updated_at: data?.updated_at || null,
    sync_counts,
    refund_sync_counts,
    qbo_failed_orders: qbo_failed_orders || [],
    qbo_failed_refunds,
  });
}
