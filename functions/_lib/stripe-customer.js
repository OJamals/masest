// Shape a validated checkout address for the Stripe Customer API.
export function stripeCustomerAddress(address) {
  if (!address?.address1) return undefined;
  return {
    line1: address.address1,
    line2: address.address2 || undefined,
    city: address.city,
    state: address.state,
    postal_code: address.postal_code,
    country: address.country || 'US',
  };
}

// Guests who picked a shipping rate have a Google-validated shipping AND billing address,
// but a Checkout Session started with only `customer_email` collects neither — Stripe never
// sees them, so AVS/Radar score the payment blind and Stripe Tax would have no origin to
// work from. Creating the Customer up front puts both addresses on the payment.
//
// Idempotency is keyed on the signed rate id, so a double-submitted checkout reuses the
// same Customer instead of littering the account with duplicates.
export async function guestStripeCustomer({ stripe, email, shippingAddress, billingAddress, rateId }) {
  const shipping = stripeCustomerAddress(shippingAddress);
  const billing = stripeCustomerAddress(billingAddress) || shipping;
  if (!shipping) return null;
  const customer = await stripe.customers.create({
    email: email || undefined,
    name: shippingAddress.company || shippingAddress.name || undefined,
    phone: shippingAddress.phone || undefined,
    address: billing,
    shipping: {
      name: shippingAddress.name,
      phone: shippingAddress.phone || undefined,
      address: shipping,
    },
    metadata: { source: 'guest_checkout' },
  }, rateId ? { idempotencyKey: `guest-customer:${rateId}` } : undefined);
  return customer?.id || null;
}

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
