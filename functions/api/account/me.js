// GET  /api/account/me — returns the caller's profile + company (incl. approval status & NET terms).
// POST /api/account/me — change the caller's login email (Supabase double opt-in re-verification).
import { createClient } from '@supabase/supabase-js';
import { adminClient, userFromRequest, json, readBody } from '../../_lib/supabase.js';
import { isStaffEmail, normalizeStaffRole } from '../../_lib/authz.js';
import { buildAccountSetup } from '../../_lib/setup.js';
import { companyCreditState } from '../../_lib/credit.js';

// Pragmatic email shape check — the real gate is Supabase's confirmation email to the new address.
export function isValidEmail(value) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(value || '').trim());
}

export async function onRequestGet({ request, env }) {
  const { user } = await userFromRequest(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });

  const emailStaff = isStaffEmail(user.email, env);

  const sb = adminClient(env);
  const { data: profile } = await sb
    .from('profiles')
    .select('id,company_id,role,full_name,phone,is_staff,staff_role')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) {
    return json(404, {
      error: 'no_profile',
      email: user.email,
      can_admin: emailStaff,
      staff: emailStaff ? { role: 'owner', source: 'env' } : null,
    });
  }

  let company = null;
  if (profile.company_id) {
    const { data } = await sb
      .from('companies')
      .select('id,name,status,net_terms_days,credit_limit,tax_exempt,price_tier,resale_cert_url,stripe_customer_id')
      .eq('id', profile.company_id)
      .maybeSingle();
    company = data || null;
  }

  let credit = null;
  if (company?.id) {
    try {
      const state = await companyCreditState(sb, company.id, company.credit_limit);
      credit = {
        credit_limit: state.credit_limit,
        net_outstanding: state.outstanding,
        credit_available: state.available,
        unlimited: state.unlimited,
      };
    } catch (err) {
      credit = null; // degrade gracefully — never break the dashboard load on a credit read
    }
  }

  const profileStaffRole = profile.staff_role ? normalizeStaffRole(profile.staff_role) : null;
  const profileStaff = profile.is_staff === true && !!profileStaffRole;
  const canAdmin = emailStaff || profileStaff;

  return json(200, {
    email: user.email,
    profile,
    company,
    can_admin: canAdmin,
    staff: canAdmin ? { role: emailStaff ? 'owner' : profileStaffRole, source: emailStaff ? 'env' : 'profile' } : null,
    can_checkout: company?.status === 'approved',
    can_use_net_terms: company?.status === 'approved' && (company?.net_terms_days || 0) > 0,
    credit,
    setup: buildAccountSetup(profile, company),
  });
}

// Change the caller's login email. Uses a user-scoped client so Supabase runs its
// native secure-email-change flow (confirmation links to old + new addresses); the
// email only switches once the new address is verified. No admin override here.
export async function onRequestPost({ request, env }) {
  const { user, token } = await userFromRequest(request, env);
  if (!user || !token) return json(401, { error: 'unauthenticated' });

  const { email } = await readBody(request);
  const clean = String(email || '').trim().toLowerCase();
  if (!isValidEmail(clean)) return json(400, { error: 'invalid_email' });
  if (clean === String(user.email || '').toLowerCase()) return json(200, { unchanged: true, email: clean });

  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { error } = await sb.auth.updateUser({ email: clean });
  if (error) return json(400, { error: 'email_update_failed', detail: error.message });

  return json(200, { pending_verification: true, email: clean });
}
