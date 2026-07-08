// functions/api/admin/reviews.js — staff moderation for product_reviews.
// Staff guard copied verbatim from sibling admin endpoints (functions/api/admin/quotes.js,
// coupons.js, offers.js): requireStaff() from _lib/supabase.js resolves { user, staff, role },
// then staffCanWrite(role) gates mutations so read_only staff can view but never change data.
import { adminClient, requireStaff, json, readBody } from '../../_lib/supabase.js';
import { staffCanWrite } from '../../_lib/authz.js';
import { validateReviewInput } from '../../_lib/reviews.js';

const REVIEW_SELECT = 'id,kind,sku,rating,title,body,author_name,author_email,verified_purchase,source,status,staff_note,created_at';

export async function onRequestGet({ request, env }) {
  const { user, staff } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });

  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'pending';
  const sb = adminClient(env);
  let q = sb.from('product_reviews')
    .select(REVIEW_SELECT)
    .order('created_at', { ascending: false }).limit(200);
  if (status !== 'all') q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return json(500, { error: 'load_failed' });
  return json(200, { ok: true, reviews: data || [] });
}

export async function onRequestPost({ request, env }) {
  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });
  if (!staffCanWrite(role)) return json(403, { error: 'forbidden', message: 'Read-only staff cannot make changes.' });

  const body = await readBody(request);
  const sb = adminClient(env);
  const now = new Date().toISOString();

  if (body.action === 'approve' || body.action === 'reject') {
    if (!body.id) return json(400, { error: 'missing_id' });
    const status = body.action === 'approve' ? 'approved' : 'rejected';
    const { error } = await sb.from('product_reviews')
      .update({ status, staff_note: body.staff_note || null, updated_at: now }).eq('id', body.id);
    return error ? json(500, { error: 'update_failed' }) : json(200, { ok: true });
  }

  if (body.action === 'edit') {
    if (!body.id) return json(400, { error: 'missing_id' });
    const patch = { updated_at: now };
    if (typeof body.title === 'string') patch.title = body.title.slice(0, 120);
    if (typeof body.body === 'string') patch.body = body.body.slice(0, 4000);
    if (typeof body.author_name === 'string') patch.author_name = body.author_name.slice(0, 80);
    const { error } = await sb.from('product_reviews').update(patch).eq('id', body.id);
    return error ? json(500, { error: 'update_failed' }) : json(200, { ok: true });
  }

  if (body.action === 'delete') {
    if (!body.id) return json(400, { error: 'missing_id' });
    const { error } = await sb.from('product_reviews').delete().eq('id', body.id);
    return error ? json(500, { error: 'delete_failed' }) : json(200, { ok: true });
  }

  if (body.action === 'create_seed') {
    const v = validateReviewInput(body || {});
    if (!v.ok) return json(400, { error: v.error });
    const { rating, sku, kind, title, body: text, author_name } = v.value;
    const { error } = await sb.from('product_reviews').insert({
      kind, sku, order_id: null, author_name: author_name || 'MASEST customer',
      author_email: String(body.author_email || 'seed@masest.co').toLowerCase(),
      rating, title: title || null, body: text || null,
      verified_purchase: true, source: 'staff_seed', status: 'approved',
    });
    return error ? json(500, { error: 'save_failed' }) : json(200, { ok: true });
  }

  return json(400, { error: 'bad_action' });
}
