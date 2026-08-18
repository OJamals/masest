// One authenticated commerce snapshot for pricing, tax, ownership, and account scope.
// Provider adapters are injected so this module stays independent of the Supabase client
// implementation and every caller gets the same fail-closed read semantics.

export class CommerceContextError extends Error {
  constructor(stage = 'unknown', cause = null) {
    super('commerce_context_unavailable');
    this.name = 'CommerceContextError';
    this.code = 'commerce_context_unavailable';
    this.status = 503;
    this.retryable = true;
    this.stage = stage;
    this.cause = cause;
  }
}

function retailSnapshot({ kind, user, profile, sb }) {
  return Object.freeze({
    kind,
    user,
    userId: user?.id || null,
    profile,
    company: null,
    companyId: null,
    role: profile?.role || null,
    tier: 'retail',
    taxExempt: false,
    stripeCustomerId: null,
    account: Object.freeze({ companyId: null, role: profile?.role || null }),
    sb,
  });
}

export async function resolveCommerceContextSnapshot({
  request,
  env,
  userFromRequest,
  adminClient,
}) {
  if (typeof userFromRequest !== 'function' || typeof adminClient !== 'function') {
    throw new CommerceContextError('configuration');
  }

  // Own one service-role client even for a guest so downstream catalog/plan reads cannot
  // accidentally instantiate a second context with different assumptions.
  let sb;
  try {
    sb = adminClient(env);
  } catch (error) {
    throw new CommerceContextError('database', error);
  }
  let auth;
  try {
    auth = await userFromRequest(request, env);
  } catch (error) {
    throw new CommerceContextError('auth', error);
  }
  if (!auth || typeof auth !== 'object'
    || auth.error
    || (auth.token && !auth.user)) {
    throw new CommerceContextError('auth', auth?.error || new Error('auth_result_unavailable'));
  }
  const user = auth?.user || null;
  if (!user) return retailSnapshot({ kind: 'guest', user: null, profile: null, sb });

  let profileResult;
  try {
    profileResult = await sb.from('profiles')
      .select('id,company_id,role,full_name,phone')
      .eq('id', user.id)
      .maybeSingle();
  } catch (error) {
    throw new CommerceContextError('profile', error);
  }
  if (!profileResult || typeof profileResult !== 'object'
    || !Object.hasOwn(profileResult, 'data')
    || profileResult.error) {
    throw new CommerceContextError('profile', profileResult?.error || new Error('profile_result_unavailable'));
  }
  const profile = profileResult?.data || null;
  if (!profile?.company_id) return retailSnapshot({ kind: 'retail_user', user, profile, sb });

  let companyResult;
  try {
    companyResult = await sb.from('companies')
      .select('id,name,status,price_tier,tax_exempt,stripe_customer_id')
      .eq('id', profile.company_id)
      .maybeSingle();
  } catch (error) {
    throw new CommerceContextError('company', error);
  }
  if (!companyResult || typeof companyResult !== 'object'
    || !Object.hasOwn(companyResult, 'data')
    || companyResult.error) {
    throw new CommerceContextError('company', companyResult?.error || new Error('company_result_unavailable'));
  }
  const company = companyResult?.data || null;
  // A referentially stale/missing Company is a successful read, not an outage. It remains
  // a supported authenticated retail state and carries no phantom Company ownership.
  if (!company) return retailSnapshot({ kind: 'retail_user', user, profile, sb });

  const companyId = company.id || profile.company_id;
  const role = profile.role || null;
  return Object.freeze({
    kind: 'company_user',
    user,
    userId: user.id,
    profile,
    company,
    companyId,
    role,
    tier: company.status === 'approved' && company.price_tier ? company.price_tier : 'retail',
    taxExempt: company.tax_exempt === true,
    stripeCustomerId: company.stripe_customer_id || null,
    account: Object.freeze({ companyId, role }),
    sb,
  });
}
