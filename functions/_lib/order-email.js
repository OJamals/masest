// Shared building blocks for order-confirmation emails. Pure (HTML strings only) so both
// the Stripe webhook and the NET account-checkout path can render a consistent itemized
// receipt. The Stripe path keeps its own inline template for now; new callers use these.
import { htmlEscape } from './supabase.js';

export const money = (n, currency) => `${String(currency || 'USD').toUpperCase()} ${Number(n || 0).toFixed(2)}`;

// Itemized table + optional totals for an order email. `lines`: { name, sku, qty, unit_price }.
// Each totals row is rendered only when its value is provided (a NET order has no tax line).
export function orderItemsTableHtml(lines, { currency = 'usd', subtotal = null, tax = null, total = null } = {}) {
  const rows = (lines || []).map((l) => {
    const qty = Number(l.qty) || 0;
    const amount = (Number(l.unit_price) || 0) * qty;
    return `<tr>`
      + `<td style="padding:8px 0;border-bottom:1px solid #eef">${htmlEscape(l.name)}`
      + `${l.sku ? ` <span style="color:#789">(${htmlEscape(l.sku)})</span>` : ''}</td>`
      + `<td style="padding:8px 0;border-bottom:1px solid #eef;text-align:center">${qty}</td>`
      + `<td style="padding:8px 0;border-bottom:1px solid #eef;text-align:right">${money(amount, currency)}</td>`
      + `</tr>`;
  }).join('');
  const totalRow = (label, value, bold) => `<tr>`
    + `<td style="padding:${bold ? '6px' : '3px'} 0;color:#556${bold ? ';font-weight:bold;border-top:1px solid #ccd' : ''}">${label}</td>`
    + `<td style="padding:${bold ? '6px' : '3px'} 0;text-align:right${bold ? ';font-weight:bold;border-top:1px solid #ccd' : ''}">${money(value, currency)}</td>`
    + `</tr>`;
  const totals = [
    subtotal != null ? totalRow('Subtotal', subtotal, false) : '',
    tax != null ? totalRow('Tax', tax, false) : '',
    total != null ? totalRow('Total', total, true) : '',
  ].filter(Boolean).join('');
  return `<table style="width:100%;border-collapse:collapse;font-size:14px">`
    + `<thead><tr>`
    + `<th style="text-align:left;padding:6px 0;border-bottom:2px solid #d7e3e3">Product</th>`
    + `<th style="text-align:center;padding:6px 0;border-bottom:2px solid #d7e3e3">Qty</th>`
    + `<th style="text-align:right;padding:6px 0;border-bottom:2px solid #d7e3e3">Amount</th>`
    + `</tr></thead><tbody>${rows}</tbody></table>`
    + (totals ? `<table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:10px">${totals}</table>` : '');
}

// Copy for a shipment state change, keyed on the buyer-visible tracking status. Shared so
// an automatic carrier scan and a manual staff update read identically to the buyer.
export function shipmentNotice(trackingStatus, { carrier = null, trackingNumber = null } = {}) {
  const status = String(trackingStatus || '').trim();
  if (status === 'delivered') {
    return {
      label: 'delivered',
      body: 'Your order was delivered. Reorder anytime from your dashboard, and reply to this email if anything arrived short or damaged.',
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
    return { label: 'packing', body: 'Your order is being packed and a shipping label has been created.' };
  }
  return {
    label: 'tracking updated',
    body: [carrier || 'Carrier', trackingNumber || ''].filter(Boolean).join(' ').trim()
      || 'Your order tracking was updated.',
  };
}

// Rich shipment email body: carrier / tracking # / ETA. Pure — the caller supplies the
// layout shell, so the effect worker and the admin update path render the same email.
export function shipmentEmailHtml(order, label, extra) {
  const details = [
    order?.carrier ? `<li><strong>Carrier:</strong> ${htmlEscape(order.carrier)}</li>` : '',
    order?.tracking_number ? `<li><strong>Tracking #:</strong> ${htmlEscape(order.tracking_number)}</li>` : '',
    order?.estimated_delivery_at ? `<li><strong>Estimated delivery:</strong> ${htmlEscape(order.estimated_delivery_at)}</li>` : '',
  ].filter(Boolean).join('');
  return `<p>${htmlEscape(extra || `Your order is now "${label}".`)}</p>${details ? `<ul>${details}</ul>` : ''}`;
}

// Delivered points at the dashboard (reorder + history); in-transit states keep the
// carrier tracking link front and center.
export function shipmentEmailCta(order, label, appUrl = 'https://masest.co') {
  const base = String(appUrl || 'https://masest.co').replace(/\/+$/, '');
  if (label === 'delivered') {
    return { ctaText: 'View order & reorder', ctaUrl: `${base}/dashboard.html#orders` };
  }
  return {
    ctaText: order?.tracking_url ? 'Track shipment' : 'Visit MASEST',
    ctaUrl: order?.tracking_url || base,
  };
}

export function technicalDocumentRequestNoteHtml(appUrl = 'https://masest.co') {
  const base = htmlEscape(String(appUrl).replace(/\/+$/, ''));
  return `<p style="margin:14px 0 0;color:#556;font-size:13px;line-height:1.5">`
    + `SDS and TDS files are request-only. <a href="${base}/resources">Register or sign in to request access.</a></p>`;
}
