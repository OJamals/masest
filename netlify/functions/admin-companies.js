// /api/admin/companies — staff account management / approval gate.
//   GET ?status=            → { companies: [...] } (with member count)
//   POST { id, action }     → action: 'approve' | 'reject' | 'suspend' | 'set_terms'
//        approve   : status=approved (+ net_terms_days, credit_limit if provided)
//        set_terms : update net_terms_days / credit_limit / tax_exempt only
//        reject    : status=rejected     suspend: status=suspended
import { adminClient, requireStaff, json, readBody } from '../lib/supabase.js';

export default async (req) => {
  const { user, staff } = await requireStaff(req);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });

  const sb = adminClient();

  if (req.method === 'GET') {
    const status = new URL(req.url).searchParams.get('status');
    let q = sb
      .from('companies')
      .select('id,name,status,net_terms_days,credit_limit,tax_exempt,resale_cert_url,stripe_customer_id,created_at,profiles(id,full_name,phone,role)')
      .order('created_at', { ascending: false })
      .limit(500);
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) return json(500, { error: error.message });
    return json(200, { companies: data || [] });
  }

  if (req.method === 'POST') {
    const body = await readBody(req);
    if (!body.id) return json(400, { error: 'company_id_required' });

    const patch = {};
    if (body.action === 'approve') {
      patch.status = 'approved';
      if (body.net_terms_days != null) patch.net_terms_days = Math.max(0, parseInt(body.net_terms_days, 10) || 0);
      if (body.credit_limit != null) patch.credit_limit = Math.max(0, Number(body.credit_limit) || 0);
    } else if (body.action === 'reject') {
      patch.status = 'rejected';
    } else if (body.action === 'suspend') {
      patch.status = 'suspended';
    } else if (body.action === 'set_terms') {
      if (body.net_terms_days != null) patch.net_terms_days = Math.max(0, parseInt(body.net_terms_days, 10) || 0);
      if (body.credit_limit != null) patch.credit_limit = Math.max(0, Number(body.credit_limit) || 0);
      if (body.tax_exempt != null) patch.tax_exempt = Boolean(body.tax_exempt);
    } else {
      return json(400, { error: 'invalid_action' });
    }

    const { data, error } = await sb
      .from('companies').update(patch).eq('id', body.id)
      .select('id,name,status,net_terms_days,credit_limit,tax_exempt').single();
    if (error) return json(500, { error: error.message });

    if (body.action === 'approve') {
      await sb.from('notifications').insert({
        company_id: body.id, type: 'account',
        title: 'Account approved',
        body: data.net_terms_days > 0
          ? `You're approved for online ordering and NET-${data.net_terms_days} terms.`
          : 'Your account is approved for online ordering.',
        link: '/dashboard.html',
      }).then(() => {}, () => {});
    }
    return json(200, { ok: true, company: data });
  }

  return json(405, { error: 'method_not_allowed' });
};

export const config = { path: '/api/admin/companies' };
