export async function ensureCompanyStripeCustomer({ stripe, sb, company, email }) {
  if (company.stripe_customer_id) return company.stripe_customer_id;

  const customer = await stripe.customers.create({
    email: email || undefined,
    name: company.name || undefined,
    metadata: { company_id: company.id },
  }, {
    idempotencyKey: `company-customer:${company.id}`,
  });

  const { data: saved, error: saveError } = await sb
    .from('companies')
    .update({ stripe_customer_id: customer.id })
    .eq('id', company.id)
    .is('stripe_customer_id', null)
    .select('stripe_customer_id')
    .maybeSingle();
  if (saveError) throw new Error('stripe_customer_persist_failed');
  if (saved?.stripe_customer_id) return saved.stripe_customer_id;

  const { data: winner, error: winnerError } = await sb
    .from('companies')
    .select('stripe_customer_id')
    .eq('id', company.id)
    .maybeSingle();
  if (winnerError || !winner?.stripe_customer_id) {
    throw new Error('stripe_customer_persist_failed');
  }
  return winner.stripe_customer_id;
}
