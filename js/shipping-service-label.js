// Carrier + service naming, shared by the checkout rate list and the cart's ZIP estimate.
//
// Providers repeat the carrier inside service_type ("USPS Priority Mail", "UPS® Ground"),
// so pairing the two fields naively renders "UPS UPS® Ground". Both surfaces name the same
// rate, so they normalize it the same way — and this lives outside js/checkout.js because
// that module self-boots the checkout page on import.
const clean = (value) => String(value ?? '').trim();

export function shippingCarrierName(rate = {}) {
  return clean(rate.carrier_name).replace(/\s+One Balance$/i, '');
}

export function shippingServiceLabel(rate = {}) {
  const carrier = shippingCarrierName(rate);
  const service = clean(rate.service_type);
  if (!service) return carrier;
  if (!carrier) return service;
  const escapedCarrier = carrier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return service.replace(new RegExp(`^${escapedCarrier}[®™]?\\s*(?:[·–—-]\\s*)?`, 'i'), '').trim() || service;
}

export function shippingServiceSummary(rate = {}) {
  return [shippingCarrierName(rate), shippingServiceLabel(rate)].filter(Boolean).join(' ');
}
