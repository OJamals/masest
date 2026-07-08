// functions/api/reviews.js — public reviews list (GET) + submit (POST).
import { adminClient, userFromRequest, json, readBody } from '../_lib/supabase.js';
import { rateLimit, clientIp } from '../_lib/ratelimit.js';
import { klaviyoTrack } from '../_lib/klaviyo.js';
import {
  validateReviewInput, aggregateStats, findVerifiedOrderId, verifyReviewToken,
} from '../_lib/reviews.js';

const PAGE_SIZE = 10;
const reviewSecret = (env) => env.REVIEW_TOKEN_SECRET || env.EMAIL_UNSUB_SECRET || '';

// Shape a stored row for public consumption — strips email / user_id / order_id.
function publicRow(r) {
  return {
    author_name: r.author_name, rating: r.rating, title: r.title, body: r.body,
    verified_purchase: r.verified_purchase, created_at: r.created_at,
  };
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const sku = String(url.searchParams.get('sku') || '').trim();
  const kind = url.searchParams.get('kind') === 'service' ? 'service' : 'product';
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  if (!sku) return json(400, { error: 'missing_sku' });

  const sb = adminClient(env);
  // All approved rows for the aggregate (low volume); page the returned list.
  const { data, error } = await sb.from('product_reviews')
    .select('author_name,rating,title,body,verified_purchase,created_at')
    .eq('kind', kind).eq('sku', sku).eq('status', 'approved')
    .order('created_at', { ascending: false });
  if (error) return json(500, { error: 'load_failed' });

  const rows = data || [];
  const stats = aggregateStats(rows);
  const start = (page - 1) * PAGE_SIZE;
  const slice = rows.slice(start, start + PAGE_SIZE);
  return json(200, {
    ok: true, stats, reviews: slice.map(publicRow),
    page, hasMore: start + PAGE_SIZE < rows.length,
  });
}

export async function onRequestPost({ request, env }) {
  const ip = clientIp(request);
  // rateLimit() resolves { ok, disabled? } (fails open with disabled:true if no
  // RATE_KV binding), never a `{blocked}` shape — verified against _lib/ratelimit.js.
  const rl = await rateLimit(env, 'review', ip, { limit: 5, windowSec: 600 });
  if (!rl.ok) return json(429, { error: 'rate_limited' });

  const body = await readBody(request);
  const v = validateReviewInput(body || {});
  if (!v.ok) return json(400, { error: v.error });
  const { rating, sku, kind, title, body: text } = v.value;

  const sb = adminClient(env);
  let orderId = null;
  let email = '';
  let authorName = v.value.author_name;

  // Path B: signed email token authorizes exactly one order+sku+email (no login).
  if (body.token && body.order_id) {
    email = String(body.email || '').toLowerCase();
    const good = await verifyReviewToken({ orderId: body.order_id, sku, email }, body.token, reviewSecret(env));
    if (!good) return json(403, { error: 'not_verified_purchaser' });
    orderId = body.order_id;
  } else {
    // Path A: logged-in buyer — confirm a fulfilled/delivered order with this sku.
    // userFromRequest() always returns an object ({ user, token }); user is null
    // when unauthenticated — verified against _lib/supabase.js (never returns null itself).
    const { user } = await userFromRequest(request, env);
    if (!user) return json(401, { error: 'unauthenticated' });
    email = String(user.email || '').toLowerCase();
    const { data: orders } = await sb.from('orders')
      .select('id,status,tracking_status,order_items(sku,product_sku)')
      .eq('customer_email', email);
    orderId = findVerifiedOrderId(orders || [], sku);
    if (!orderId) return json(403, { error: 'not_verified_purchaser' });
    if (!authorName) {
      authorName = String(user.user_metadata?.full_name || email.split('@')[0] || '');
    }
  }
  if (!authorName) authorName = email.split('@')[0] || 'Verified buyer';

  const { error } = await sb.from('product_reviews').insert({
    kind, sku, order_id: orderId, author_name: authorName, author_email: email,
    rating, title: title || null, body: text || null,
    verified_purchase: true, source: 'customer', status: 'pending',
  });
  if (error) {
    if (String(error.code) === '23505') return json(409, { error: 'already_reviewed' });
    return json(500, { error: 'save_failed' });
  }
  await klaviyoTrack(env, { email, metric: 'Review Submitted', properties: { sku, kind, rating } }).catch(() => {});
  return json(200, { ok: true, pending: true });
}
