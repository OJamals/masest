// GET /api/account/quotes — the authenticated caller's own quote requests.
// Matched by the email on the auth account: quote requests arrive through the
// public form, often before an account or company exists, so email is the join.
// Customer-safe fields only — internal triage data (priority, lead score, staff
// notes, deal value) never leaves this endpoint.
import { userFromRequest, adminClient, json } from '../../_lib/supabase.js';
import { parsePage, pageEnvelope } from '../../_lib/paginate.js';
import { escapeLike } from '../../_lib/crm.js';

// Internal status/pipeline stage → the state a customer should see.
function publicState(quote) {
  if (quote.pipeline_stage === 'won') return 'Quoted';
  if (quote.pipeline_stage === 'lost' || quote.status === 'closed') return 'Closed';
  if (quote.status === 'contacted' || (quote.pipeline_stage && quote.pipeline_stage !== 'new')) return 'In review';
  return 'Received';
}

export async function onRequestGet({ request, env }) {
  const { user } = await userFromRequest(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  const email = String(user.email || '').trim();
  if (!email) return json(200, { quotes: [] });

  const sb = adminClient(env);
  const { limit, offset } = parsePage(new URL(request.url).searchParams, { defaultLimit: 25, maxLimit: 100 });
  // ilike with escaped input = case-insensitive exact match (stored casing varies).
  const { data, error, count } = await sb.from('quotes')
    .select('id,created_at,type,product,industry,status,pipeline_stage', { count: 'exact' })
    .ilike('email', escapeLike(email))
    .neq('status', 'spam')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) {
    if (/does not exist|relation|schema cache/i.test(error.message)) return json(200, { quotes: [] });
    return json(500, { error: 'server_error' });
  }
  const quotes = (data || []).map((q) => ({
    id: q.id,
    created_at: q.created_at,
    type: q.type || 'quote',
    product: q.product || '',
    industry: q.industry || '',
    state: publicState(q),
  }));
  return json(200, { quotes, ...pageEnvelope(data, { limit, offset, count }) }, { 'cache-control': 'private, no-store' });
}
