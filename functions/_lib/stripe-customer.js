export async function ensureCompanyStripeCustomer({ stripe, sb, company, email }) {
  const previousCustomerId = company.stripe_customer_id || null;
  if (previousCustomerId) {
    try {
      const existing = await stripe.customers.retrieve(previousCustomerId);
      if (existing && !existing.deleted) return previousCustomerId;
    } catch (error) {
      if (error?.code !== 'resource_missing') throw error;
    }
  }

  const customer = await stripe.customers.create({
    email: email || undefined,
    name: company.name || undefined,
    metadata: { company_id: company.id },
  }, {
    idempotencyKey: previousCustomerId
      ? `company-customer:${company.id}:replace:${previousCustomerId}`
      : `company-customer:${company.id}`,
  });

  let update = sb
    .from('companies')
    .update({ stripe_customer_id: customer.id })
    .eq('id', company.id);
  update = previousCustomerId
    ? update.eq('stripe_customer_id', previousCustomerId)
    : update.is('stripe_customer_id', null);
  const { data: saved, error: saveError } = await update
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
