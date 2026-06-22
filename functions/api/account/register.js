// POST /api/account/register — B2B registration.
// Requires an authenticated Supabase user (sign up first, send Bearer token).
// Creates a company in `pending` status (approval gate) and links the user as its admin.
// Body: { company: { name, tax_exempt?, resale_cert_url? }, profile: { full_name?, phone? } }
import { adminClient, userFromRequest, json, readBody } from '../../_lib/supabase.js';

export async function onRequestPost({ request, env }) {
  const { user } = await userFromRequest(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });

  const body = await readBody(request);
  const company = body.company || {};
  const profile = body.profile || {};
  const sb = adminClient(env);

  // Block double-registration.
  const { data: existing } = await sb
    .from('profiles').select('id,company_id').eq('id', user.id).maybeSingle();
  if (existing?.company_id) {
    return json(409, { error: 'already_registered', company_id: existing.company_id });
  }

  // Invite-aware: if this email was invited to a company, join it (role from the invite) instead
  // of creating a new company. The inviting admin's company owns the relationship.
  const { data: invites } = await sb
    .from('company_invites')
    .select('id,company_id,role')
    .eq('email', String(user.email || '').toLowerCase())
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1);
  const invite = invites?.[0];
  if (invite) {
    const { error: jErr } = await sb.from('profiles').insert({
      id: user.id, company_id: invite.company_id, role: invite.role || 'buyer',
      full_name: profile.full_name || null, phone: profile.phone || null,
    });
    if (jErr) { console.error('register_join_failed', jErr.message); return json(500, { error: 'server_error' }); }
    await sb.from('company_invites').update({ status: 'accepted' }).eq('id', invite.id);
    return json(201, { company_id: invite.company_id, joined: true, message: 'You’ve joined your team. Account ready.' });
  }

  // New company path: requires a company name.
  if (!company.name || String(company.name).trim().length < 2) {
    return json(400, { error: 'company_name_required' });
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
  if (coErr) { console.error('register_company_failed', coErr.message); return json(500, { error: 'server_error' }); }

  const { error: pErr } = await sb.from('profiles').insert({
    id: user.id,
    company_id: co.id,
    role: 'admin', // first user of a company is its admin
    full_name: profile.full_name || null,
    phone: profile.phone || null,
  });
  if (pErr) { console.error('register_profile_failed', pErr.message); return json(500, { error: 'server_error' }); }

  return json(201, {
    company_id: co.id,
    status: co.status,
    message: 'Registration received. Account pending approval before NET terms or checkout.',
  });
}
