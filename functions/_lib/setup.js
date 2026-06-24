export const SETUP_STEP_LABELS = {
  profile: 'Profile',
  approval: 'Approval',
  tax: 'Tax documents',
  payment: 'Card on file',
  net_terms: 'NET terms',
};

function setupStep(key, label, done, detail, action) {
  return { key, label, done: Boolean(done), detail, action };
}

function setupSummary(steps) {
  const done = steps.filter((step) => step.done).length;
  return {
    done,
    total: steps.length,
    percent: Math.round((done / steps.length) * 100),
    open_steps: steps.filter((step) => !step.done).map((step) => step.key),
    steps,
  };
}

export function buildAccountSetup(profile, company) {
  const hasBusiness = Boolean(company?.id);
  const approved = company?.status === 'approved';
  const hasProfile = Boolean(profile?.full_name && profile?.phone);
  const hasTaxFile = Boolean(company?.tax_exempt || company?.resale_cert_url);
  const hasPayment = Boolean(company?.stripe_customer_id);
  const hasNetTerms = approved && (company?.net_terms_days || 0) > 0;
  return setupSummary([
    setupStep('profile', 'Profile', hasProfile, hasProfile ? 'Name and phone are on file.' : 'Add a contact name and phone.', 'dashboard.html#profile'),
    setupStep('approval', 'Business approval', approved, approved ? 'Business approved for online ordering.' : (hasBusiness ? `Business status: ${company.status || 'pending'}.` : 'Set up a business profile to request approval.'), 'business.html'),
    setupStep('tax', 'Tax file', hasTaxFile, hasTaxFile ? 'Tax or resale certificate is on file.' : (hasBusiness ? 'Add resale or tax-exempt documentation when applicable.' : 'Available after business setup.'), 'business.html'),
    setupStep('payment', 'Payment', hasPayment, hasPayment ? 'Stripe customer record is ready.' : (hasBusiness ? 'Open the secure Stripe portal after approval.' : 'Available after business approval.'), 'business.html#payment'),
    setupStep('net_terms', 'NET terms', hasNetTerms, hasNetTerms ? `NET-${company.net_terms_days} terms enabled.` : (hasBusiness ? 'Staff will enable terms after approval.' : 'Available after business approval.'), 'business.html'),
  ]);
}

export function buildCompanySetup(company, profiles = company?.profiles || []) {
  const approved = company?.status === 'approved';
  const hasProfile = profiles.some((profile) => profile.full_name && profile.phone);
  const hasTaxFile = Boolean(company?.tax_exempt || company?.resale_cert_url);
  const hasPayment = Boolean(company?.stripe_customer_id);
  const hasNetTerms = approved && (company?.net_terms_days || 0) > 0;
  return setupSummary([
    setupStep('profile', 'Profile', hasProfile, hasProfile ? 'Company contact is complete.' : 'Missing contact name or phone.'),
    setupStep('approval', 'Approval', approved, approved ? 'Account approved.' : 'Approval is still open.'),
    setupStep('tax', 'Tax file', hasTaxFile, hasTaxFile ? 'Tax or resale certificate on file.' : 'Missing tax/resale documentation.'),
    setupStep('payment', 'Payment', hasPayment, hasPayment ? 'Stripe customer exists.' : 'No saved Stripe portal customer.'),
    setupStep('net_terms', 'NET terms', hasNetTerms, hasNetTerms ? `NET-${company.net_terms_days} enabled.` : 'NET terms not enabled.'),
  ]);
}

export function setupStepBreakdown(counts = {}) {
  return Object.entries(counts)
    .map(([key, count]) => ({ key, label: SETUP_STEP_LABELS[key] || key, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
