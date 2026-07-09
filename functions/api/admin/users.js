// /api/admin/users - staff user directory + full per-user console: profile, role,
// business (company) + status, addresses, payment methods, orders. Also company-member
// invites. The consolidated admin Accounts console consumes this.
import Stripe from 'stripe';
import { adminClient, emailLayout, htmlEscape, json, readBody, requireStaff, sendEmail } from '../../_lib/supabase.js';
import { recordAudit } from '../../_lib/audit.js';
import { staffCan, staffCanWrite } from '../../_lib/authz.js';

// Account roles selectable by an admin. 'moderator' is an elevated member role.
const ROLES = new Set(['admin', 'buyer', 'moderator']);
const ADDR_MAX = { line1: 160, line2: 160, city: 80, zip: 20 };

function cleanText(v, max) { return String(v || '').trim().replace(/\s+/g, ' ').slice(0, max); }

function normalizeAddress(input = {}) {
  const row = {
    type: input.type === 'bill' ? 'bill' : 'ship',
    line1: cleanText(input.line1, ADDR_MAX.line1), line2: cleanText(input.line2, ADDR_MAX.line2),
    city: cleanText(input.city, ADDR_MAX.city), state: String(input.state || '').trim().toUpperCase(),
    zip: cleanText(input.zip, ADDR_MAX.zip).toUpperCase(), country: 'US',
    is_default: input.is_default === true,
  };
  if (!row.line1 || !row.city || !row.state || !row.zip) return { error: 'address_incomplete' };
  if (!/^[A-Z]{2}$/.test(row.state)) return { error: 'invalid_state' };
  if (!/^[0-9A-Z -]{3,20}$/.test(row.zip)) return { error: 'invalid_zip' };
  return { row };
}

// Stripe card list for a company's customer (best-effort, read-only).
async function stripeCards(env, customerId) {
  if (!customerId || !env.STRIPE_SECRET_KEY) return [];
  try {
    const stripe = new Stripe(env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });
    const pm = await stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 20 });
    return (pm.data || []).map((m) => ({ id: m.id, brand: m.card?.brand || 'card', last4: m.card?.last4 || '????', exp: `${m.card?.exp_month}/${m.card?.exp_year}` }));
  } catch { return []; }
}

// Company-scoped console: the company (+status/terms/tier), its addresses, orders, cards.
async function companyConsole(sb, env, companyId) {
  const { data: company } = await sb.from('companies').select('id,name,status,net_terms_days,credit_limit,tax_exempt,price_tier,stripe_customer_id,created_at').eq('id', companyId).maybeSingle();
  if (!company) return { company: null, addresses: [], orders: [], payment_methods: [] };
  const [addrRes, ordRes] = await Promise.all([
    sb.from('addresses').select('id,type,line1,line2,city,state,zip,is_default').eq('company_id', companyId),
    sb.from('orders').select('id,status,payment_method,total,currency,created_at,tracking_status').eq('company_id', companyId).neq('status', 'cart').order('created_at', { ascending: false }).limit(50),
  ]);
  return { company, addresses: addrRes.data || [], orders: ordRes.data || [], payment_methods: await stripeCards(env, company.stripe_customer_id) };
}

// Aggregate the full console for one user: profile, role, and (if any) their company console.
async function userConsole(sb, env, uid) {
  const { data: profile } = await sb.from('profiles').select('id,full_name,phone,role,staff_role,company_id').eq('id', uid).maybeSingle();
  if (!profile) return null;
  let email = null;
  try { const { data } = await sb.auth.admin.getUserById(uid); email = data?.user?.email || null; } catch { /* best-effort */ }
  const co = profile.company_id ? await companyConsole(sb, env, profile.company_id) : { company: null, addresses: [], orders: [], payment_methods: [] };
  return { profile: { ...profile, email }, ...co };
}

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
  const { data: companies } = await sb.from('companies').select('id,name,status');
  const compById = new Map((companies || []).map((c) => [c.id, c]));
  return users.map((u) => {
    const p = profById.get(u.id) || {};
    return {
      id: u.id, email: u.email || null, created_at: u.created_at || null, last_sign_in_at: u.last_sign_in_at || null,
      full_name: p.full_name || null, phone: p.phone || null, role: p.role || null, staff_role: p.staff_role || null,
      company_id: p.company_id || null,
      company_name: p.company_id ? (compById.get(p.company_id)?.name || null) : null,
      company_status: p.company_id ? (compById.get(p.company_id)?.status || null) : null,
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
    const params = new URL(request.url).searchParams;
    const detailId = params.get('detail');
    if (detailId) {
      const consoleData = await userConsole(sb, env, detailId);
      if (!consoleData) return json(404, { error: 'user_not_found' });
      return json(200, consoleData);
    }
    const companyId = params.get('company');
    if (companyId) return json(200, await companyConsole(sb, env, companyId));
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

  // Address book (company-scoped) — owner-gated.
  if (action === 'add_address' || action === 'update_address' || action === 'delete_address') {
    if (!staffCan(role, 'user.manage')) return json(403, { error: 'forbidden', message: 'Editing addresses requires owner access.' });
    if (!companyId) return json(400, { error: 'company_id_required' });
    if (action === 'delete_address') {
      if (!body.address_id) return json(400, { error: 'address_id_required' });
      const { error } = await sb.from('addresses').delete().eq('id', body.address_id).eq('company_id', companyId);
      if (error) return json(500, { error: error.message });
      await recordAudit(sb, { user, action: 'user.address_delete', targetType: 'company', targetId: companyId, detail: { address_id: body.address_id } });
      return json(200, { ok: true });
    }
    const norm = normalizeAddress(body.address || body);
    if (norm.error) return json(400, { error: norm.error });
    if (action === 'add_address') {
      if (norm.row.is_default) await sb.from('addresses').update({ is_default: false }).eq('company_id', companyId).eq('type', norm.row.type);
      const { error } = await sb.from('addresses').insert({ company_id: companyId, ...norm.row });
      if (error) return json(500, { error: error.message });
      await recordAudit(sb, { user, action: 'user.address_add', targetType: 'company', targetId: companyId, detail: { type: norm.row.type } });
      return json(200, { ok: true });
    }
    if (!body.address_id) return json(400, { error: 'address_id_required' });
    if (norm.row.is_default) await sb.from('addresses').update({ is_default: false }).eq('company_id', companyId).eq('type', norm.row.type);
    const { error } = await sb.from('addresses').update(norm.row).eq('id', body.address_id).eq('company_id', companyId);
    if (error) return json(500, { error: error.message });
    await recordAudit(sb, { user, action: 'user.address_update', targetType: 'company', targetId: companyId, detail: { address_id: body.address_id } });
    return json(200, { ok: true });
  }

  // Detach a Stripe payment method from the company's customer — owner-gated.
  if (action === 'detach_payment') {
    if (!staffCan(role, 'user.manage')) return json(403, { error: 'forbidden', message: 'Editing payment requires owner access.' });
    if (!body.payment_method_id) return json(400, { error: 'payment_method_id_required' });
    if (!env.STRIPE_SECRET_KEY) return json(400, { error: 'stripe_not_configured' });
    try {
      const stripe = new Stripe(env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });
      await stripe.paymentMethods.detach(String(body.payment_method_id));
    } catch (err) { return json(502, { error: 'stripe_detach_failed', message: String(err?.message || err) }); }
    await recordAudit(sb, { user, action: 'user.payment_detach', targetType: 'company', targetId: companyId || null, detail: { pm: body.payment_method_id } });
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
