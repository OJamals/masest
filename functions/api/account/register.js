// POST /api/account/register — user registration/profile bootstrap.
// Requires an authenticated Supabase user (sign up first, send Bearer token).
//
// User accounts are active IMMEDIATELY — there is no admin approval to register. A company
// is never created here: business setup is a separate, deliberate step from the dashboard
// (POST /api/account/company), which starts the admin business-verification gate. The only
// company link made here is auto-joining a company the user's email was already invited to.
//
// Body: { profile: { full_name?, phone? } }   (company fields are ignored if sent)
import { adminClient, userFromRequest, json, readBody } from '../../_lib/supabase.js';

export async function onRequestPost({ request, env }) {
  const { user } = await userFromRequest(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });

  const body = await readBody(request);
  const profile = body.profile || {};
  const sb = adminClient(env);

  // Block double-registration into a company (idempotent if already linked).
  const { data: existing } = await sb
    .from('profiles').select('id,company_id,role').eq('id', user.id).maybeSingle();
  if (existing?.company_id) {
    return json(409, { error: 'already_registered', company_id: existing.company_id });
  }

  // Invite-aware: if this email was invited to a company, join it (role from the invite).
  // The inviting admin's company owns the relationship — no new business approval needed.
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
    return json(201, { account_ready: true, company_id: invite.company_id, joined: true, message: 'You’ve joined your team. Account ready.' });
  }

  // User-only path (the default): finish registration without a business. The account is
  // ready immediately; the client is told business setup is still open so it can surface the
  // optional "set up your business" call to action on the dashboard.
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
    message: 'Account created. Set up a business profile from your dashboard when you’re ready to unlock B2B ordering.',
  });
}
