// GET /api/account/me — returns the caller's profile + company (incl. approval status & NET terms).
import { adminClient, userFromRequest, json } from '../../_lib/supabase.js';
import { isStaffEmail } from '../../_lib/authz.js';
import { buildAccountSetup } from '../../_lib/setup.js';
import { companyCreditState } from '../../_lib/credit.js';

export async function onRequestGet({ request, env }) {
  const { user } = await userFromRequest(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });

  const emailStaff = isStaffEmail(user.email, env);

  const sb = adminClient(env);
  const { data: profile } = await sb
    .from('profiles')
    .select('id,company_id,role,full_name,phone,is_staff')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) return json(404, { error: 'no_profile', email: user.email, is_staff: emailStaff });

  const { data: company } = await sb
    .from('companies')
    .select('id,name,status,net_terms_days,credit_limit,tax_exempt,price_tier,resale_cert_url,stripe_customer_id')
    .eq('id', profile.company_id)
    .maybeSingle();

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

  return json(200, {
    email: user.email,
    profile,
    company,
    is_staff: emailStaff || !!profile.is_staff,
    can_checkout: company?.status === 'approved',
    can_use_net_terms: company?.status === 'approved' && (company?.net_terms_days || 0) > 0,
    credit,
    setup: buildAccountSetup(profile, company),
  });
}
