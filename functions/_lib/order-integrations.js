// Canonical commerce identity helpers. Database UUIDs remain internal routing keys;
// order_number is the shared human/provider reference across every commerce system.
export function orderReference(order) {
  return String(order?.order_number || order?.id || '').trim();
}

export async function linkOrderProviderObject(sb, {
  orderId,
  provider,
  objectType,
  providerObjectId,
  metadata = {},
} = {}) {
  const objectId = String(providerObjectId || '').trim();
  if (!objectId) return null;
  const { data, error } = await sb.rpc('link_order_provider_object', {
    p_order_id: orderId,
    p_provider: provider,
    p_object_type: objectType,
    p_provider_object_id: objectId,
    p_metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {},
  });
  if (error) throw error;
  return data || null;
}
