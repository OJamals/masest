const money = (amount, currency = 'usd') => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: String(currency).toUpperCase(),
}).format(Number(amount) || 0);
const clean = (value) => String(value ?? '').trim();
const escapeHtml = (value) => clean(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

export function checkoutAddress(values, prefix) {
  return {
    name: [clean(values.firstName), clean(values.lastName)].filter(Boolean).join(' '),
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
  // Errors that name specific cart lines are useless without those lines — a buyer told
  // only "checkout could not continue" has no way to find the one item at fault.
  const skus = Array.isArray(error?.data?.skus) ? error.data.skus.filter(Boolean) : [];
  const skuList = skus.length ? ` (${skus.join(', ')})` : '';
  return ({
    address_incomplete: 'Enter a complete U.S. address.',
    shipping_address_incomplete: 'Enter a complete shipping address and phone number.',
    shipping_address_invalid: 'One of the address fields has an unexpected character or is too long.',
    shipping_domestic_only: 'Online checkout ships within the United States. Request a quote for international freight.',
    address_not_deliverable: 'Google could not confirm this delivery address. Review the street, unit, city, state, and ZIP.',
    address_validation_unavailable: 'Address verification is temporarily unavailable. Try again.',
    address_validation_not_configured: 'Address verification is offline. Contact MASEST and we will place this order for you.',
    shipping_package_profile_missing: 'A cart item is missing shipping dimensions. Return to the cart and request a freight quote.',
    shipping_cart_too_large: 'This cart needs freight planning. Send a quote request for a consolidated shipment.',
    shipping_rates_unavailable: 'No live carrier rate is available for this address and cart.',
    shipping_rates_not_configured: 'Live shipping rates are offline. Contact MASEST and we will place this order for you.',
    shipping_quote_not_configured: 'Live shipping rates are offline. Contact MASEST and we will place this order for you.',
    shipping_carriers_unavailable: 'No carrier is available right now. Try again shortly.',
    shipping_quote_expired: 'Shipping rate expired. Recalculate shipping before payment.',
    shipping_quote_cart_changed: 'Cart changed. Recalculate shipping before payment.',
    shipping_quote_required: 'Calculate shipping before continuing to payment.',
    shipping_quote_invalid: 'Shipping selection could not be verified. Recalculate rates.',
    shipping_product_unavailable: `An item in your cart is not available for online checkout${skuList}. Request a quote instead.`,
    out_of_stock: `Not enough stock for every item${skuList}. Adjust quantities in the cart or request a quote.`,
    not_purchasable: `These items need bulk freight review before checkout${skuList}. Use the quote form.`,
    mixed_currency: 'Items in your cart use different currencies. Order them separately.',
    rate_limited: 'Too many shipping calculations. Wait a moment and try again.',
    request_too_large: 'This cart is too large to process here. Request a quote instead.',
    stripe_customer_setup_failed: 'Stripe could not update this account address. Try again.',
    net_checkout_unavailable: 'Ordering on account is arranged by your MASEST account team. Request a quote to order on NET terms.',
    stripe_error: 'Stripe could not start payment. Try again.',
  })[code] || 'Checkout could not continue. Review the form and try again.';
}

function productMeta(parent, variant) {
  return {
    name: `${parent.name || variant.name || variant.vsku} - ${variant.label || 'Each'}`,
    price: Number(variant.price),
    currency: variant.currency || parent.currency || 'usd',
    imageUrl: parent.image_url || variant.image_url || '',
    imageAlt: parent.photo_alt || `${parent.name || variant.name || 'Product'} product photo`,
  };
}

export function uniqueServiceRates(rates = []) {
  const cheapest = new Map();
  rates.forEach((rate, index) => {
    const key = `${clean(rate.carrier_name).toLowerCase()}|${clean(rate.service_type).toLowerCase()}`;
    const current = cheapest.get(key);
    const amount = Number(rate.amount_minor);
    const currentAmount = Number(current?.rate?.amount_minor);
    if (!current || (Number.isFinite(amount) && (!Number.isFinite(currentAmount) || amount < currentAmount))) {
      cheapest.set(key, { rate, index });
    }
  });
  const amount = ({ rate }) => Number.isFinite(Number(rate.amount_minor)) ? Number(rate.amount_minor) : Number.POSITIVE_INFINITY;
  return [...cheapest.values()].sort((a, b) => amount(a) - amount(b) || a.index - b.index);
}

export function groupServiceRates(rates = [], visibleCount = 3) {
  const unique = uniqueServiceRates(rates);
  const count = Math.max(1, Number(visibleCount) || 3);
  return { recommended: unique.slice(0, count), additional: unique.slice(count) };
}

// "Arrives Tue, Aug 11" beats "5 business days": a buyer comparing options is deciding
// whether the goods land before a job starts, not counting transit days. The carrier's own
// estimated_delivery_date is authoritative; delivery_days is the fallback, projected over
// business days only so a Friday quote doesn't promise a Sunday delivery.
// A delivery date is a calendar date, not an instant. Carriers send it as UTC midnight, so
// formatting it in the viewer's local zone renders the PREVIOUS day for everyone west of
// UTC — a buyer in Florida would be told Monday for a Tuesday delivery. All of this works
// in UTC calendar space so the date reads the same wherever it is shown.
const utcDay = (date) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

// Handling and the warehouse cutoff are applied server-side, by sending the real dispatch
// date as ship_date on the rate request (functions/_lib/fulfillment-schedule.js). The
// carrier then answers with an arrival date that already accounts for it, using its own
// service calendar and holidays. So nothing is shifted here — shifting again would
// double-count the handling and quote every option a day slower than it is.
//
// bufferDays exists only as a lever: raise it to widen the shown answer into a range once
// real delivered-vs-promised data from shipment_events justifies a number.
export const DATE_DISPLAY_POLICY = Object.freeze({ bufferDays: 0 });

export function businessDaysFromNow(days, from = new Date()) {
  const count = Number(days);
  if (!Number.isFinite(count) || count <= 0) return null;
  const date = new Date(utcDay(from));
  let remaining = Math.ceil(count);
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return date;
}

// The window a buyer can actually plan around: the carrier's transit estimate pushed out
// Explains why the shown date is later than the raw transit time a buyer would see on the
// carrier's own site. Rendered from the server's fulfillment object rather than written as
// copy, so the explanation cannot describe a policy the dates were not built with.
export function fulfillmentNote(fulfillment = {}) {
  const handling = Math.max(0, Number(fulfillment.handling_days) || 0);
  const hour = Number(fulfillment.cutoff_hour_et) || 0;
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  const parts = [];
  if (handling > 0) {
    parts.push(`Dates include ${handling} business day${handling === 1 ? '' : 's'} for order handling`);
  }
  if (hour > 0 && hour < 24) {
    parts.push(`orders placed after ${display}:00 ${suffix} ET ship the next business day`);
  }
  return parts.length ? `${parts.join('; ')}.` : '';
}

// The carrier's own answer, already computed from the dispatch date the server sent it.
// `shipDate` matters only on the fallback path, where the provider returned a transit-day
// count instead of a date — counting those from today would silently drop the handling time
// that the ship_date had accounted for.
export function arrivalWindow(rate = {}, { shipDate = null, policy = DATE_DISPLAY_POLICY } = {}) {
  const iso = clean(rate.estimated_delivery_date);
  const from = shipDate ? new Date(`${clean(shipDate)}T00:00:00Z`) : new Date();
  const base = iso ? new Date(iso) : businessDaysFromNow(rate.delivery_days, from);
  if (!base || Number.isNaN(base.getTime())) return null;
  const earliest = new Date(utcDay(base));
  const buffer = Math.max(0, Number(policy.bufferDays) || 0);
  return { earliest, latest: buffer > 0 ? businessDaysFromNow(buffer, earliest) : earliest };
}

const arrivalDay = (date) => new Intl.DateTimeFormat('en-US', {
  weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
}).format(date);
const arrivalMonthDay = (date) => new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', timeZone: 'UTC',
}).format(date);

