// /api/programs/subscribe — VertKleen service programs as Stripe subscriptions.
//   GET            → { subscriptions: [...] } for the caller's company
//   POST { tier }  → Stripe subscription Checkout Session for that tier → { url }
// Tier→price mapping is the PROGRAM_PRICES env var (JSON, e.g. {"Gold":"price_123"}). If a tier
// has no price, returns 409 {fallback:true} so the client falls back to the request-enrollment flow.
import Stripe from 'stripe';
import { adminClient, userFromRequest, companyForUser, json, readBody } from '../../_lib/supabase.js';
import { subscribeAction } from '../../_lib/order-shape.js';

const TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum'];

export async function onRequest({ request, env }) {
  const { user } = await userFromRequest(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });

  const sb = adminClient(env);
  const companyId = await companyForUser(sb, user.id);
  if (!companyId) return json(403, { error: 'no_company' });

  if (request.method === 'GET') {
    const { data } = await sb.from('program_subscriptions')
      .select('tier,status,created_at,stripe_subscription_id').eq('company_id', companyId)
      .order('created_at', { ascending: false });
    return json(200, { subscriptions: data || [] });
  }

  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const body = await readBody(request);
  const tier = String(body.tier || '');
  if (!TIERS.includes(tier)) return json(400, { error: 'invalid_tier' });

  let prices = {};
  try { prices = JSON.parse(env.PROGRAM_PRICES || '{}'); } catch { prices = {}; }
  const priceId = prices[tier];
  if (!priceId) return json(409, { error: 'no_price', fallback: true, message: 'Online program pricing is not set up yet — request enrollment instead.' });

  const secret = env.STRIPE_SECRET_KEY;
  if (!secret) return json(500, { error: 'stripe_not_configured' });

  const { data: company } = await sb.from('companies')
    .select('id,name,status,stripe_customer_id').eq('id', companyId).maybeSingle();
  if (!company || company.status !== 'approved') {
    return json(403, { error: 'not_approved', message: 'Your account must be approved before starting a program.' });
  }

  const stripe = new Stripe(secret);
  let customerId = company.stripe_customer_id;
  if (!customerId) {
    const cu = await stripe.customers.create({ email: user.email || undefined, name: company.name || undefined, metadata: { company_id: companyId } });
    customerId = cu.id;
    await sb.from('companies').update({ stripe_customer_id: customerId }).eq('id', companyId);
  }

  // If the company already has a live subscription, swap the price on it in place
  // (proration applied) rather than creating a second subscription — the latter would
  // double-bill. First-time enrollment (or only stale/canceled rows) falls through to checkout.
  // ponytail: newest row wins; a re-enrollment after cancel reads the canceled row and
  // correctly falls through to checkout (canceled ∉ live statuses).
  const { data: existing } = await sb.from('program_subscriptions')
    .select('id,tier,status,stripe_subscription_id').eq('company_id', companyId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  const verdict = subscribeAction(existing, tier);
  if (verdict.action === 'unchanged') return json(200, { unchanged: true, tier });
  if (verdict.action === 'swap') {
    const sub = await stripe.subscriptions.retrieve(verdict.subscriptionId);
    const itemId = sub.items?.data?.[0]?.id;
    if (!itemId) return json(502, { error: 'subscription_item_missing' });
    await stripe.subscriptions.update(verdict.subscriptionId, {
      items: [{ id: itemId, price: priceId }],
      proration_behavior: 'create_prorations',
      metadata: { company_id: companyId, tier },
    });
    await sb.from('program_subscriptions').update({ tier }).eq('id', existing.id);
    return json(200, { swapped: true, tier });
  }

  const appUrl = String(env.APP_URL || '').replace(/\/+$/, '');
  if (!appUrl) return json(500, { error: 'app_url_not_configured' });
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appUrl}/business.html?program=success`,
    cancel_url: `${appUrl}/business.html`,
    metadata: { company_id: companyId, tier },
    subscription_data: { metadata: { company_id: companyId, tier } },
  });
  // Placeholder so the user sees a pending program immediately, and so the webhook can
  // promote this exact row (matched by checkout session id) instead of racing or duplicating.
  await sb.from('program_subscriptions').insert({
    company_id: companyId, tier, stripe_customer_id: customerId,
    stripe_checkout_session_id: session.id, status: 'checkout',
  }).then(() => {}, () => {});
  return json(200, { url: session.url });
}
