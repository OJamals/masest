import { emailsByIds } from './supabase.js';

export const SUPPORT_PAGE_SIZE = 200;
export const SUPPORT_PRESENCE_TTL_MS = 45_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function resolveSupportOrderId(sb, { orderId, companyId = null, userId = null } = {}) {
  const id = String(orderId || '').trim();
  if (!id) return { ok: true, orderId: null };
  const targetCompanyId = String(companyId || '').trim() || null;
  const targetUserId = String(userId || '').trim() || null;
  if (!UUID.test(id) || (!targetCompanyId && !targetUserId)) {
    return { ok: false, status: 404, error: 'order_not_found' };
  }

  const { data, error } = await sb.from('orders')
    .select('id,order_number,status,company_id,user_id,customer_email')
    .eq('id', id)
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: 'server_error' };
  const ownedByUser = targetUserId && data?.user_id === targetUserId;
  const ownedByCompany = targetCompanyId && data?.company_id === targetCompanyId;
  if (!data || (!ownedByUser && !ownedByCompany)) {
    return { ok: false, status: 404, error: 'order_not_found' };
  }
  return {
    ok: true,
    orderId: data.id,
    order: supportOrderContext(data),
    recipientUserId: data.user_id || null,
    recipientEmail: String(data.customer_email || '').trim().toLowerCase() || null,
  };
}

const SUPPORT_RECIPIENT_SELECT = 'id,company_id,full_name,notify_messages,support_chat_open,support_chat_seen_at';

async function recipientWithEmail(sb, profile) {
  if (!profile?.id) return null;
  const emailById = await emailsByIds(sb, [profile.id]);
  return { ...profile, email: emailById[profile.id] || null };
}

export async function resolveSupportRecipient(sb, { companyId, userId = null, email = null } = {}) {
  const targetCompanyId = String(companyId || '').trim() || null;
  const targetUserId = String(userId || '').trim();
  const targetEmail = String(email || '').trim().toLowerCase();

  if (targetUserId) {
    let query = sb.from('profiles')
      .select(SUPPORT_RECIPIENT_SELECT)
      .eq('id', targetUserId);
    if (targetCompanyId) query = query.eq('company_id', targetCompanyId);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (data) return recipientWithEmail(sb, data);
  }

  if (!targetEmail || !targetCompanyId) return null;
  const { data, error } = await sb.from('profiles')
    .select(SUPPORT_RECIPIENT_SELECT)
    .eq('company_id', targetCompanyId)
    .limit(1000);
  if (error) throw error;
  const emailById = await emailsByIds(sb, (data || []).map((profile) => profile.id));
  const profile = (data || []).find((candidate) => (
    String(emailById[candidate.id] || '').trim().toLowerCase() === targetEmail
  ));
  return profile ? { ...profile, email: emailById[profile.id] } : null;
}

export async function appendSupportMessage(sb, {
  companyId,
  userId = null,
  recipientUserId = null,
  threadUserId = userId || recipientUserId || null,
  senderRole,
  body,
  orderId = null,
  source = 'dashboard',
  reopen = null,
}) {
  const { data, error } = await sb.rpc('append_support_message', {
    p_company_id: companyId,
    p_user_id: userId,
    p_recipient_user_id: recipientUserId,
    p_thread_user_id: threadUserId,
    p_sender_role: senderRole,
    p_body: body,
    p_order_id: orderId,
    p_source: source,
    p_reopen: reopen,
  });
  if (error) throw error;
  return data;
}

export function supportOrderContext(order) {
  if (!order?.id) return null;
  const reference = String(order.order_number || order.id).trim();
  const encodedId = encodeURIComponent(order.id);
  return {
    id: order.id,
    reference,
    status: order.status || null,
    buyer_url: `/dashboard.html?order=${encodedId}#orders`,
    admin_url: `/admin.html?order=${encodedId}#orders`,
  };
}

export async function supportOrderContextsById(sb, orderIds, companyId = null) {
  const ids = [...new Set((orderIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return new Map();
  const chunks = [];
  for (let offset = 0; offset < ids.length; offset += 100) chunks.push(ids.slice(offset, offset + 100));
  const results = await Promise.all(chunks.map(async (chunk) => {
    let query = sb.from('orders').select('id,order_number,status,company_id').in('id', chunk);
    if (companyId) query = query.eq('company_id', companyId);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }));
  return new Map(results.flat().map((order) => [order.id, supportOrderContext(order)]));
}

export async function hydrateSupportOrderContexts(sb, messages, companyId = null) {
  const rows = messages || [];
  const contexts = await supportOrderContextsById(sb, rows.map((message) => message.order_id), companyId);
  return rows.map((message) => ({
    ...message,
    order: message.order_id ? contexts.get(message.order_id) || null : null,
  }));
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

export function supportThreadListStatus(value) {
  const status = String(value || 'open').trim();
  return ['open', 'complete'].includes(status) ? status : null;
}

export function supportThreadPatch(status, userId, now = new Date().toISOString()) {
  if (!['open', 'escalated', 'complete'].includes(status)) return null;
  if (status === 'complete') {
    return {
      status: 'complete',
      completed_at: now,
      completed_by: userId,
    };
  }
  return {
    status,
    completed_at: null,
    completed_by: null,
  };
}
