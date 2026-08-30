export const SUPPORT_PAGE_SIZE = 200;
export const SUPPORT_PRESENCE_TTL_MS = 45_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function resolveSupportOrderId(sb, { orderId, companyId } = {}) {
  const id = String(orderId || '').trim();
  if (!id) return { ok: true, orderId: null };
  if (!UUID.test(id) || !companyId) {
    return { ok: false, status: 404, error: 'order_not_found' };
  }

  const { data, error } = await sb.from('orders')
    .select('id')
    .eq('id', id)
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: 'server_error' };
  if (!data) return { ok: false, status: 404, error: 'order_not_found' };
  return { ok: true, orderId: data.id };
}

export function messagePage(rows, limit = SUPPORT_PAGE_SIZE) {
  const pageSize = Math.max(1, Math.min(Number(limit) || SUPPORT_PAGE_SIZE, SUPPORT_PAGE_SIZE));
  const hasMore = (rows || []).length > pageSize;
  const messages = (rows || []).slice(0, pageSize).reverse();
  return {
    messages,
    has_more: hasMore,
    next_before: hasMore ? messages[0]?.created_at || null : null,
  };
}

export function presenceIsFresh(value, now = Date.now(), ttlMs = SUPPORT_PRESENCE_TTL_MS) {
  if (!value) return false;
  const seenAt = Date.parse(value);
  return Number.isFinite(seenAt) && now - seenAt >= 0 && now - seenAt < ttlMs;
}

export function supportThreadPatch(status, userId, now = new Date().toISOString()) {
  if (!['open', 'escalated', 'complete'].includes(status)) return null;
  if (status === 'complete') {
    return {
      support_thread_status: 'complete',
      support_thread_completed_at: now,
      support_thread_completed_by: userId,
    };
  }
  return {
    support_thread_status: status,
    support_thread_completed_at: null,
    support_thread_completed_by: null,
  };
}

export async function recordSupportMessage(sb, {
  companyId,
  senderRole,
  body,
  createdAt,
  reopen = senderRole === 'buyer',
}) {
  const patch = {
    support_last_message_at: createdAt || new Date().toISOString(),
    support_last_message_body: String(body || '').slice(0, 4000),
    support_last_sender_role: senderRole,
  };
  if (reopen) Object.assign(patch, supportThreadPatch('open', null));
  const { error } = await sb.from('companies').update(patch).eq('id', companyId);
  if (error) throw error;
  return patch;
}