export function arrivalLabel(rate = {}, options = {}) {
  const window = arrivalWindow(rate, options);
  if (!window) return null;
  const { earliest, latest } = window;
  if (utcDay(earliest) === utcDay(latest)) return `Arrives ${arrivalDay(earliest)}`;
  // Same month reads as "Aug 11–13"; across a boundary it needs both months spelled out.
  const sameMonth = earliest.getUTCMonth() === latest.getUTCMonth()
    && earliest.getUTCFullYear() === latest.getUTCFullYear();
  return sameMonth
    ? `Arrives ${arrivalMonthDay(earliest)}–${latest.getUTCDate()}`
    : `Arrives ${arrivalMonthDay(earliest)} – ${arrivalMonthDay(latest)}`;
}

export function shippingServiceLabel(rate = {}) {
  const carrier = clean(rate.carrier_name).replace(/\s+One Balance$/i, '');
  const service = clean(rate.service_type);
  if (!service) return carrier;
  if (!carrier) return service;
  const escapedCarrier = carrier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return service.replace(new RegExp(`^${escapedCarrier}[®™]?\\s*(?:[·–—-]\\s*)?`, 'i'), '').trim() || service;
}

function shippingServiceSummary(rate = {}) {
  const carrier = clean(rate.carrier_name).replace(/\s+One Balance$/i, '');
  return [carrier, shippingServiceLabel(rate)].filter(Boolean).join(' ');
}

