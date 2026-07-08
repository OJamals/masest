// /api/admin/users - staff user management for company members and pending invites.
import { adminClient, emailLayout, htmlEscape, json, readBody, requireStaff, sendEmail } from '../../_lib/supabase.js';
import { recordAudit } from '../../_lib/audit.js';
import { staffCan, staffCanWrite } from '../../_lib/authz.js';

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

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Full Supabase-auth user directory: auth users joined with their profile + company.
async function userDirectory(sb) {
  const users = [];
  for (let page = 1; page <= 50; page += 1) {
    let batch = [];
    try {
      const { data } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
      batch = data?.users || [];
    } catch { break; }
    users.push(...batch);
    if (batch.length < 1000) break;
  }
  const { data: profiles } = await sb.from('profiles').select('id,full_name,phone,role,staff_role,company_id');
  const profById = new Map((profiles || []).map((p) => [p.id, p]));
  const { data: companies } = await sb.from('companies').select('id,name');
  const compById = new Map((companies || []).map((c) => [c.id, c.name]));
  return users.map((u) => {
    const p = profById.get(u.id) || {};
    return {
      id: u.id, email: u.email || null, created_at: u.created_at || null, last_sign_in_at: u.last_sign_in_at || null,
      full_name: p.full_name || null, phone: p.phone || null, role: p.role || null, staff_role: p.staff_role || null,
      company_id: p.company_id || null, company_name: p.company_id ? (compById.get(p.company_id) || null) : null,
    };
  }).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

export async function onRequest({ request, env }) {
  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });
  const sb = adminClient(env);

  // Read-only user directory — any staff may view.
  if (request.method === 'GET') {
    return json(200, { users: await userDirectory(sb) });
  }

  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!staffCanWrite(role)) return json(403, { error: 'forbidden', message: 'Read-only staff cannot make changes.' });

  const body = await readBody(request);
  const action = String(body.action || '').trim();
  const companyId = String(body.company_id || '').trim();

  // Full user lifecycle (create/update/delete) — owner-only (user.manage fails safe to owner).
  if (action === 'create') {
    if (!staffCan(role, 'user.manage')) return json(403, { error: 'forbidden', message: 'Creating users requires owner access.' });
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!EMAIL_RE.test(email)) return json(400, { error: 'invalid_email' });
    if (password.length < 8) return json(400, { error: 'weak_password', message: 'Password must be at least 8 characters.' });
    const memberRole = ROLES.has(String(body.role || '')) ? body.role : 'buyer';
    const { data: created, error } = await sb.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { full_name: String(body.full_name || '').slice(0, 120) },
    });
    if (error) return json(400, { error: error.message || 'create_failed' });
    const uid = created.user.id;
    await sb.from('profiles').upsert({
      id: uid, full_name: String(body.full_name || '').slice(0, 120) || null,
      phone: String(body.phone || '').slice(0, 40) || null, role: memberRole,
      company_id: companyId || null,
    }, { onConflict: 'id' });
    await recordAudit(sb, { user, action: 'user.create', targetType: 'user', targetId: uid, detail: { email, role: memberRole, company_id: companyId || null } });
    return json(200, { ok: true, id: uid });
  }

  if (action === 'update_user') {
    if (!staffCan(role, 'user.manage')) return json(403, { error: 'forbidden', message: 'Editing users requires owner access.' });
    const uid = String(body.user_id || '').trim();
    if (!uid) return json(400, { error: 'user_id_required' });
    const patch = {};
    if (typeof body.full_name === 'string') patch.full_name = body.full_name.slice(0, 120) || null;
    if (typeof body.phone === 'string') patch.phone = body.phone.slice(0, 40) || null;
    if (ROLES.has(String(body.role || ''))) patch.role = body.role;
    if ('company_id' in body) patch.company_id = body.company_id ? String(body.company_id) : null;
    if (Object.keys(patch).length) {
      const { error } = await sb.from('profiles').update(patch).eq('id', uid);
      if (error) return json(500, { error: error.message || 'update_failed' });
    }
    if (body.email && EMAIL_RE.test(String(body.email).trim().toLowerCase())) {
      const { error } = await sb.auth.admin.updateUserById(uid, { email: String(body.email).trim().toLowerCase() });
      if (error) return json(400, { error: error.message || 'email_update_failed' });
    }
    await recordAudit(sb, { user, action: 'user.update', targetType: 'user', targetId: uid, detail: patch });
    return json(200, { ok: true });
  }

  if (action === 'delete_user') {
    if (!staffCan(role, 'user.manage')) return json(403, { error: 'forbidden', message: 'Deleting users requires owner access.' });
    const uid = String(body.user_id || '').trim();
    if (!uid) return json(400, { error: 'user_id_required' });
    if (uid === user.id) return json(400, { error: 'cannot_delete_self' });
    const { error } = await sb.auth.admin.deleteUser(uid);
    if (error) return json(500, { error: error.message || 'delete_failed' });
    await recordAudit(sb, { user, action: 'user.delete', targetType: 'user', targetId: uid, detail: {} });
    return json(200, { ok: true });
  }

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
