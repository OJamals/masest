// POST /api/account/register — B2B registration.
// Requires an authenticated Supabase user (sign up first, send Bearer token).
// Creates a company in `pending` status (approval gate) and links the user as its admin.
// Body: { company: { name, tax_exempt?, resale_cert_url? }, profile: { full_name?, phone? } }
import { adminClient, userFromRequest, json, readBody } from '../lib/supabase.js';

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const { user } = await userFromRequest(req);
  if (!user) return json(401, { error: 'unauthenticated' });

  const body = await readBody(req);
  const company = body.company || {};
  const profile = body.profile || {};
  if (!company.name || String(company.name).trim().length < 2) {
    return json(400, { error: 'company_name_required' });
  }

  const sb = adminClient();

  // One company per user in Phase 1. Block double-registration.
  const { data: existing } = await sb
    .from('profiles').select('id,company_id').eq('id', user.id).maybeSingle();
  if (existing?.company_id) {
    return json(409, { error: 'already_registered', company_id: existing.company_id });
  }

  const { data: co, error: coErr } = await sb
    .from('companies')
    .insert({
      name: String(company.name).trim(),
      status: 'pending',
      tax_exempt: Boolean(company.tax_exempt),
      resale_cert_url: company.resale_cert_url || null,
    })
    .select('id,status')
    .single();
  if (coErr) return json(500, { error: coErr.message });

  const { error: pErr } = await sb.from('profiles').insert({
    id: user.id,
    company_id: co.id,
    role: 'admin', // first user of a company is its admin
    full_name: profile.full_name || null,
    phone: profile.phone || null,
  });
  if (pErr) return json(500, { error: pErr.message });

  return json(201, {
    company_id: co.id,
    status: co.status,
    message: 'Registration received. Account pending approval before NET terms or checkout.',
  });
};

export const config = { path: '/api/account/register' };