function flattenCatalog(products) {
  const catalog = new Map();
  for (const entry of products || []) {
    const parent = entry.products && typeof entry.products === 'object' ? entry.products : entry;
    if (entry.vsku) {
      catalog.set(entry.vsku, productMeta(parent, entry));
      continue;
    }
    for (const variant of entry.product_variants || []) {
      catalog.set(variant.vsku, productMeta(entry, variant));
    }
  }
  return catalog;
}

export function cartPricing(cart = [], catalog = new Map()) {
  let total = 0;
  let currency = null;
  for (const line of cart) {
    const product = catalog.get(line.sku);
    if (!Number.isFinite(product?.price)) return { known: false, total: null, currency: currency || 'usd' };
    const productCurrency = clean(product.currency || 'usd').toLowerCase();
    if (currency && productCurrency !== currency) return { known: false, total: null, currency };
    currency = productCurrency;
    total += product.price * line.qty;
  }
  return { known: true, total, currency: currency || 'usd' };
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
  const [cartModule, autocompleteModule, authModule, staffModule] = await Promise.all([
    import('./cart.js'),
    import('./address-autocomplete.js?v=20260807e'),
    import('./auth.js?v=20260711w'),
    import('./staff-surface.js?v=20260807e'),
  ]);
  const { checkout, items } = cartModule;
  const { mountAddressAutocomplete } = autocompleteModule;
  const { api, getToken, me } = authModule;
  const { isStaffAccount, replaceBuyerSurface } = staffModule;
  const cart = items();
  const empty = document.getElementById('checkoutEmpty');
  const shell = document.getElementById('checkoutShell');
  if (!cart.length) { empty.hidden = false; return; }
  shell.hidden = false;

  // Staff do not buy through the storefront — they raise orders in the admin
  // console, which is why the nav hides their cart. Gated here, before any
  // listener is wired or catalog fetched, so the rest of boot never runs for
  // them. After the shell is shown rather than before it, so a signed-in buyer
  // does not stare at a blank page waiting on /api/account/me; nothing can be
  // paid in that window anyway, since payment unlocks only once a live shipping
  // rate has been calculated and selected.
  const staffAccount = await me().catch(() => null);
  if (isStaffAccount(staffAccount)) {
    replaceBuyerSurface(document.getElementById('main'), {
      title: 'Checkout is a customer surface',
      body: 'Staff place and edit orders in the admin console, where pricing, terms, and the customer account are all in one place.',
    });
    return;
  }

  const form = document.getElementById('checkoutDetails');
  const status = document.getElementById('checkoutStatus');
  const ratesBox = document.getElementById('shippingRates');
  const rateOptions = document.getElementById('shippingRateOptions');
  const pay = document.getElementById('checkoutPay');
  const payHint = document.getElementById('checkoutPayHint');
  const calculate = document.getElementById('calculateShipping');
  const sameBilling = document.getElementById('billingSameAsShipping');
  const billingFields = document.getElementById('billingAddressFields');
  const shippingPending = document.getElementById('shippingPending');
  const state = { catalog: new Map(), saved: [], token: null, quote: null, selectedRate: null };

  function showStatus(message, kind = '') {
    status.textContent = message;
    status.dataset.state = kind;
    status.hidden = !message;
  }

  function addressElements(prefix) {
    return {
      mount: document.getElementById(`${prefix}Autocomplete`),
      line1: document.getElementById(`${prefix}Address1`),
      details: document.getElementById(`${prefix}AddressDetails`),
      manual: document.getElementById(`${prefix}ManualToggle`),
      suite: document.getElementById(`${prefix}SuiteToggle`),
      suiteField: document.getElementById(`${prefix}Address2Field`),
    };
  }

  function showAddressDetails(prefix) {
    const ui = addressElements(prefix);
    ui.details.hidden = false;
    ui.manual.textContent = 'Edit address manually';
    if (clean(document.getElementById(`${prefix}Address2`)?.value)) {
      ui.suiteField.hidden = false;
      ui.suite.hidden = true;
    }
  }

  function showManualAddress(prefix, focus = true) {
    const ui = addressElements(prefix);
    document.getElementById(`${prefix}AddressLabel`).htmlFor = `${prefix}Address1`;
    ui.mount.hidden = true;
    ui.line1.hidden = false;
    ui.details.hidden = false;
    ui.manual.hidden = true;
    if (focus) ui.line1.focus();
  }

  function toggleSuite(prefix) {
    const ui = addressElements(prefix);
    const opening = ui.suiteField.hidden;
    ui.suiteField.hidden = !opening;
    ui.suite.hidden = opening;
    ui.suite.setAttribute('aria-expanded', String(opening));
    if (opening) document.getElementById(`${prefix}Address2`).focus();
  }

  function toggleBilling() {
    const same = sameBilling.checked;
    billingFields.hidden = same;
    billingFields.querySelectorAll('input,select').forEach((field) => { field.disabled = same; });
  }

  function invalidateRates() {
    const hadQuote = Boolean(state.quote);
    state.quote = null;
    state.selectedRate = null;
    rateOptions.replaceChildren();
    ratesBox.hidden = true;
    pay.disabled = true;
    payHint.textContent = 'Confirm your address and select a shipping method to continue.';
    shippingPending.textContent = 'Shipping calculated after address confirmation.';
    calculate.classList.add('btn-primary');
    calculate.classList.remove('btn-secondary', 'checkout-recalculate');
    calculate.textContent = 'Confirm address & view rates';
    showStatus('');
    if (hadQuote) renderTotals();
  }

  // The dispatch date the rates were quoted against, as returned by /api/shipping-rates.
  const shipDate = () => state.quote?.fulfillment?.ship_date || null;

  function renderTotals() {
    const pricing = cartPricing(cart, state.catalog);
    const { currency } = pricing;
    const selected = state.quote?.rates?.[state.selectedRate];
    const shipping = selected?.amount_minor;
    // Put the delivery date next to the money it costs, so the trade-off the buyer is
    // actually making — pay more, get it sooner — is legible in one place.
    const shippingNote = shipping == null
      ? 'Select a shipping method'
      : [shippingServiceSummary(selected), arrivalLabel(selected, { shipDate: shipDate() })]
        .filter(Boolean).join(' · ');
    document.getElementById('checkoutTotals').innerHTML = `<dl>
      <div><dt>Product subtotal</dt><dd>${pricing.known ? money(pricing.total, currency) : 'At payment'}</dd></div>
      <div><dt>Shipping<small>${escapeHtml(shippingNote)}</small></dt><dd>${shipping == null ? '—' : money(shipping / 100, currency)}</dd></div>
      <div><dt>Tax</dt><dd>At payment</dd></div>
      <div class="cart-total-row"><dt>Estimated total</dt><dd>${pricing.known ? money(pricing.total + (shipping || 0) / 100, currency) : 'At payment'}</dd></div>
    </dl>`;
  }

  function renderLines() {
    document.getElementById('checkoutLines').innerHTML = cart.map((line) => {
      const product = state.catalog.get(line.sku);
      const media = product?.imageUrl
        ? `<figure class="checkout-line-media"><img src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.imageAlt)}"></figure>`
        : '';
      return `<article class="checkout-line">${media}<span><b>${escapeHtml(product?.name || line.sku)}</b><small>${escapeHtml(line.sku)}</small><small>Qty: ${line.qty}</small></span><strong>${product ? money(product.price * line.qty, product.currency) : 'At payment'}</strong></article>`;
    }).join('');
    renderTotals();
  }

  function renderRates() {
    const { recommended, additional } = groupServiceRates(state.quote.rates);
    const rates = [...recommended, ...additional];
    const renderRate = ({ rate, index }, position) => {
      const label = document.createElement('label');
      label.className = 'checkout-rate';
      // Stagger the options in rather than dropping the whole block at once.
      label.style.setProperty('--rate-delay', `${Math.min(position, 6) * 40}ms`);
      const radio = document.createElement('input');
      radio.type = 'radio'; radio.name = 'shippingRate'; radio.value = String(index); radio.checked = index === state.selectedRate;
      const text = document.createElement('span');
      const carrier = clean(rate.carrier_name).replace(/\s+One Balance$/i, '');
      const arrival = arrivalLabel(rate, { shipDate: shipDate() });
      // Lead with the date, fall back to the service name only when the carrier gave no
      // estimate — a row whose headline is "Carrier estimate at shipment" tells the buyer
      // nothing they can decide on.
      const service = [carrier, shippingServiceLabel(rate)].filter(Boolean).join(' ');
      const meta = [arrival ? service : null, position === 0 ? 'Lowest rate' : null].filter(Boolean).join(' · ');
      text.innerHTML = `<b>${escapeHtml(arrival || service)}</b>${
        meta ? `<small>${escapeHtml(meta)}</small>` : '<small>Carrier estimate at shipment</small>'
      }`;
      const price = document.createElement('strong');
      price.textContent = money(rate.amount_minor / 100, rate.currency);
      label.append(radio, text, price);
      return label;
    };
    rateOptions.replaceChildren(...recommended.map(renderRate));
    if (additional.length) {
      const more = document.createElement('details');
      more.className = 'checkout-rate-more';
      const summary = document.createElement('summary');
      summary.textContent = `Show ${additional.length} more shipping methods`;
      const options = document.createElement('div');
      options.className = 'checkout-rate-more-options';
      options.append(...additional.map((entry, index) => renderRate(entry, recommended.length + index)));
      more.append(summary, options);
      rateOptions.append(more);
    }
    // Rendered from the policy rather than written as copy, so the note can never claim a
    // handling time the dates were not actually calculated with.
    const note = document.getElementById('shippingRateNote');
    if (note) note.textContent = fulfillmentNote(state.quote?.fulfillment);
    ratesBox.hidden = false;
    pay.disabled = !rates.length;
    payHint.textContent = rates.length ? 'Secure payment opens on Stripe.' : 'No shipping method is available.';
    const validation = state.quote.address_validation;
    document.getElementById('addressVerification').textContent = validation?.corrected
      ? `Google standardized the address · ${state.quote.package_count} package${state.quote.package_count === 1 ? '' : 's'}`
      : `Google verified the address · ${state.quote.package_count} package${state.quote.package_count === 1 ? '' : 's'}`;
    shippingPending.innerHTML = `<i class="ph ph-check-circle" aria-hidden="true"></i> ${state.quote.package_count} package${state.quote.package_count === 1 ? '' : 's'} rated with live carrier pricing.`;
    calculate.classList.remove('btn-primary');
    calculate.classList.add('btn-secondary', 'checkout-recalculate');
    calculate.textContent = 'Recalculate rates';
    const selected = state.quote.rates[state.selectedRate];
    showStatus(`Address verified. ${shippingServiceSummary(selected)} selected. Continue to secure payment.`, 'ok');
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
    showManualAddress(prefix, false);
    wrap.hidden = false;
    select.addEventListener('change', () => {
      const selected = state.saved.find((address) => address.id === select.value);
      fillAddress(prefix, selected || {});
      showManualAddress(prefix, false);
      invalidateRates();
    });
  }

  async function mountAddress(prefix) {
    const result = await mountAddressAutocomplete({
      mount: document.getElementById(`${prefix}Autocomplete`),
      fields: {
        line1: document.getElementById(`${prefix}Address1`),
        line2: document.getElementById(`${prefix}Address2`),
        city: document.getElementById(`${prefix}City`),
        state: document.getElementById(`${prefix}State`),
        zip: document.getElementById(`${prefix}PostalCode`),
      },
      placeholder: 'Start typing a street address',
      ariaLabel: `${prefix === 'shipping' ? 'Shipping' : 'Billing'} street address`,
      onSelect: () => {
        showAddressDetails(prefix);
        invalidateRates();
      },
    });
    if (result.enabled) document.getElementById(`${prefix}AddressLabel`).htmlFor = result.autocomplete.id;
    if (!result.enabled) showManualAddress(prefix, false);
  }

  function firstIncompleteAddressField(prefix) {
    return ['Address1', 'City', 'State', 'PostalCode']
      .map((suffix) => document.getElementById(`${prefix}${suffix}`))
      .find((field) => !clean(field?.value));
  }

  function revealIncompleteAddress() {
    const prefixes = sameBilling.checked ? ['shipping'] : ['shipping', 'billing'];
    for (const prefix of prefixes) {
      const field = firstIncompleteAddressField(prefix);
      if (!field) continue;
      showManualAddress(prefix, false);
      field.focus();
      showStatus(`Complete the ${prefix} address before viewing rates.`, 'err');
      return true;
    }
    return false;
  }

  document.getElementById('poToggle').addEventListener('click', (event) => {
    const field = document.getElementById('purchaseOrderField');
    const opening = field.hidden;
    field.hidden = !opening;
    event.currentTarget.setAttribute('aria-expanded', String(opening));
    event.currentTarget.innerHTML = opening
      ? '<i class="ph ph-minus" aria-hidden="true"></i> Remove PO number'
      : '<i class="ph ph-plus" aria-hidden="true"></i> Add PO number';
    if (opening) document.getElementById('purchaseOrderNumber').focus();
  });
  for (const prefix of ['shipping', 'billing']) {
    document.getElementById(`${prefix}ManualToggle`).addEventListener('click', () => showManualAddress(prefix));
    document.getElementById(`${prefix}SuiteToggle`).addEventListener('click', () => toggleSuite(prefix));
  }
  toggleBilling();
  sameBilling.addEventListener('change', () => { toggleBilling(); invalidateRates(); });
  const rateBoundFields = new Set([
    'firstName', 'lastName', 'phone', 'businessName',
    'shippingAutocomplete', 'billingAutocomplete',
    'shippingAddress1', 'shippingAddress2', 'shippingCity', 'shippingState', 'shippingPostalCode', 'shippingResidential',
    'billingAddress1', 'billingAddress2', 'billingCity', 'billingState', 'billingPostalCode',
  ]);
  form.addEventListener('input', (event) => {
    if (rateBoundFields.has(event.target.name)) invalidateRates();
  });
  rateOptions.addEventListener('change', (event) => {
    if (event.target.name !== 'shippingRate') return;
    state.selectedRate = Number(event.target.value);
    const selected = state.quote?.rates?.[state.selectedRate];
    payHint.textContent = `${shippingServiceSummary(selected)} selected. Secure payment opens on Stripe.`;
    showStatus(`${shippingServiceSummary(selected)} selected. Continue to secure payment.`, 'ok');
    renderTotals();
  });

  mountAddress('shipping').catch(() => showManualAddress('shipping', false));
  mountAddress('billing').catch(() => showManualAddress('billing', false));

  state.token = await getToken().catch(() => null);
  const account = staffAccount; // resolved by the staff gate above; one me() per load
  if (account && !account.needs_profile) {
    const [firstName = '', ...lastName] = clean(account.profile?.full_name || account.full_name).split(/\s+/);
    document.getElementById('firstName').value = firstName;
    document.getElementById('lastName').value = lastName.join(' ');
    document.getElementById('checkoutEmail').value = account.email || '';
    document.getElementById('phone').value = account.profile?.phone || account.phone || '';
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
    if (revealIncompleteAddress() || !form.reportValidity()) return;
    invalidateRates();
    calculate.disabled = true;
    calculate.textContent = 'Verifying address & calculating…';
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
      showAddressDetails('shipping');
      if (!sameBilling.checked) {
        fillAddress('billing', result.billing_address);
        showAddressDetails('billing');
      }
      renderRates();
    } catch (error) {
      showStatus(checkoutError(error), 'err');
    } finally {
      calculate.disabled = false;
      calculate.textContent = state.quote ? 'Recalculate rates' : 'Confirm address & view rates';
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
        const reusable = [['ship', state.quote.address], ['bill', state.quote.billing_address]]
          .filter(([, address]) => clean(address?.address1));
        await Promise.allSettled(reusable.map(([type, address]) => saveForReuse(type, address)));
      }
      const values = formValues(form);
      await checkout({
        email: clean(values.email), token: state.token,
        purchaseOrderNumber: clean(values.purchaseOrderNumber), shippingQuoteToken: rate.token,
      });
    } catch (error) {
      if (['shipping_quote_expired', 'shipping_quote_cart_changed'].includes(error?.code)) invalidateRates();
      showStatus(checkoutError(error), 'err');
      pay.disabled = !state.quote;
      pay.innerHTML = 'Continue to payment <i class="ph ph-lock-key" aria-hidden="true"></i>';
    }
  });
}

if (typeof document !== 'undefined') boot();
