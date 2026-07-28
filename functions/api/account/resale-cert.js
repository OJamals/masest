// /api/account/resale-cert — a company's resale / tax-exemption certificate.
//   POST (multipart file)  → upload to the PRIVATE 'resale-certs' bucket, store the path
//   GET                    → a short-lived signed URL for the caller's own cert (or null)
//   DELETE                 → remove the stored certificate
// Company-scoped (requireCompany). The bucket is private; the object is never public —
// staff view it through their own signed-URL path (see /api/admin/company). Writes and
// signing use the service-role key, which bypasses storage RLS.
import { requireCompany, json } from '../../_lib/supabase.js';

const BUCKET = 'resale-certs';
const MAX_BYTES = 10 * 1024 * 1024;
// Compliance docs are PDFs or a photo/scan of one.
const ALLOWED = new Map([
  ['application/pdf', 'pdf'],
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
]);

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

async function signedUrl(env, path, expiresIn = 300) {
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${encodePath(path)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ expiresIn }),
  });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  if (!body?.signedURL) return null;
  // signedURL is a path relative to the storage API; make it absolute.
  return `${env.SUPABASE_URL}/storage/v1${body.signedURL}`;
}

export async function onRequestGet({ request, env }) {
  const ctx = await requireCompany(request, env);
  if (ctx.error) return ctx.error;
  const { companyId, sb } = ctx;
  const { data: company } = await sb.from('companies').select('resale_cert_path').eq('id', companyId).maybeSingle();
  const path = company?.resale_cert_path || null;
  if (!path) return json(200, { uploaded: false, url: null });
  const url = await signedUrl(env, path);
  return json(200, { uploaded: true, url });
}

export async function onRequestPost({ request, env }) {
  const ctx = await requireCompany(request, env);
  if (ctx.error) return ctx.error;
  const { companyId, role, sb } = ctx;
  if (role !== 'admin') return json(403, { error: 'company_admin_required' });

  let form;
  try { form = await request.formData(); } catch { return json(400, { error: 'expected_multipart' }); }
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') return json(400, { error: 'file_required' });
  const type = String(file.type || '').toLowerCase();
  if (!ALLOWED.has(type)) return json(400, { error: 'unsupported_type', message: 'Upload a PDF, PNG, JPG, or WEBP.' });
  if (file.size > MAX_BYTES) return json(400, { error: 'file_too_large', message: 'Keep the certificate under 10 MB.' });

  const ext = ALLOWED.get(type);
  // Company-scoped path; a fresh uuid per upload so a replacement never collides.
  const path = `${companyId}/cert-${crypto.randomUUID()}.${ext}`;
  const upload = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodePath(path)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      'content-type': type,
      'x-upsert': 'false',
    },
    body: await file.arrayBuffer(),
  });
  if (!upload.ok) return json(502, { error: 'upload_failed', detail: await upload.text().catch(() => '') });

  // Point the company at the new object, then best-effort delete the previous one.
  const { data: prev } = await sb.from('companies').select('resale_cert_path').eq('id', companyId).maybeSingle();
  const { error } = await sb.from('companies').update({ resale_cert_path: path }).eq('id', companyId);
  if (error) return json(500, { error: 'server_error' });
  if (prev?.resale_cert_path && prev.resale_cert_path !== path) {
    await fetch(`${env.SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodePath(prev.resale_cert_path)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: env.SUPABASE_SERVICE_ROLE_KEY },
    }).catch(() => {});
  }

  const url = await signedUrl(env, path);
  return json(200, { ok: true, uploaded: true, url });
}

export async function onRequestDelete({ request, env }) {
  const ctx = await requireCompany(request, env);
  if (ctx.error) return ctx.error;
  const { companyId, role, sb } = ctx;
  if (role !== 'admin') return json(403, { error: 'company_admin_required' });
  const { data: company } = await sb.from('companies').select('resale_cert_path').eq('id', companyId).maybeSingle();
  const path = company?.resale_cert_path || null;
  const { error } = await sb.from('companies').update({ resale_cert_path: null }).eq('id', companyId);
  if (error) return json(500, { error: 'server_error' });
  if (path) {
    await fetch(`${env.SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodePath(path)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: env.SUPABASE_SERVICE_ROLE_KEY },
    }).catch(() => {});
  }
  return json(200, { ok: true, uploaded: false });
}
