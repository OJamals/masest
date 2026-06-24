// POST /api/account/company - create/update the caller's business profile.
import { adminClient, userFromRequest, json, readBody } from '../../_lib/supabase.js';

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

  if (!profile.company_id) {
    const name = String(body.name || '').trim();
    if (name.length < 2) return json(400, { error: 'company_name_required' });
    const resaleCertUrl = body.resale_cert_url === undefined ? null : cleanUrl(body.resale_cert_url);
    if (resaleCertUrl === undefined) return json(400, { error: 'invalid_resale_cert_url' });
    const { data: company, error: coErr } = await sb
      .from('companies')
      .insert({
        name,
        status: 'pending',
        tax_exempt: Boolean(body.tax_exempt),
        resale_cert_url: resaleCertUrl,
      })
      .select('id,name,status,tax_exempt,resale_cert_url')
      .single();
    if (coErr) return json(500, { error: 'server_error' });
    const { error: linkErr } = await sb
      .from('profiles')
      .update({ company_id: company.id, role: 'admin' })
      .eq('id', user.id);
    if (linkErr) return json(500, { error: 'server_error' });
    return json(201, { ok: true, created: true, company });
  }

  const patch = {};
  if (body.tax_exempt !== undefined) patch.tax_exempt = Boolean(body.tax_exempt);
  if (body.resale_cert_url !== undefined) {
    patch.resale_cert_url = cleanUrl(body.resale_cert_url);
    if (patch.resale_cert_url === undefined) return json(400, { error: 'invalid_resale_cert_url' });
  }
  if (!Object.keys(patch).length) return json(400, { error: 'nothing_to_update' });

  const { data, error } = await sb
    .from('companies')
    .update(patch)
    .eq('id', profile.company_id)
    .select('id,tax_exempt,resale_cert_url')
    .maybeSingle();
  if (error) return json(500, { error: 'server_error' });
  return json(200, { ok: true, company: data });
}
