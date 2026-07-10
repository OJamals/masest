// GET /api/order?session_id=cs_… — order summary for the confirmation page.
// Reads the Stripe Checkout Session directly (expand line_items), so it works the instant
// the buyer is redirected back — no dependency on the webhook having written the DB order yet.
import Stripe from 'stripe';
import { json } from '../_lib/supabase.js';

const RESPONSE_HEADERS = {
  'cache-control': 'private, no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};

function response(status, body) {
  return json(status, body, RESPONSE_HEADERS);
}

export function maskEmail(email) {
  const value = String(email || '').trim();
  const at = value.lastIndexOf('@');
  if (at < 1 || at === value.length - 1) return null;
  return `${value[0]}•••@${value.slice(at + 1)}`;
}

export async function onRequestGet({ request, env }) {
  const sessionId = new URL(request.url).searchParams.get('session_id');
  if (!sessionId) return response(400, { error: 'session_id_required' });

  const secret = env.STRIPE_SECRET_KEY;
  if (!secret) return response(500, { error: 'stripe_not_configured' });
  const stripe = new Stripe(secret, { httpClient: Stripe.createFetchHttpClient() });

  try {
    const s = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['line_items'] });
    if (s.status !== 'complete') return response(404, { error: 'order_not_found' });
    const lines = (s.line_items?.data || []).map((li) => ({
      name: li.description,
      qty: li.quantity,
      amount_total: (li.amount_total ?? 0) / 100,
    }));
    return response(200, {
      email_hint: maskEmail(s.customer_details?.email || s.customer_email),
      currency: (s.currency || 'usd').toUpperCase(),
      amount_total: (s.amount_total ?? 0) / 100,
      amount_subtotal: (s.amount_subtotal ?? 0) / 100,
      total_tax: (s.total_details?.amount_tax ?? 0) / 100,
      payment_status: s.payment_status,
      lines,
    });
  } catch {
    return response(404, { error: 'order_not_found' });
  }
}
