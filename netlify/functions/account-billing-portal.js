// POST /api/account/billing-portal — open the Stripe Customer Portal so an approved buyer can
// add / remove saved payment methods and view receipts. SAQ-A safe: no card data touches our pages.
// Lazily creates a Stripe customer for the company on first use and stores companies.stripe_customer_id.
import Stripe from 'stripe';
import { adminClient, userFromRequest, companyForUser, json } from '../lib/supabase.js';

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const { user } = await userFromRequest(req);
  if (!user) return json(401, { error: 'unauthenticated' });

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return json(500, { error: 'stripe_not_configured' });

  const sb = adminClient();
  const companyId = await companyForUser(sb, user.id);
  if (!companyId) return json(403, { error: 'no_company' });

  const { data: company } = await sb
    .from('companies').select('id,name,stripe_customer_id').eq('id', companyId).maybeSingle();
  if (!company) return json(404, { error: 'no_company' });

  const stripe = new Stripe(secret);
  let customerId = company.stripe_customer_id;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email || undefined,
      name: company.name || undefined,
      metadata: { company_id: companyId },
    });
    customerId = customer.id;
    await sb.from('companies').update({ stripe_customer_id: customerId }).eq('id', companyId);
  }

  const appUrl = process.env.APP_URL || `https://${req.headers.get('host')}`;
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appUrl}/dashboard.html#payment`,
  });

  return json(200, { url: session.url });
};

export const config = { path: '/api/account/billing-portal' };
