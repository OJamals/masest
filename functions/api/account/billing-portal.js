// POST /api/account/billing-portal — Stripe Customer Portal for saved payment methods (SAQ-A safe).
// Lazily creates a Stripe customer for the company and stores companies.stripe_customer_id.
import Stripe from 'stripe';
import { adminClient, userFromRequest, companyForUser, json } from '../../_lib/supabase.js';

export async function onRequestPost({ request, env }) {
  const { user } = await userFromRequest(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });

  const secret = env.STRIPE_SECRET_KEY;
  if (!secret) return json(500, { error: 'stripe_not_configured' });

  const sb = adminClient(env);
  const companyId = await companyForUser(sb, user.id);
  if (!companyId) return json(403, { error: 'no_company' });

  const { data: company } = await sb
    .from('companies').select('id,name,stripe_customer_id').eq('id', companyId).maybeSingle();
  if (!company) return json(404, { error: 'no_company' });

  const stripe = new Stripe(secret);
  let customerId = company.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email || undefined, name: company.name || undefined, metadata: { company_id: companyId },
    });
    customerId = customer.id;
    await sb.from('companies').update({ stripe_customer_id: customerId }).eq('id', companyId);
  }

  const appUrl = env.APP_URL || new URL(request.url).origin;
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appUrl}/dashboard.html#payment`,
  });
  return json(200, { url: session.url });
}
