// /api/account/team — multi-user company accounts. Company-admin only (profiles.role='admin').
//   GET                     → { members: [...], invites: [...], is_company_admin }
//   POST { email, role? }   → invite a teammate (role 'buyer'|'admin')
//   DELETE { id }           → revoke a pending invite
import { adminClient, userFromRequest, json, readBody, emailLayout, sendEmail, emailsByIds } from '../../_lib/supabase.js';
import { rateLimit, clientIp } from '../../_lib/ratelimit.js';
import { isLastAdmin, normalizeMemberRole } from '../../_lib/members.js';

async function callerContext(sb, userId) {
  const { data } = await sb.from('profiles').select('company_id,role').eq('id', userId).maybeSingle();
  return data || {};
}

export async function onRequest({ request, env }) {
  const { user } = await userFromRequest(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });

  const sb = adminClient(env);
  const { company_id, role } = await callerContext(sb, user.id);
  if (!company_id) return json(403, { error: 'no_company' });
  const isCompanyAdmin = role === 'admin';

  if (request.method === 'GET') {
    const { data: profiles } = await sb.from('profiles')
      .select('id,full_name,phone,role').eq('company_id', company_id);
    const emails = await emailsByIds(sb, (profiles || []).map((p) => p.id));
    const members = (profiles || []).map((p) => ({ ...p, email: emails[p.id] || null }));
    let invites = [];
    if (isCompanyAdmin) {
      const { data } = await sb.from('company_invites')
        .select('id,email,role,status,created_at').eq('company_id', company_id).eq('status', 'pending')
        .order('created_at', { ascending: false });
      invites = data || [];
    }
    return json(200, { members, invites, is_company_admin: isCompanyAdmin });
  }

  // Mutations require company admin.
  if (!isCompanyAdmin) return json(403, { error: 'company_admin_required' });

  if (request.method === 'POST') {
    // Throttle invites per inviter: each POST sends an email to an arbitrary address.
    const rl = await rateLimit(env, 'team-invite', user.id || clientIp(request), { limit: 10, windowSec: 60 });
    if (!rl.ok) return json(429, { error: 'rate_limited' }, { 'Retry-After': String(rl.retryAfter || 60) });
    const body = await readBody(request);
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: 'invalid_email' });
    const inviteRole = body.role === 'admin' ? 'admin' : 'buyer';

    const { error } = await sb.from('company_invites').insert({
      company_id, email, role: inviteRole, status: 'pending', invited_by: user.id,
    });
    if (error) {
      if (/duplicate|unique/i.test(error.message)) return json(409, { error: 'already_invited' });
      return json(500, { error: 'server_error' });
    }

    // Best-effort invite email — logged + suppression-checked via sendEmail (category 'team').
    if (env.RESEND_API_KEY) {
      const appUrl = env.APP_URL || new URL(request.url).origin;
      await sendEmail(env, {
        to: [email],
        subject: 'You’re invited to a MASEST business account',
        html: emailLayout({
          heading: 'You’re invited',
          bodyHtml: `<p>You’ve been invited to join a MASEST VertKleen business account.</p><p>Create your account with <b>this email address</b> to join automatically.</p>`,
          ctaText: 'Open your account', ctaUrl: `${appUrl}/account.html`,
        }),
        category: 'team',
      });
    }
    return json(201, { ok: true, email, role: inviteRole });
  }

  if (request.method === 'PATCH') {
    const body = await readBody(request);
    const profileId = String(body.profile_id || body.id || '').trim();
    if (!profileId) return json(400, { error: 'profile_id_required' });
    const newRole = normalizeMemberRole(body.role);
    const { data: members } = await sb.from('profiles').select('id,role').eq('company_id', company_id);
    const target = (members || []).find((m) => String(m.id) === profileId);
    if (!target) return json(404, { error: 'member_not_found' });
    // Demoting the company's only admin would orphan it.
    if (newRole !== 'admin' && isLastAdmin(members, profileId)) return json(400, { error: 'last_admin' });
    const { error } = await sb.from('profiles').update({ role: newRole })
      .eq('id', profileId).eq('company_id', company_id);
    if (error) return json(500, { error: 'server_error' });
    return json(200, { ok: true, profile_id: profileId, role: newRole });
  }

  if (request.method === 'DELETE') {
    const body = await readBody(request);
    // Remove an ACTIVE member: detach their profile from the company (keeps the
    // auth account; they simply lose company access until re-invited).
    const memberId = String(body.member_id || '').trim();
    if (memberId) {
      if (memberId === user.id) return json(400, { error: 'cannot_remove_self' });
      const { data: members } = await sb.from('profiles').select('id,role').eq('company_id', company_id);
      const target = (members || []).find((m) => String(m.id) === memberId);
      if (!target) return json(404, { error: 'member_not_found' });
      if (isLastAdmin(members, memberId)) return json(400, { error: 'last_admin' });
      const { error } = await sb.from('profiles').update({ company_id: null })
        .eq('id', memberId).eq('company_id', company_id);
      if (error) return json(500, { error: 'server_error' });
      return json(200, { ok: true, removed: memberId });
    }
    // Otherwise: revoke a pending invite.
    const id = body.id || new URL(request.url).searchParams.get('id');
    if (!id) return json(400, { error: 'id_required' });
    const { error } = await sb.from('company_invites').update({ status: 'revoked' })
      .eq('id', id).eq('company_id', company_id);
    if (error) return json(500, { error: 'server_error' });
    return json(200, { ok: true });
  }

  return json(405, { error: 'method_not_allowed' });
}
