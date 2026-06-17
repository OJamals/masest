// GET /api/order?session_id=cs_… — order summary for the confirmation page.
// Reads the Stripe Checkout Session directly (expand line_items), so it works the instant
// the buyer is redirected back — no dependency on the webhook having written the DB order yet.
import Stripe from 'stripe';
import { json } from '../_lib/supabase.js';

export async function onRequestGet({ request, env }) {
  const sessionId = new URL(request.url).searchParams.get('session_id');
  if (!sessionId) return json(400, { error: 'session_id_required' });

  const secret = env.STRIPE_SECRET_KEY;
  if (!secret) return json(500, { error: 'stripe_not_configured' });
  const stripe = new Stripe(secret, { httpClient: Stripe.createFetchHttpClient() });

  try {
    const s = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['line_items'] });
    const lines = (s.line_items?.data || []).map((li) => ({
      name: li.description,
      qty: li.quantity,
      amount_total: (li.amount_total ?? 0) / 100,
    }));
    return json(200, {
      email: s.customer_details?.email || s.customer_email || null,
      currency: (s.currency || 'usd').toUpperCase(),
      amount_total: (s.amount_total ?? 0) / 100,
      amount_subtotal: (s.amount_subtotal ?? 0) / 100,
      total_tax: (s.total_details?.amount_tax ?? 0) / 100,
      payment_status: s.payment_status,
      lines,
      shipping: s.shipping_details || null,
    }, { 'cache-control': 'no-store' });
  } catch (err) {
    return json(502, { error: 'stripe_error', detail: err?.message || String(err) });
  }
}
