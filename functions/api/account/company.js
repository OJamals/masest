// POST /api/account/company - self-scoped company setup fields for the caller's account.
import { requireCompany, json, readBody } from '../../_lib/supabase.js';

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
  const ctx = await requireCompany(request, env);
  if (ctx.error) return ctx.error;
  const { companyId, sb } = ctx;

  const body = await readBody(request);
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
    .eq('id', companyId)
    .select('id,tax_exempt,resale_cert_url')
    .maybeSingle();
  if (error) return json(500, { error: 'server_error' });
  return json(200, { ok: true, company: data });
}
