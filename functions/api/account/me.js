// GET /api/account/me — returns the caller's profile + company (incl. approval status & NET terms).
import { adminClient, userFromRequest, json } from '../../_lib/supabase.js';

export async function onRequestGet({ request, env }) {
  const { user } = await userFromRequest(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });

  const sb = adminClient(env);
  const { data: profile } = await sb
    .from('profiles')
    .select('id,company_id,role,full_name,phone')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) return json(404, { error: 'no_profile', email: user.email });

  const { data: company } = await sb
    .from('companies')
    .select('id,name,status,net_terms_days,credit_limit,tax_exempt')
    .eq('id', profile.company_id)
    .maybeSingle();

  return json(200, {
    email: user.email,
    profile,
    company,
    can_checkout: company?.status === 'approved',
    can_use_net_terms: company?.status === 'approved' && (company?.net_terms_days || 0) > 0,
  });
}
