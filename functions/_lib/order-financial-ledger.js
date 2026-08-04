import { adminClient } from './supabase.js';

function text(value, max = 240) {
  return String(value ?? '').trim().slice(0, max);
}

function amount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error('financial_entry_amount_invalid');
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

export async function recordOrderFinancialEntry(env, entry, dependencies = {}) {
  const client = dependencies.client || adminClient(env);
  const { error } = await client.rpc('record_order_financial_entry', {
    p_order_id: entry.orderId,
    p_source: text(entry.source, 40),
    p_entry_type: text(entry.entryType, 80),
    p_provider_object_id: text(entry.providerObjectId, 255),
    p_amount: amount(entry.amount),
    p_currency: text(entry.currency || 'usd', 8).toLowerCase(),
    p_recognition_state: text(entry.state, 24),
    p_actor_id: text(entry.actorId, 80) || null,
    p_reason: text(entry.reason, 280) || null,
    p_metadata: entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : {},
  });
  if (error) throw new Error('financial_entry_database_failed');
}
