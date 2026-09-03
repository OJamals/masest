// Copy for a shipment state change, keyed on the buyer-visible tracking status. Shared so
// an automatic carrier scan and a manual staff update read identically to the buyer.
export function shipmentNotice(trackingStatus, { carrier = null, trackingNumber = null } = {}) {
  const status = String(trackingStatus || '').trim();
  if (status === 'delivered') {
    return {
      label: 'delivered',
      body: 'Your order was delivered. Reply to this email if anything arrived short or damaged.',
    };
  }
  if (status === 'shipped') {
    return {
      label: 'shipped',
      body: trackingNumber
        ? `Your order has shipped. ${[carrier || 'Carrier', trackingNumber].filter(Boolean).join(' ')}`.trim()
        : 'Your order has shipped.',
    };
  }
  if (status === 'blocked') {
    return {
      label: 'on hold',
      body: 'The carrier reported an exception on your shipment. MASEST is following up — reply to this email if you need it sooner.',
    };
  }
  if (status === 'packing') {
    return { label: 'packing', body: 'Your order is being packed and prepared for shipment.' };
  }
  return {
    label: 'tracking updated',
    body: [carrier || 'Carrier', trackingNumber || ''].filter(Boolean).join(' ').trim()
      || 'Your order tracking was updated.',
  };
}
