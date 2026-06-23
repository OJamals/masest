// POST /api/account/billing-portal — Stripe Customer Portal for saved payment methods (SAQ-A safe).
// Lazily creates a Stripe customer for the company and stores companies.stripe_customer_id.
// Optional body { flow:'cancel'|'update', subscription:'sub_…' } deep-links the portal into the
// subscription cancel/update flow (self-serve program cancel/pause/tier-swap). Cancellation
// proration, pause, and plan-switch availability are set in the Stripe Dashboard portal
// *configuration* (one-time owner-op), not here.
import Stripe from 'stripe';
import { requireCompany, json, readBody } from '../../_lib/supabase.js';

// flow_data for a subscription cancel/update deep-link, or null for the portal landing page.
// Pure: the handler supplies a verified subscription id and the return url.
export function portalFlowData(flow, subscription, returnUrl) {
  if (!subscription) return null;
  const after_completion = { type: 'redirect', redirect: { return_url: returnUrl } };
  if (flow === 'cancel') return { type: 'subscription_cancel', subscription_cancel: { subscription }, after_completion };
  if (flow === 'update') return { type: 'subscription_update', subscription_update: { subscription }, after_completion };
  return null;
}

export async function onRequestPost({ request, env }) {
  const secret = env.STRIPE_SECRET_KEY;
  if (!secret) return json(500, { error: 'stripe_not_configured' });

  const ctx = await requireCompany(request, env);
  if (ctx.error) return ctx.error;
  const { user, companyId, sb } = ctx;

  const { data: company } = await sb
    .from('companies').select('id,name,stripe_customer_id').eq('id', companyId).maybeSingle();
  if (!company) return json(404, { error: 'no_company' });

  const body = await readBody(request).catch(() => ({}));

  const stripe = new Stripe(secret);
  let customerId = company.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email || undefined, name: company.name || undefined, metadata: { company_id: companyId },
    });
    customerId = customer.id;
    await sb.from('companies').update({ stripe_customer_id: customerId }).eq('id', companyId);
  }

  const appUrl = String(env.APP_URL || '').replace(/\/+$/, '');
  if (!appUrl) return json(500, { error: 'app_url_not_configured' });

  // Deep-link into the cancel/update flow only after confirming the subscription belongs to
  // this company (RLS-scoped read); otherwise fall back to the plain portal landing.
  let flowData = null;
  if (body?.subscription && (body.flow === 'cancel' || body.flow === 'update')) {
    const { data: owned } = await sb.from('program_subscriptions')
      .select('id').eq('company_id', companyId).eq('stripe_subscription_id', body.subscription).maybeSingle();
    if (owned) flowData = portalFlowData(body.flow, body.subscription, `${appUrl}/dashboard.html#programs`);
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appUrl}/dashboard.html#${flowData ? 'programs' : 'payment'}`,
    ...(flowData ? { flow_data: flowData } : {}),
  });
  return json(200, { url: session.url });
}
