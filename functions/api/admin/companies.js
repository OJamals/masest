// /api/admin/companies — staff account management / approval gate.
//   GET ?status= → companies (+ members)
//   POST { id | ids:[...], action } → approve|reject|suspend|set_terms (single or bulk)
import { adminClient, requireStaff, json, readBody } from '../../_lib/supabase.js';
import { buildCompanySetup } from '../../_lib/setup.js';
import { recordAudit } from '../../_lib/audit.js';
import { staffCan } from '../../_lib/authz.js';
import { parsePage, pageEnvelope } from '../../_lib/paginate.js';

export async function onRequest({ request, env }) {
  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });

  const sb = adminClient(env);

  if (request.method === 'GET') {
    const params = new URL(request.url).searchParams;
    const status = params.get('status');
    const { limit, offset } = parsePage(params, { defaultLimit: 100, maxLimit: 500 });
    let q = sb.from('companies')
      .select('id,name,status,net_terms_days,credit_limit,tax_exempt,price_tier,resale_cert_url,stripe_customer_id,created_at,profiles(id,full_name,phone,role)', { count: 'exact' })
      .order('created_at', { ascending: false }).range(offset, offset + limit - 1);
    if (status) q = q.eq('status', status);
    const { data, error, count } = await q;
    if (error) return json(500, { error: error.message });
    return json(200, { companies: (data || []).map((company) => ({ ...company, setup: buildCompanySetup(company) })), ...pageEnvelope(data, { limit, offset, count }) });
  }

  if (request.method === 'POST') {
    if (!staffCan(role, 'company.credit')) return json(403, { error: 'forbidden', message: 'Company approval, credit limits and terms require finance or owner access.' });
    const body = await readBody(request);
    const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : (body.id ? [body.id] : []);
    if (!ids.length) return json(400, { error: 'company_id_required' });

    const patch = {};
    // Verification stamps (schema-business-profile.sql). Applied opportunistically — the
    // update below retries without them if that migration has not run yet, so approve/reject
    // never breaks pre-migration.
    const stamps = {};
    if (body.action === 'approve') {
      patch.status = 'approved';
      stamps.verified_at = new Date().toISOString();
      stamps.verified_by = user.id;
      stamps.rejection_reason = null;
      if (body.net_terms_days != null) patch.net_terms_days = Math.max(0, parseInt(body.net_terms_days, 10) || 0);
      if (body.credit_limit != null) patch.credit_limit = Math.max(0, Number(body.credit_limit) || 0);
    } else if (body.action === 'reject') {
      patch.status = 'rejected';
      if (body.reason != null) stamps.rejection_reason = String(body.reason).trim().slice(0, 500) || null;
    }
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

    const selectCols = 'id,name,status,net_terms_days,credit_limit,tax_exempt,price_tier';
    const isMissingColumn = (e) => e?.code === '42703' || e?.code === 'PGRST204' || /column .* does not exist|could not find/i.test(String(e?.message || ''));
    let { data, error } = await sb.from('companies').update({ ...patch, ...stamps }).in('id', ids).select(selectCols);
    if (error && isMissingColumn(error)) {
      ({ data, error } = await sb.from('companies').update(patch).in('id', ids).select(selectCols));
    }
    if (error) return json(500, { error: error.message });

    if (body.action === 'approve') {
      for (const company of data || []) {
        await sb.from('notifications').insert({
          company_id: company.id, type: 'account', title: 'Business approved',
          body: company.net_terms_days > 0
            ? `Your business is verified — online ordering and NET-${company.net_terms_days} terms are unlocked.`
            : 'Your business is verified — online ordering is unlocked.',
          link: '/dashboard.html#business',
        }).then(() => {}, () => {});
      }
    } else if (body.action === 'reject') {
      for (const company of data || []) {
        await sb.from('notifications').insert({
          company_id: company.id, type: 'account', title: 'Business needs attention',
          body: (stamps.rejection_reason ? `We couldn’t verify your business: ${stamps.rejection_reason} ` : 'We couldn’t verify your business yet. ') + 'Update your details and resubmit.',
          link: '/dashboard.html#business',
        }).then(() => {}, () => {});
      }
    }
    await recordAudit(sb, { user, action: `company.${body.action}`, targetType: 'company', targetId: ids.join(','), detail: patch });
    return json(200, { ok: true, companies: data || [], company: (data || [])[0] || null, count: (data || []).length });
  }

  return json(405, { error: 'method_not_allowed' });
}
