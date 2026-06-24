// POST /api/account/register — user registration/profile bootstrap.
// Requires an authenticated Supabase user (sign up first, send Bearer token).
// A company is optional here. User accounts are active immediately; creating a
// company starts the separate business approval gate.
// Body: { company: { name, tax_exempt?, resale_cert_url? }, profile: { full_name?, phone? } }
import { adminClient, userFromRequest, json, readBody } from '../../_lib/supabase.js';

export async function onRequestPost({ request, env }) {
  const { user } = await userFromRequest(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });

  const body = await readBody(request);
  const company = body.company || {};
  const profile = body.profile || {};
  const companyName = String(company.name || '').trim();
  const sb = adminClient(env);

  // Block double-registration.
  const { data: existing } = await sb
    .from('profiles').select('id,company_id,role').eq('id', user.id).maybeSingle();
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
    const row = {
      company_id: invite.company_id,
      role: invite.role || 'buyer',
      full_name: profile.full_name || null,
      phone: profile.phone || null,
    };
    const write = existing
      ? sb.from('profiles').update(row).eq('id', user.id)
      : sb.from('profiles').insert({ id: user.id, ...row });
    const { error: jErr } = await write;
    if (jErr) { console.error('register_join_failed', jErr.message); return json(500, { error: 'server_error' }); }
    await sb.from('company_invites').update({ status: 'accepted' }).eq('id', invite.id);
    return json(201, { company_id: invite.company_id, joined: true, message: 'You’ve joined your team. Account ready.' });
  }

  // User-only path: allow any authenticated user to finish registration without
  // starting a business approval workflow.
  if (!companyName) {
    const row = {
      full_name: profile.full_name || null,
      phone: profile.phone || null,
    };
    const write = existing
      ? sb.from('profiles').update(row).eq('id', user.id)
      : sb.from('profiles').insert({ id: user.id, company_id: null, role: 'buyer', ...row });
    const { error: pErr } = await write;
    if (pErr) { console.error('register_profile_failed', pErr.message); return json(500, { error: 'server_error' }); }
    return json(201, {
      account_ready: true,
      needs_business: true,
      message: 'Account created. Set up a business profile when you are ready to request checkout access.',
    });
  }

  // New company path: creates a pending business that staff must approve.
  if (companyName.length < 2) {
    return json(400, { error: 'company_name_required' });
  }

  const { data: co, error: coErr } = await sb
    .from('companies')
    .insert({
      name: companyName,
      status: 'pending',
      tax_exempt: Boolean(company.tax_exempt),
      resale_cert_url: company.resale_cert_url || null,
    })
    .select('id,status')
    .single();
  if (coErr) { console.error('register_company_failed', coErr.message); return json(500, { error: 'server_error' }); }

  const profileRow = {
    company_id: co.id,
    role: 'admin', // first user of a company is its admin
    full_name: profile.full_name || null,
    phone: profile.phone || null,
  };
  const profileWrite = existing
    ? sb.from('profiles').update(profileRow).eq('id', user.id)
    : sb.from('profiles').insert({ id: user.id, ...profileRow });
  const { error: pErr } = await profileWrite;
  if (pErr) { console.error('register_profile_failed', pErr.message); return json(500, { error: 'server_error' }); }

  return json(201, {
    company_id: co.id,
    status: co.status,
    account_ready: true,
    business_pending_approval: true,
    message: 'Account created. Your business profile is pending approval before NET terms or checkout.',
  });
}
