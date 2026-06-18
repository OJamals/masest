// GET /api/account/me — returns the caller's profile + company (incl. approval status & NET terms).
import { adminClient, userFromRequest, json } from '../../_lib/supabase.js';

function setupStep(key, label, done, detail, action) {
  return { key, label, done: Boolean(done), detail, action };
}

function buildSetup(profile, company) {
  const approved = company?.status === 'approved';
  const hasProfile = Boolean(profile?.full_name && profile?.phone);
  const hasTaxFile = Boolean(company?.tax_exempt || company?.resale_cert_url);
  const hasPayment = Boolean(company?.stripe_customer_id);
  const hasNetTerms = approved && (company?.net_terms_days || 0) > 0;
  const steps = [
    { key: 'profile', label: 'Profile', done: hasProfile, detail: hasProfile ? 'Name and phone are on file.' : 'Add a contact name and phone.', action: 'dashboard.html#profile' },
    { key: 'approval', label: 'Approval', done: approved, detail: approved ? 'Account approved for online ordering.' : `Account status: ${company?.status || 'pending'}.`, action: 'business.html' },
    { key: 'tax', label: 'Tax file', done: hasTaxFile, detail: hasTaxFile ? 'Tax or resale certificate is on file.' : 'Add resale or tax-exempt documentation when applicable.', action: 'business.html' },
    { key: 'payment', label: 'Payment', done: hasPayment, detail: hasPayment ? 'Stripe customer record is ready.' : 'Open the secure payment portal after approval.', action: 'dashboard.html#payment' },
    { key: 'net_terms', label: 'NET terms', done: hasNetTerms, detail: hasNetTerms ? `NET-${company.net_terms_days} terms enabled.` : 'Staff will enable terms after approval.', action: 'business.html' },
  ];
  const done = steps.filter((step) => step.done).length;
  return { done, total: steps.length, percent: Math.round((done / steps.length) * 100), steps };
}

export async function onRequestGet({ request, env }) {
  const { user } = await userFromRequest(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });

  const allow = (env.ADMIN_EMAILS || env.ADMIN_EMAIL || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const emailStaff = allow.includes(String(user.email || '').toLowerCase());

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

  return json(200, {
    email: user.email,
    profile,
    company,
    is_staff: emailStaff || !!profile.is_staff,
    can_checkout: company?.status === 'approved',
    can_use_net_terms: company?.status === 'approved' && (company?.net_terms_days || 0) > 0,
    setup: buildSetup(profile, company),
  });
}
