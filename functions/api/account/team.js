// /api/account/team — multi-user company accounts. Company-admin only (profiles.role='admin').
//   GET                     → { members: [...], invites: [...], is_company_admin }
//   POST { email, role? }   → invite a teammate (role 'buyer'|'admin')
//   DELETE { id }           → revoke a pending invite
import { adminClient, userFromRequest, json, readBody, emailLayout } from '../../_lib/supabase.js';

async function callerContext(sb, userId) {
  const { data } = await sb.from('profiles').select('company_id,role').eq('id', userId).maybeSingle();
  return data || {};
}

// Map profile ids -> emails via the auth admin API (best-effort).
async function emailsFor(sb, ids) {
  const want = new Set(ids);
  const out = {};
  try {
    const { data } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const u of data?.users || []) if (want.has(u.id)) out[u.id] = u.email;
  } catch { /* unavailable */ }
  return out;
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
    const emails = await emailsFor(sb, (profiles || []).map((p) => p.id));
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
    const body = await readBody(request);
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: 'invalid_email' });
    const inviteRole = body.role === 'admin' ? 'admin' : 'buyer';

    const { error } = await sb.from('company_invites').insert({
      company_id, email, role: inviteRole, status: 'pending', invited_by: user.id,
    });
    if (error) {
      if (/duplicate|unique/i.test(error.message)) return json(409, { error: 'already_invited' });
      return json(500, { error: error.message });
    }

    // Best-effort invite email.
    if (env.RESEND_API_KEY) {
      const from = env.RESEND_FROM || 'MASEST <noreply@masest.co>';
      const appUrl = env.APP_URL || new URL(request.url).origin;
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
          body: JSON.stringify({ from, to: [email], subject: 'You’re invited to a MASEST business account',
            html: emailLayout({
              heading: 'You’re invited',
              bodyHtml: `<p>You’ve been invited to join a MASEST VertKleen business account.</p><p>Create your account with <b>this email address</b> to join automatically.</p>`,
              ctaText: 'Open your account', ctaUrl: `${appUrl}/account.html`,
            }) }),
        });
      } catch { /* ignore */ }
    }
    return json(201, { ok: true, email, role: inviteRole });
  }

  if (request.method === 'DELETE') {
    const body = await readBody(request);
    const id = body.id || new URL(request.url).searchParams.get('id');
    if (!id) return json(400, { error: 'id_required' });
    const { error } = await sb.from('company_invites').update({ status: 'revoked' })
      .eq('id', id).eq('company_id', company_id);
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true });
  }

  return json(405, { error: 'method_not_allowed' });
}
