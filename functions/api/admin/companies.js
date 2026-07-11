// /api/admin/companies — staff account management / approval gate.
//   GET ?status= → companies (+ members)
//   POST { id | ids:[...], action } → create_company|update_company|delete_company|approve|reject|suspend|set_terms
import { adminClient, requireStaff, json, readBody } from '../../_lib/supabase.js';
import { buildCompanySetup } from '../../_lib/setup.js';
import { recordAudit } from '../../_lib/audit.js';
import { staffCan } from '../../_lib/authz.js';
import { parsePage, pageEnvelope } from '../../_lib/paginate.js';
import { escapeLike } from '../../_lib/crm.js';

const PRICE_TIERS = ['retail', 'hvac', 'wholesale'];
const STATUSES = ['pending', 'approved', 'rejected', 'suspended'];
const ENTITY_TYPES = ['llc', 'c_corp', 's_corp', 'partnership', 'sole_prop', 'nonprofit', 'government', 'other'];
const INDUSTRIES = ['hvac', 'facilities', 'marine', 'food_bev', 'manufacturing', 'municipal', 'distributor', 'other'];
const VOLUME_BANDS = ['under_10k', '10k_50k', '50k_250k', '250k_plus'];
const NET_TERM_OPTIONS = [0, 15, 30, 45, 60];

function isMissingColumn(error) {
  const code = error?.code || '';
  const msg = String(error?.message || '');
  return code === '42703' || code === 'PGRST204' || /column .* does not exist|could not find/i.test(msg);
}

function trimTo(value, max) {
  if (value === undefined) return undefined;
  const text = String(value || '').trim();
  return text ? text.slice(0, max) : null;
}

function cleanUrl(value) {
  if (value === undefined) return undefined;
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol)) return undefined;
    return url.href.slice(0, 500);
  } catch {
    return undefined;
  }
}

function pickFromSet(value, allowed) {
  if (value === undefined) return undefined;
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;
  return allowed.includes(text) ? text : undefined;
}

