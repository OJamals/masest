// Server-only bridge. Identity is rechecked per request; CRM persistence is external.
import { connectedSalesTarget } from './connected-sales-route.js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ROLES = new Set(['owner', 'finance', 'support', 'read_only']);
const LIMIT = 1_200_000;
const encoder = new TextEncoder();
const json = (status, body) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const error = (status, code, message) => json(status, { error: { code, message } });

function config(env) {
  if (env.MASEST_CRM_ENABLED !== '1' || !UUID.test(env.MASEST_CRM_WORKSPACE_ID || '')
      || !/^[0-9a-f]{64}$/.test(env.MASEST_CRM_SIGNING_KEY || '')) return null;
  try {
    for (const value of [env.MASEST_CRM_ORIGIN, env.MASEST_CRM_ISSUER]) {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.origin !== value || url.port || url.username || url.password) return null;
    }
    return { origin: env.MASEST_CRM_ORIGIN, issuer: env.MASEST_CRM_ISSUER, workspace: env.MASEST_CRM_WORKSPACE_ID, key: env.MASEST_CRM_SIGNING_KEY };
  } catch { return null; }
}

export function connectedCrmConfigured(env) { return Boolean(config(env)); }

async function boundedBytes(stream, limit) {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader(); const chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new RangeError('body_limit'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

const base64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

export async function signCrmRequest(settings, staff, method, target, body) {
  const iat = Math.floor(Date.now() / 1000);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', body));
  const claims = {
    iss: settings.issuer, aud: settings.origin, sub: staff.user.id,
    workspace_id: settings.workspace, role: staff.role, iat, exp: iat + 30,
    method, target, body_sha256: [...digest].map((b) => b.toString(16).padStart(2, '0')).join(''),
  };
  const message = `v1.${base64url(encoder.encode(JSON.stringify(claims)))}`;
  const key = await crypto.subtle.importKey('raw', Uint8Array.from(settings.key.match(/../g), (h) => parseInt(h, 16)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
  return `${message}.${base64url(signature)}`;
}

export async function handleConnectedCrm({ request, env }, dependencies) {
  const settings = config(env);
  if (!settings) return error(503, 'crm_not_configured', 'MASEST CRM intake is not connected yet.');
  const origin = request.headers.get('Origin');
  if ((origin && origin !== settings.issuer) || new URL(request.url).origin !== settings.issuer) return error(403, 'origin_forbidden', 'Origin not permitted');
  let staff;
  try { staff = await dependencies.requireStaff(request, env); }
  catch { return error(503, 'identity_unavailable', 'Staff authorization is unavailable'); }
  if (!staff.user) return error(401, 'unauthenticated', 'Sign in to MASEST Admin');
  if (!staff.staff || !ROLES.has(staff.role) || !UUID.test(staff.user.id)) return error(403, 'forbidden', 'Platform staff access required');
  const { method } = request;
  if (!['GET', 'POST'].includes(method)) return error(405, 'method_not_allowed', 'Method not permitted');
  const params = new URL(request.url).searchParams;
  const resource = params.get('resource') || 'people';
  const isSales = resource.startsWith('sales_');
  const salesTarget = isSales ? connectedSalesTarget(params, method) : null;
  const personReview = ['person', 'contacts', 'evidence', 'assertions'].includes(resource);
  const pagedReview = personReview && resource !== 'person';
  const allowed = new Set(['resource', ...(personReview ? ['person_id'] : []),
    ...(resource === 'people' || pagedReview ? ['limit', 'cursor'] : []), ...(resource === 'people' ? ['q'] : [])]);
  if ((isSales && !salesTarget) || (!isSales && (!['context', 'people', 'imports', 'person', 'contacts', 'evidence', 'assertions'].includes(resource) || (method === 'POST' && resource !== 'imports') || (method === 'GET' && resource === 'imports')
      || (personReview && !UUID.test(params.get('person_id') || ''))
      || [...params.keys()].some((key) => !allowed.has(key) || params.getAll(key).length !== 1)
      || (params.has('limit') && (!/^\d+$/.test(params.get('limit')) || Number(params.get('limit')) < 1 || Number(params.get('limit')) > (pagedReview ? 50 : 100)))
      || (params.get('cursor') || '').length > 2000 || (params.get('q') || '').length > 200))) return error(422, 'validation_error', 'Invalid CRM query');
  if (method === 'POST' && (staff.role === 'read_only' || (resource === 'sales_pipelines' && staff.role !== 'owner'))) return error(403, 'forbidden', 'Staff role cannot perform this CRM action');
  if (method === 'POST' && request.headers.get('Content-Type')?.split(';')[0] !== 'application/json') return error(415, 'content_type', 'JSON request required');
  let body;
  try { body = await boundedBytes(request.body, LIMIT); }
  catch { return error(413, 'request_too_large', 'Request exceeds CRM limit'); }
  const query = new URLSearchParams();
  for (const key of ['limit', 'cursor', 'q']) if (params.has(key)) query.set(key, params.get(key));
  const path = personReview ? `/v1/people/${params.get('person_id')}${pagedReview ? '/' + resource : ''}` : `/v1/${resource}`;
  const target = salesTarget || `${path}${query.size ? `?${query}` : ''}`;
  try {
    const assertion = await signCrmRequest(settings, staff, method, target, body);
    const response = await (dependencies.fetch || fetch)(settings.origin + target, {
      method, body: method === 'POST' ? body : undefined, redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/json', 'X-MASEST-CRM-Assertion': assertion },
    });
    if (response.status >= 300 && response.status < 400) throw new Error('redirect');
    const bytes = await boundedBytes(response.body, 2_000_000);
    const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return json(response.status, result);
  } catch { return error(502, 'crm_unavailable', 'CRM response unavailable. Retry the same action to avoid duplicates.'); }
}
