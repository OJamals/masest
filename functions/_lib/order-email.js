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

// One-line note that the order's SDS PDFs are attached. '' when none. Matches the Stripe
// path's wording so both confirmation emails read the same.
export function sdsNoteHtml(count) {
  const n = Number(count) || 0;
  if (n <= 0) return '';
  return `<p style="margin:14px 0 0;color:#556;font-size:13px;line-height:1.5">`
    + `Safety Data Sheet${n > 1 ? 's are' : ' is'} attached to this email for the ${n > 1 ? 'products' : 'product'} you ordered.</p>`;
}
