// GET  /api/account/company - the caller's full business profile (for the registration form).
// POST /api/account/company - create/update the caller's business profile.
//
// Creating a business starts the admin VERIFICATION gate (status='pending'); staff approve it
// from the admin company detail drawer. Approval unlocks NET terms, programs, QuickBooks
// invoicing, and wholesale pricing. User accounts themselves never need approval.
import { adminClient, userFromRequest, json, readBody } from '../../_lib/supabase.js';

// Extended verification columns (added by supabase/schema-business-profile.sql). Selected and
// written defensively so the site keeps working if that migration has not been applied yet.
const BIZ_COLUMNS = 'legal_name,dba,entity_type,tax_id,business_phone,business_email,website,industry,est_annual_volume,requested_net_terms,contact_name,contact_title,submitted_at';

const ENTITY_TYPES = ['llc', 'c_corp', 's_corp', 'partnership', 'sole_prop', 'nonprofit', 'government', 'other'];
const INDUSTRIES = ['hvac', 'facilities', 'marine', 'food_bev', 'manufacturing', 'municipal', 'distributor', 'other'];
const VOLUME_BANDS = ['under_10k', '10k_50k', '50k_250k', '250k_plus'];
const NET_TERM_OPTIONS = [0, 15, 30, 45, 60];

// A Postgres/PostgREST "column does not exist" error (pre-migration). Lets writes fall back to
// the base columns so business creation still works before schema-business-profile.sql is run.
function isMissingColumn(error) {
  const code = error?.code || '';
  const msg = String(error?.message || '');
  return code === '42703' || code === 'PGRST204' || /column .* does not exist|could not find/i.test(msg);
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

function trimTo(value, max) {
  if (value === undefined) return undefined;
  const text = String(value || '').trim();
  return text ? text.slice(0, max) : null;
}

function pickFromSet(value, allowed) {
  if (value === undefined) return undefined;
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;
  return allowed.includes(text) ? text : undefined; // undefined => caller returns a 400
}

// Build the verification dossier patch from a request body. Only keys present in the body are
// returned, so create and update share one validator. Returns { patch } or { error }.
function buildBizPatch(body) {
  const patch = {};
  const set = (key, value) => { if (value !== undefined) patch[key] = value; };

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
    const v = pickFromSet(body.entity_type, ENTITY_TYPES);
    if (v === undefined) return { error: 'invalid_entity_type' };
    patch.entity_type = v;
  }
  if (body.industry !== undefined) {
    const v = pickFromSet(body.industry, INDUSTRIES);
    if (v === undefined) return { error: 'invalid_industry' };
    patch.industry = v;
  }
  if (body.est_annual_volume !== undefined) {
    const v = pickFromSet(body.est_annual_volume, VOLUME_BANDS);
    if (v === undefined) return { error: 'invalid_volume' };
    patch.est_annual_volume = v;
  }
  if (body.requested_net_terms !== undefined) {
    const n = parseInt(body.requested_net_terms, 10);
    if (!NET_TERM_OPTIONS.includes(n)) return { error: 'invalid_net_terms' };
    patch.requested_net_terms = n;
  }
  return { patch };
}