function numberPatch(body, key, parser = Number) {
  if (body[key] === undefined) return undefined;
  const value = parser(body[key]);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function buildCompanyPatch(body, { creating = false } = {}) {
  const patch = {};
  const set = (key, value) => { if (value !== undefined) patch[key] = value; };

  if (creating || body.name !== undefined) {
    const name = String(body.name || '').trim();
    if (name.length < 2) return { error: 'company_name_required' };
    patch.name = name.slice(0, 200);
  }
  if (body.status !== undefined) {
    const status = pickFromSet(body.status, STATUSES);
    if (status === undefined) return { error: 'invalid_status' };
    patch.status = status || 'pending';
  } else if (creating) patch.status = 'pending';
  if (body.net_terms_days !== undefined) patch.net_terms_days = numberPatch(body, 'net_terms_days', (v) => parseInt(v, 10));
  if (body.credit_limit !== undefined) patch.credit_limit = numberPatch(body, 'credit_limit');
  if (body.tax_exempt !== undefined) patch.tax_exempt = Boolean(body.tax_exempt);
  if (body.price_tier !== undefined) {
    if (!PRICE_TIERS.includes(body.price_tier)) return { error: 'invalid_tier' };
    patch.price_tier = body.price_tier;
  }

  set('legal_name', trimTo(body.legal_name, 200));
  set('dba', trimTo(body.dba, 200));
  set('tax_id', trimTo(body.tax_id, 40));
  set('business_phone', trimTo(body.business_phone, 40));
  set('contact_name', trimTo(body.contact_name, 160));
  set('contact_title', trimTo(body.contact_title, 120));
  if (body.business_email !== undefined) {
    const email = String(body.business_email || '').trim().toLowerCase();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'invalid_business_email' };
    patch.business_email = email || null;
  }
  if (body.website !== undefined) {
    const website = cleanUrl(body.website);
    if (website === undefined) return { error: 'invalid_website' };
    patch.website = website;
  }
  if (body.entity_type !== undefined) {
    const entityType = pickFromSet(body.entity_type, ENTITY_TYPES);
    if (entityType === undefined) return { error: 'invalid_entity_type' };
    patch.entity_type = entityType;
  }
  if (body.industry !== undefined) {
    const industry = pickFromSet(body.industry, INDUSTRIES);
    if (industry === undefined) return { error: 'invalid_industry' };
    patch.industry = industry;
  }
  if (body.est_annual_volume !== undefined) {
    const volume = pickFromSet(body.est_annual_volume, VOLUME_BANDS);
    if (volume === undefined) return { error: 'invalid_volume' };
    patch.est_annual_volume = volume;
  }
  if (body.requested_net_terms !== undefined) {
    const n = parseInt(body.requested_net_terms, 10);
    if (!NET_TERM_OPTIONS.includes(n)) return { error: 'invalid_net_terms' };
    patch.requested_net_terms = n;
  }
  if (creating && patch.submitted_at === undefined) patch.submitted_at = new Date().toISOString();
  return { patch };
}

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
      .select('id,name,status,net_terms_days,credit_limit,tax_exempt,price_tier,resale_cert_url,stripe_customer_id,created_at,profiles!profiles_company_id_fkey(id,full_name,phone,role)', { count: 'exact' })
      .order('created_at', { ascending: false }).range(offset, offset + limit - 1);
    if (status) q = q.eq('status', status);
    // Server-side name search so an account past the loaded page is still findable.
    const search = String(params.get('search') || '').trim();
    if (search) q = q.ilike('name', `%${escapeLike(search)}%`);
    const { data, error, count } = await q;
    if (error) return json(500, { error: error.message });
    return json(200, { companies: (data || []).map((company) => ({ ...company, setup: buildCompanySetup(company) })), ...pageEnvelope(data, { limit, offset, count }) });
  }

  if (request.method === 'POST') {
    if (!staffCan(role, 'company.credit')) return json(403, { error: 'forbidden', message: 'Company approval, credit limits and terms require finance or owner access.' });
    const body = await readBody(request);
    const action = String(body.action || '').trim();

    if (action === 'create_company') {
      const built = buildCompanyPatch(body, { creating: true });
      if (built.error) return json(400, { error: built.error });
      const full = built.patch;
      const base = {
        name: full.name,
        status: full.status || 'pending',
        net_terms_days: full.net_terms_days || 0,
        credit_limit: full.credit_limit || 0,
        tax_exempt: Boolean(full.tax_exempt),
        price_tier: full.price_tier || 'retail',
      };
      const selectCols = 'id,name,status,net_terms_days,credit_limit,tax_exempt,price_tier';
      let { data, error } = await sb.from('companies').insert({ ...base, ...full }).select(selectCols).single();
      if (error && isMissingColumn(error)) {
        ({ data, error } = await sb.from('companies').insert(base).select(selectCols).single());
      }
      if (error) return json(500, { error: error.message || 'company_create_failed' });
      await recordAudit(sb, { user, action: 'company.create', targetType: 'company', targetId: data.id, detail: base });
      return json(200, { ok: true, company: data });
    }

    if (action === 'update_company') {
      const id = String(body.id || '').trim();
      if (!id) return json(400, { error: 'company_id_required' });
      const built = buildCompanyPatch(body);
      if (built.error) return json(400, { error: built.error });
      if (!Object.keys(built.patch).length) return json(400, { error: 'nothing_to_update' });
      const selectCols = 'id,name,status,net_terms_days,credit_limit,tax_exempt,price_tier';
      let { data, error } = await sb.from('companies').update(built.patch).eq('id', id).select(selectCols).maybeSingle();
      if (error && isMissingColumn(error)) {
        const fallback = Object.fromEntries(Object.entries(built.patch).filter(([key]) => ['name', 'status', 'net_terms_days', 'credit_limit', 'tax_exempt', 'price_tier'].includes(key)));
        ({ data, error } = await sb.from('companies').update(fallback).eq('id', id).select(selectCols).maybeSingle());
      }
      if (error) return json(500, { error: error.message || 'company_update_failed' });
      if (!data) return json(404, { error: 'company_not_found' });
      await recordAudit(sb, { user, action: 'company.update', targetType: 'company', targetId: id, detail: built.patch });
      return json(200, { ok: true, company: data });
    }

    if (action === 'delete_company') {
      const id = String(body.id || '').trim();
      if (!id) return json(400, { error: 'company_id_required' });
      const [memberRes, orderRes] = await Promise.all([
        sb.from('profiles').select('id', { count: 'exact', head: true }).eq('company_id', id),
        sb.from('orders').select('id', { count: 'exact', head: true }).eq('company_id', id).neq('status', 'cart'),
      ]);
      if ((memberRes.count || 0) > 0 || (orderRes.count || 0) > 0) {
        return json(409, { error: 'company_not_empty', message: 'Remove users from this business and preserve any order history before deleting it.' });
      }
      const { data, error } = await sb.from('companies').delete().eq('id', id).select('id,name').maybeSingle();
      if (error) return json(500, { error: error.message || 'company_delete_failed' });
      if (!data) return json(404, { error: 'company_not_found' });
      await recordAudit(sb, { user, action: 'company.delete', targetType: 'company', targetId: id, detail: { name: data.name } });
      return json(200, { ok: true, company: data });
    }

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
      if (!PRICE_TIERS.includes(body.price_tier)) return json(400, { error: 'invalid_tier' });
      patch.price_tier = body.price_tier;
    }

    const selectCols = 'id,name,status,net_terms_days,credit_limit,tax_exempt,price_tier';
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
