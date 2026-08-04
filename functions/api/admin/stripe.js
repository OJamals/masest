import { adminClient, requireStaff, json } from '../../_lib/supabase.js';
import { staffCan } from '../../_lib/authz.js';
import {
  qboStripeMappingStatus,
  stripePayoutReconciliation,
} from '../../_lib/stripe-payouts.js';
import { stripeIntegrationStatus, stripeShippingRatesStatus } from '../../_lib/stripe-runtime.js';

const NO_STORE = { 'cache-control': 'no-store' };
const PAYOUT_ERRORS = new Set([
  'stripe_live_key_required',
  'stripe_payout_response_invalid',
  'stripe_payouts_failed',
]);

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
  const payouts = dependencies.payouts || stripePayoutReconciliation;
  const mappingStatus = dependencies.mappingStatus || qboStripeMappingStatus;
  return async function stripeAdminHandler({ request, env }) {
    const payoutView = new URL(request.url).searchParams.get('view') === 'payouts';
    const privateHeaders = payoutView ? NO_STORE : undefined;
    const { user, staff, role } = await requireStaffImpl(request, env);
    if (!user) return json(401, { error: 'unauthenticated' }, privateHeaders);
    if (!staff) return json(403, { error: 'forbidden' }, privateHeaders);
    return handleStripeRequest({ request, env, role }, {
      status: statusImpl,
      loadShippingEntries,
      shippingStatus,
      payouts,
      mappingStatus,
    });
  };
}

async function handleStripeRequest({ request, env, role }, dependencies) {
  const url = new URL(request.url);
  const payoutView = url.searchParams.get('view') === 'payouts';
  if (request.method !== 'GET') return json(405, { error: 'method_not_allowed' }, payoutView ? NO_STORE : undefined);
  if (payoutView) {
    if (!staffCan(role, 'company.credit')) return json(403, { error: 'forbidden' }, NO_STORE);
    const parsedLimit = Number.parseInt(url.searchParams.get('limit'), 10);
    const limit = Number.isFinite(parsedLimit) ? Math.min(5, Math.max(1, parsedLimit)) : 3;
    try {
      const preview = await dependencies.payouts(env, { limit });
      return json(200, {
        ...preview,
        qbo_mapping: dependencies.mappingStatus(env),
      }, NO_STORE);
    } catch (error) {
      const code = PAYOUT_ERRORS.has(error?.code) ? error.code : 'stripe_payouts_failed';
      const status = error?.status === 400 ? 400 : 502;
      return json(status, { error: code }, NO_STORE);
    }
  }
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
  const payoutView = new URL(request.url).searchParams.get('view') === 'payouts';
  const privateHeaders = payoutView ? NO_STORE : undefined;
  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' }, privateHeaders);
  if (!staff) return json(403, { error: 'forbidden' }, privateHeaders);
  return handleStripeRequest({ request, env, role }, {
    status: stripeIntegrationStatus,
    loadShippingEntries: defaultLoadShippingEntries,
    shippingStatus: stripeShippingRatesStatus,
    payouts: stripePayoutReconciliation,
    mappingStatus: qboStripeMappingStatus,
  });
}