export async function onRequestGet({ request, env }) {
  const { user } = await userFromRequest(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  const sb = adminClient(env);

  const { data: profile } = await sb
    .from('profiles').select('id,company_id,role').eq('id', user.id).maybeSingle();
  if (!profile?.company_id) return json(200, { company: null, role: profile?.role || 'buyer' });

  // Try the full dossier; fall back to base columns pre-migration so the form still loads.
  let { data: company, error } = await sb
    .from('companies')
    .select(`id,name,status,net_terms_days,credit_limit,tax_exempt,resale_cert_url,rejection_reason,${BIZ_COLUMNS}`)
    .eq('id', profile.company_id).maybeSingle();
  if (error && isMissingColumn(error)) {
    ({ data: company } = await sb
      .from('companies')
      .select('id,name,status,net_terms_days,credit_limit,tax_exempt,resale_cert_url')
      .eq('id', profile.company_id).maybeSingle());
  } else if (error) {
    return json(500, { error: 'server_error' });
  }
  return json(200, { company: company || null, role: profile.role });
}

export async function onRequestPost({ request, env }) {
  const { user } = await userFromRequest(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  const sb = adminClient(env);
  const body = await readBody(request);

  const { data: profile, error: profileErr } = await sb
    .from('profiles')
    .select('id,company_id,role')
    .eq('id', user.id)
    .maybeSingle();
  if (profileErr) return json(500, { error: 'server_error' });
  if (!profile) return json(403, { error: 'no_profile' });

  const resaleCertUrl = body.resale_cert_url === undefined ? undefined : cleanUrl(body.resale_cert_url);
  if (resaleCertUrl === undefined && body.resale_cert_url !== undefined) return json(400, { error: 'invalid_resale_cert_url' });

  const { patch: bizPatch, error: bizErr } = buildBizPatch(body);
  if (bizErr) return json(400, { error: bizErr });

  // ---- create a new business (starts the verification gate) ----
  if (!profile.company_id) {
    const name = String(body.name || '').trim();
    if (name.length < 2) return json(400, { error: 'company_name_required' });

    const base = {
      name,
      status: 'pending',
      tax_exempt: Boolean(body.tax_exempt),
      resale_cert_url: resaleCertUrl === undefined ? null : resaleCertUrl,
    };
    const full = { ...base, ...bizPatch, submitted_at: new Date().toISOString() };

    let { data: company, error: coErr } = await sb
      .from('companies').insert(full).select('id,name,status,tax_exempt,resale_cert_url').single();
    if (coErr && isMissingColumn(coErr)) {
      // Pre-migration: persist what the base schema allows; the dossier is dropped until the
      // schema-business-profile.sql migration is applied.
      ({ data: company, error: coErr } = await sb
        .from('companies').insert(base).select('id,name,status,tax_exempt,resale_cert_url').single());
    }
    if (coErr) return json(500, { error: 'server_error' });

    const { error: linkErr } = await sb
      .from('profiles')
      .update({ company_id: company.id, role: 'admin' })
      .eq('id', user.id);
    if (linkErr) return json(500, { error: 'server_error' });
    return json(201, { ok: true, created: true, business_pending_approval: true, company });
  }

  // ---- update an existing business profile (editable while pending) ----
  const patch = { ...bizPatch };
  if (body.name !== undefined) {
    const name = String(body.name || '').trim();
    if (name.length < 2) return json(400, { error: 'company_name_required' });
    patch.name = name;
  }
  if (body.tax_exempt !== undefined) patch.tax_exempt = Boolean(body.tax_exempt);
  if (resaleCertUrl !== undefined) patch.resale_cert_url = resaleCertUrl;
  if (!Object.keys(patch).length) return json(400, { error: 'nothing_to_update' });

  // A REJECTED business that edits and resubmits (the form's button literally reads
  // "Update & resubmit") must re-enter the verification queue. Without this the patch
  // saved silently while status stayed 'rejected' — the banner never cleared, no staff
  // signal fired, and the company never reappeared in the admin pending queue. Only
  // rejected -> pending; never disturb an approved or already-pending company.
  const { data: current } = await sb
    .from('companies').select('status').eq('id', profile.company_id).maybeSingle();
  if (current?.status === 'rejected') {
    patch.status = 'pending';
    patch.submitted_at = new Date().toISOString();
  }

  let { data, error } = await sb
    .from('companies')
    .update(patch)
    .eq('id', profile.company_id)
    .select('id,tax_exempt,resale_cert_url')
    .maybeSingle();
  if (error && isMissingColumn(error)) {
    // Pre-migration: apply only the base columns the schema supports.
    const basePatch = {};
    if (patch.name !== undefined) basePatch.name = patch.name;
    if (patch.tax_exempt !== undefined) basePatch.tax_exempt = patch.tax_exempt;
    if (patch.resale_cert_url !== undefined) basePatch.resale_cert_url = patch.resale_cert_url;
    // status is a base column — carry the rejected->pending re-entry even pre-migration.
    if (patch.status !== undefined) basePatch.status = patch.status;
    if (!Object.keys(basePatch).length) return json(200, { ok: true, partial: true });
    ({ data, error } = await sb
      .from('companies').update(basePatch).eq('id', profile.company_id)
      .select('id,tax_exempt,resale_cert_url').maybeSingle());
  }
  if (error) return json(500, { error: 'server_error' });
  return json(200, { ok: true, company: data });
}
