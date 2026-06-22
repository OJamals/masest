// /api/admin/users - staff user management for company members and pending invites.
import { adminClient, emailLayout, htmlEscape, json, readBody, requireStaff, sendEmail } from '../../_lib/supabase.js';
import { recordAudit } from '../../_lib/audit.js';
import { staffCan } from '../../_lib/authz.js';

const ROLES = new Set(['admin', 'buyer']);

async function getInvite(sb, inviteId, companyId) {
  let query = sb.from('company_invites')
    .select('id,company_id,email,role,status')
    .eq('id', inviteId);
  if (companyId) query = query.eq('company_id', companyId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

export async function onRequest({ request, env }) {
  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const body = await readBody(request);
  const action = String(body.action || '').trim();
  const companyId = String(body.company_id || '').trim();
  const sb = adminClient(env);

  if (action === 'set_role') {
    if (!staffCan(role, 'user.role')) return json(403, { error: 'forbidden', message: 'Changing member roles requires owner access.' });
    const profileId = String(body.profile_id || '').trim();
    const newRole = String(body.role || '').trim();
    if (!companyId || !profileId) return json(400, { error: 'profile_required' });
    if (!ROLES.has(newRole)) return json(400, { error: 'invalid_role' });
    const { data, error } = await sb.from('profiles')
      .update({ role: newRole })
      .eq('id', profileId)
      .eq('company_id', companyId)
      .select('id,company_id,role')
      .maybeSingle();
    if (error) return json(500, { error: error.message || 'role_update_failed' });
    if (!data) return json(404, { error: 'profile_not_found' });
    await recordAudit(sb, { user, action: 'user.set_role', targetType: 'profile', targetId: profileId, detail: { role: newRole, company_id: companyId } });
    return json(200, { ok: true, profile: data });
  }

  if (action === 'resend_invite') {
    const inviteId = String(body.invite_id || '').trim();
    if (!inviteId) return json(400, { error: 'invite_id_required' });
    const invite = await getInvite(sb, inviteId, companyId);
    if (!invite || invite.status !== 'pending') return json(404, { error: 'pending_invite_not_found' });
    const appUrl = env.APP_URL || new URL(request.url).origin;
    await sendEmail(env, {
      to: [invite.email],
      subject: 'Reminder: join your MASEST business account',
      category: 'team',
      html: emailLayout({
        heading: 'Your MASEST invite is waiting',
        bodyHtml: `<p>You were invited to join a MASEST business account as <b>${htmlEscape(invite.role || 'buyer')}</b>.</p>`,
        ctaText: 'Join your team',
        ctaUrl: `${appUrl}/account.html?invite=1`,
      }),
    });
    return json(200, { ok: true, emailed: true });
  }

  if (action === 'revoke_invite') {
    const inviteId = String(body.invite_id || '').trim();
    if (!inviteId || !companyId) return json(400, { error: 'invite_id_required' });
    const { data, error } = await sb.from('company_invites')
      .update({ status: 'revoked' })
      .eq('id', inviteId)
      .eq('company_id', companyId)
      .eq('status', 'pending')
      .select('id,status')
      .maybeSingle();
    if (error) return json(500, { error: error.message || 'invite_revoke_failed' });
    if (!data) return json(404, { error: 'pending_invite_not_found' });
    await recordAudit(sb, { user, action: 'user.revoke_invite', targetType: 'company_invite', targetId: inviteId, detail: { company_id: companyId } });
    return json(200, { ok: true, invite: data });
  }

  return json(400, { error: 'invalid_action' });
}
