import { adminClient, requireStaff, json } from '../../_lib/supabase.js';
import { stripeIntegrationStatus, stripeShippingRatesStatus } from '../../_lib/stripe-runtime.js';

async function defaultLoadShippingEntries(env) {
  const { data, error } = await adminClient(env).from('content_entries')
    .select('slug,payload')
    .eq('type', 'shipping_rate')
    .eq('status', 'published')
    .eq('locale', 'en')
    .order('slug');
  if (error) throw error;
  return data || [];
}

export function createStripeAdminHandler(dependencies = {}) {
  const requireStaffImpl = dependencies.requireStaff || requireStaff;
  const statusImpl = dependencies.status || stripeIntegrationStatus;
  const loadShippingEntries = dependencies.loadShippingEntries || defaultLoadShippingEntries;
  const shippingStatus = dependencies.shippingStatus || stripeShippingRatesStatus;
  return async function stripeAdminHandler({ request, env }) {
    const { user, staff } = await requireStaffImpl(request, env);
    if (!user) return json(401, { error: 'unauthenticated' });
    if (!staff) return json(403, { error: 'forbidden' });
    return handleStripeRequest({ request, env }, {
      status: statusImpl,
      loadShippingEntries,
      shippingStatus,
    });
  };
}

async function handleStripeRequest({ request, env }, dependencies) {
  if (request.method !== 'GET') return json(405, { error: 'method_not_allowed' });
  try {
    const [status, entries] = await Promise.all([
      dependencies.status(env),
      dependencies.loadShippingEntries(env),
    ]);
    return json(200, {
      ...status,
      shipping_rates: await dependencies.shippingStatus(env, entries),
    });
  } catch {
    return json(502, { error: 'stripe_status_failed' });
  }
}

export async function onRequest({ request, env }) {
  const { user, staff } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });
  return handleStripeRequest({ request, env }, {
    status: stripeIntegrationStatus,
    loadShippingEntries: defaultLoadShippingEntries,
    shippingStatus: stripeShippingRatesStatus,
  });
}
