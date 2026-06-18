// /api/admin/companies — staff account management / approval gate.
//   GET ?status= → companies (+ members)
//   POST { id | ids:[...], action } → approve|reject|suspend|set_terms (single or bulk)
import { adminClient, requireStaff, json, readBody } from '../../_lib/supabase.js';

function setupStep(key, label, done, detail) {
  return { key, label, done: Boolean(done), detail };
}

function buildCompanySetup(company) {
  const profiles = company?.profiles || [];
  const approved = company?.status === 'approved';
  const hasProfile = profiles.some((profile) => profile.full_name && profile.phone);
  const hasTaxFile = Boolean(company?.tax_exempt || company?.resale_cert_url);
  const hasPayment = Boolean(company?.stripe_customer_id);
  const hasNetTerms = approved && (company?.net_terms_days || 0) > 0;
  const steps = [
    { key: 'profile', label: 'Profile', done: hasProfile, detail: hasProfile ? 'buyer contact ready' : 'missing contact phone/name' },
    { key: 'approval', label: 'Approval', done: approved, detail: approved ? 'approved' : `status ${company?.status || 'pending'}` },
    { key: 'tax', label: 'Tax file', done: hasTaxFile, detail: hasTaxFile ? 'tax file ready' : 'no tax/resale file' },
    { key: 'payment', label: 'Payment', done: hasPayment, detail: hasPayment ? 'Stripe customer ready' : 'no Stripe customer' },
    { key: 'net_terms', label: 'NET terms', done: hasNetTerms, detail: hasNetTerms ? `NET-${company.net_terms_days}` : 'terms not enabled' },
  ];
  const done = steps.filter((step) => step.done).length;
  return { done, total: steps.length, percent: Math.round((done / steps.length) * 100), steps };
}

export async function onRequest({ request, env }) {
  const { user, staff } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });

  const sb = adminClient(env);

  if (request.method === 'GET') {
    const status = new URL(request.url).searchParams.get('status');
    let q = sb.from('companies')
      .select('id,name,status,net_terms_days,credit_limit,tax_exempt,price_tier,resale_cert_url,stripe_customer_id,created_at,profiles(id,full_name,phone,role)')
      .order('created_at', { ascending: false }).limit(500);
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) return json(500, { error: error.message });
    return json(200, { companies: (data || []).map((company) => ({ ...company, setup: buildCompanySetup(company) })) });
  }

  if (request.method === 'POST') {
    const body = await readBody(request);
    const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : (body.id ? [body.id] : []);
    if (!ids.length) return json(400, { error: 'company_id_required' });

    const patch = {};
    if (body.action === 'approve') {
      patch.status = 'approved';
      if (body.net_terms_days != null) patch.net_terms_days = Math.max(0, parseInt(body.net_terms_days, 10) || 0);
      if (body.credit_limit != null) patch.credit_limit = Math.max(0, Number(body.credit_limit) || 0);
    } else if (body.action === 'reject') { patch.status = 'rejected'; }
    else if (body.action === 'suspend') { patch.status = 'suspended'; }
    else if (body.action === 'set_terms') {
      if (body.net_terms_days != null) patch.net_terms_days = Math.max(0, parseInt(body.net_terms_days, 10) || 0);
      if (body.credit_limit != null) patch.credit_limit = Math.max(0, Number(body.credit_limit) || 0);
      if (body.tax_exempt != null) patch.tax_exempt = Boolean(body.tax_exempt);
    } else { return json(400, { error: 'invalid_action' }); }

    // Pricing tier is assignable on any mutating action.
    if (body.price_tier != null) {
      if (!['retail', 'hvac', 'wholesale'].includes(body.price_tier)) return json(400, { error: 'invalid_tier' });
      patch.price_tier = body.price_tier;
    }

    const { data, error } = await sb.from('companies').update(patch).in('id', ids)
      .select('id,name,status,net_terms_days,credit_limit,tax_exempt,price_tier');
    if (error) return json(500, { error: error.message });

    if (body.action === 'approve') {
      for (const company of data || []) {
        await sb.from('notifications').insert({
          company_id: company.id, type: 'account', title: 'Account approved',
          body: company.net_terms_days > 0
            ? `You're approved for online ordering and NET-${company.net_terms_days} terms.`
            : 'Your account is approved for online ordering.',
          link: '/dashboard.html',
        }).then(() => {}, () => {});
      }
    }
    return json(200, { ok: true, companies: data || [], company: (data || [])[0] || null, count: (data || []).length });
  }

  return json(405, { error: 'method_not_allowed' });
}
