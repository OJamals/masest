const money = (amount, currency = 'usd') => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: String(currency).toUpperCase(),
}).format(Number(amount) || 0);
const clean = (value) => String(value ?? '').trim();
const escapeHtml = (value) => clean(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

export function checkoutAddress(values, prefix) {
  return {
    name: clean(values.contactName),
    company: clean(values.businessName),
    phone: clean(values.phone),
    address1: clean(values[`${prefix}Address1`]),
    address2: clean(values[`${prefix}Address2`]),
    city: clean(values[`${prefix}City`]),
    state: clean(values[`${prefix}State`]).toUpperCase(),
    postal_code: clean(values[`${prefix}PostalCode`]),
    country: 'US',
    residential: values[`${prefix}Residential`] === true,
  };
}

function comparable(value) {
  return clean(value).replace(/\s+/g, ' ').toUpperCase();
}

export function addressMatches(saved, current) {
  return [
    ['line1', 'address1'], ['line2', 'address2'], ['city', 'city'],
    ['state', 'state'], ['zip', 'postal_code'],
  ].every(([savedKey, currentKey]) => comparable(saved?.[savedKey]) === comparable(current?.[currentKey]));
}

function checkoutError(error) {
  const code = error?.data?.error || error?.code || error?.message;
  return ({
    address_incomplete: 'Enter a complete U.S. address.',
    shipping_address_incomplete: 'Enter a complete shipping address and phone number.',
    address_not_deliverable: 'Google could not confirm this delivery address. Review the street, unit, city, state, and ZIP.',
    address_validation_unavailable: 'Address verification is temporarily unavailable. Try again.',
    shipping_package_profile_missing: 'A cart item is missing shipping dimensions. Return to the cart and request a freight quote.',
    shipping_cart_too_large: 'This cart needs freight planning. Send a quote request for a consolidated shipment.',
    shipping_rates_unavailable: 'No live carrier rate is available for this address and cart.',
    shipping_quote_expired: 'Shipping rate expired. Recalculate shipping before payment.',
    shipping_quote_cart_changed: 'Cart changed. Recalculate shipping before payment.',
    stripe_customer_setup_failed: 'Stripe could not update this account address. Try again.',
    credit_limit_exceeded: `This order exceeds available credit (${money(error?.data?.available || 0)} remaining). Choose Stripe payment or contact MASEST about account terms.`,
    stripe_error: 'Stripe could not start payment. Try again.',
  })[code] || 'Checkout could not continue. Review the form and try again.';
}

function flattenCatalog(products) {
  const catalog = new Map();
  for (const entry of products || []) {
    const parent = entry.products && typeof entry.products === 'object' ? entry.products : entry;
    if (entry.vsku) {
      catalog.set(entry.vsku, {
        name: `${parent.name || entry.name || entry.vsku} - ${entry.label || 'Each'}`,
        price: Number(entry.price), currency: entry.currency || parent.currency || 'usd',
      });
      continue;
    }
    for (const variant of entry.product_variants || []) {
      catalog.set(variant.vsku, {
        name: `${entry.name} - ${variant.label}`,
        price: Number(variant.price), currency: variant.currency || entry.currency || 'usd',
      });
    }
  }
  return catalog;
}

function formValues(form) {
  const values = Object.fromEntries(new FormData(form));
  values.shippingResidential = document.getElementById('shippingResidential').checked;
  return values;
}

function fillAddress(prefix, address) {
  const values = {
    Address1: address?.address1 ?? address?.line1,
    Address2: address?.address2 ?? address?.line2,
    City: address?.city,
    State: address?.state,
    PostalCode: address?.postal_code ?? address?.zip,
  };
  for (const [suffix, value] of Object.entries(values)) {
    const field = document.getElementById(`${prefix}${suffix}`);
    if (field) field.value = value || '';
  }
}

async function boot() {
  const [cartModule, autocompleteModule, authModule] = await Promise.all([
    import('./cart.js'),
    import('./address-autocomplete.js'),
    import('./auth.js?v=20260711w'),
  ]);
  const { checkout, items } = cartModule;
  const { mountAddressAutocomplete } = autocompleteModule;
  const { api, getToken, me } = authModule;
  const cart = items();
  const empty = document.getElementById('checkoutEmpty');
  const shell = document.getElementById('checkoutShell');
  if (!cart.length) { empty.hidden = false; return; }
  shell.hidden = false;

  const form = document.getElementById('checkoutDetails');
  const status = document.getElementById('checkoutStatus');
  const ratesBox = document.getElementById('shippingRates');
  const rateOptions = document.getElementById('shippingRateOptions');
  const pay = document.getElementById('checkoutPay');
  const calculate = document.getElementById('calculateShipping');
  const sameBilling = document.getElementById('billingSameAsShipping');
  const billingFields = document.getElementById('billingAddressFields');
  const state = { catalog: new Map(), saved: [], token: null, quote: null, selectedRate: 0 };

  function showStatus(message, kind = '') {
    status.textContent = message;
    status.dataset.state = kind;
    status.hidden = !message;
  }

  function toggleBilling() {
    const same = sameBilling.checked;
    billingFields.hidden = same;
    billingFields.querySelectorAll('input,select').forEach((field) => { field.disabled = same; });
  }

  function invalidateRates() {
    state.quote = null;
    rateOptions.replaceChildren();
    ratesBox.hidden = true;
    pay.disabled = true;
    renderTotals();
  }

  function subtotal() {
    return cart.reduce((sum, line) => sum + (state.catalog.get(line.sku)?.price || 0) * line.qty, 0);
  }

  function renderTotals() {
    const currency = state.catalog.get(cart[0]?.sku)?.currency || 'usd';
    const shipping = state.quote?.rates?.[state.selectedRate]?.amount_minor;
    document.getElementById('checkoutTotals').innerHTML = `<dl>
      <div><dt>Products</dt><dd>${money(subtotal(), currency)}</dd></div>
      <div><dt>Shipping</dt><dd>${shipping == null ? 'Calculate above' : money(shipping / 100, currency)}</dd></div>
      <div><dt>Tax</dt><dd>Calculated by Stripe</dd></div>
      <div class="cart-total-row"><dt>Pre-tax total</dt><dd>${money(subtotal() + (shipping || 0) / 100, currency)}</dd></div>
    </dl>`;
  }

  function renderLines() {
    document.getElementById('checkoutLines').innerHTML = cart.map((line) => {
      const product = state.catalog.get(line.sku);
      return `<div><span><b>${escapeHtml(product?.name || line.sku)}</b><small>${escapeHtml(line.sku)} · Qty ${line.qty}</small></span><strong>${product ? money(product.price * line.qty, product.currency) : 'At payment'}</strong></div>`;
    }).join('');
    renderTotals();
  }

  function renderRates() {
    const rates = state.quote.rates || [];
    rateOptions.replaceChildren(...rates.map((rate, index) => {
      const label = document.createElement('label');
      label.className = 'checkout-rate';
      const radio = document.createElement('input');
      radio.type = 'radio'; radio.name = 'shippingRate'; radio.value = String(index); radio.checked = index === state.selectedRate;
      const text = document.createElement('span');
      const delivery = rate.delivery_days ? `${rate.delivery_days} business days` : 'Carrier estimate at shipment';
      text.innerHTML = `<b>${escapeHtml(rate.carrier_name)} · ${escapeHtml(rate.service_type)}</b><small>${escapeHtml(delivery)}${index === 0 ? ' · Lowest rate' : ''}</small>`;
      const price = document.createElement('strong');
      price.textContent = money(rate.amount_minor / 100, rate.currency);
      label.append(radio, text, price);
      return label;
    }));
    ratesBox.hidden = false;
    pay.disabled = !rates.length;
    const validation = state.quote.address_validation;
    document.getElementById('addressVerification').textContent = validation?.corrected
      ? `Google verified and standardized the delivery address. ${state.quote.package_count} package${state.quote.package_count === 1 ? '' : 's'} rated.`
      : `Google verified the delivery address. ${state.quote.package_count} package${state.quote.package_count === 1 ? '' : 's'} rated.`;
    renderTotals();
  }

  function renderSavedSelect(prefix, type) {
    const select = document.getElementById(`${prefix}Saved`);
    const wrap = document.getElementById(`${prefix}SavedWrap`);
    const matches = state.saved.filter((address) => address.type === type);
    if (!matches.length) return;
    for (const address of matches) {
      const option = document.createElement('option');
      option.value = address.id;
      option.textContent = `${address.line1}${address.line2 ? `, ${address.line2}` : ''}, ${address.city}, ${address.state} ${address.zip}${address.is_default ? ' · Default' : ''}`;
      select.append(option);
    }
    const initial = matches.find((address) => address.is_default) || matches[0];
    select.value = initial.id;
    fillAddress(prefix, initial);
    wrap.hidden = false;
    select.addEventListener('change', () => {
      const selected = state.saved.find((address) => address.id === select.value);
      if (selected) fillAddress(prefix, selected);
      else fillAddress(prefix, {});
      invalidateRates();
    });
  }

  toggleBilling();
  sameBilling.addEventListener('change', () => { toggleBilling(); invalidateRates(); });
  form.addEventListener('input', invalidateRates);
  rateOptions.addEventListener('change', (event) => {
    if (event.target.name !== 'shippingRate') return;
    state.selectedRate = Number(event.target.value);
    renderTotals();
  });

  mountAddressAutocomplete({
    mount: document.getElementById('shippingAutocomplete'),
    fields: {
      line1: document.getElementById('shippingAddress1'), line2: document.getElementById('shippingAddress2'),
      city: document.getElementById('shippingCity'), state: document.getElementById('shippingState'), zip: document.getElementById('shippingPostalCode'),
    },
  }).catch(() => {});
  mountAddressAutocomplete({
    mount: document.getElementById('billingAutocomplete'),
    fields: {
      line1: document.getElementById('billingAddress1'), line2: document.getElementById('billingAddress2'),
      city: document.getElementById('billingCity'), state: document.getElementById('billingState'), zip: document.getElementById('billingPostalCode'),
    },
  }).catch(() => {});

  state.token = await getToken().catch(() => null);
  const account = await me().catch(() => null);
  if (account && !account.needs_profile) {
    document.getElementById('checkoutEmail').value = account.email || '';
    document.getElementById('businessName').value = account.company?.name || '';
    try {
      const saved = await api('/api/account/addresses');
      state.saved = saved.addresses || [];
      renderSavedSelect('shipping', 'ship');
      renderSavedSelect('billing', 'bill');
      document.getElementById('saveAddressWrap').hidden = false;
    } catch { /* account address reuse remains optional */ }
  }

  try {
    const response = await fetch('/api/products', state.token ? { headers: { Authorization: `Bearer ${state.token}` } } : undefined);
    if (response.ok) state.catalog = flattenCatalog((await response.json()).products);
  } catch { /* Stripe revalidates authoritative catalog later */ }
  renderLines();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    invalidateRates();
    calculate.disabled = true;
    calculate.textContent = 'Verifying and calculating…';
    showStatus('Google is verifying the address and ShipEngine is comparing live carrier rates.');
    const values = formValues(form);
    try {
      const response = await fetch('/api/shipping-rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}) },
        body: JSON.stringify({
          cart,
          email: clean(values.email),
          address: checkoutAddress(values, 'shipping'),
          billing_same_as_shipping: sameBilling.checked,
          billing_address: sameBilling.checked ? null : checkoutAddress(values, 'billing'),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(result.error), { status: response.status, data: result });
      state.quote = result;
      state.selectedRate = 0;
      fillAddress('shipping', result.address);
      if (!sameBilling.checked) fillAddress('billing', result.billing_address);
      renderRates();
      showStatus('Addresses verified. Select a shipping method, then continue to payment.', 'ok');
    } catch (error) {
      showStatus(checkoutError(error), 'err');
    } finally {
      calculate.disabled = false;
      calculate.textContent = 'Verify address and calculate shipping';
    }
  });

  async function saveForReuse(type, address) {
    if (state.saved.some((saved) => saved.type === type && addressMatches(saved, address))) return;
    const result = await api('/api/account/addresses', { method: 'POST', body: { address: {
      type, line1: address.address1, line2: address.address2, city: address.city,
      state: address.state, zip: address.postal_code,
      is_default: !state.saved.some((saved) => saved.type === type),
    } } });
    state.saved.push({ id: result.id, type, line1: address.address1, line2: address.address2,
      city: address.city, state: address.state, zip: address.postal_code });
  }

  pay.addEventListener('click', async () => {
    const rate = state.quote?.rates?.[state.selectedRate];
    if (!rate) { showStatus('Calculate and select shipping before payment.', 'err'); return; }
    pay.disabled = true;
    pay.textContent = 'Opening secure payment…';
    showStatus('Saving verified order details and opening Stripe.');
    try {
      if (state.token && document.getElementById('saveAddress').checked) {
        await saveForReuse('ship', state.quote.address);
        await saveForReuse('bill', state.quote.billing_address);
      }
      const values = formValues(form);
      await checkout({
        mode: 'pay', email: clean(values.email), token: state.token,
        purchaseOrderNumber: clean(values.purchaseOrderNumber), shippingQuoteToken: rate.token,
      });
    } catch (error) {
      if (['shipping_quote_expired', 'shipping_quote_cart_changed'].includes(error?.code)) invalidateRates();
      showStatus(checkoutError(error), 'err');
      pay.disabled = !state.quote;
      pay.textContent = 'Continue to secure payment';
    }
  });
}

if (typeof document !== 'undefined') boot();
