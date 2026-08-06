// Printable packing slip. Pure HTML so it renders identically from the admin console and
// from a saved file, and so it can be unit-tested without a browser.
//
// Scoped to a shipment's allocated lines when one is given: a split shipment's slip must
// list what is in THAT carton, otherwise the warehouse packs against the wrong document.
import { htmlEscape } from './supabase.js';
import { orderReference } from './order-integrations.js';

function text(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

function addressLines(order) {
  const root = order?.ship_address || {};
  const address = root.address || root;
  return [
    text(root.name || address.name, 120),
    text(root.company || address.company, 120),
    text(address.line1 || address.address_line1, 160),
    text(address.line2 || address.address_line2, 160),
    [text(address.city, 100), text(address.state, 40), text(address.postal_code, 20)]
      .filter(Boolean).join(', '),
    text(address.country || 'US', 40),
  ].filter(Boolean);
}

export function packingSlipLines(order, shipment = null) {
  const items = Array.isArray(order?.order_items) ? order.order_items : [];
  const allocations = Array.isArray(shipment?.item_allocations) ? shipment.item_allocations : [];
  if (!allocations.length) {
    return items.map((item) => ({
      sku: text(item?.sku, 160),
      name: text(item?.name || item?.sku, 200),
      qty: Math.max(0, Math.floor(Number(item?.qty) || 0)),
      backordered: Boolean(item?.backordered),
    })).filter((line) => line.sku && line.qty > 0);
  }
  const allocatedBySku = new Map(allocations.map((entry) => [
    text(entry?.sku, 160),
    Math.max(0, Math.floor(Number(entry?.quantity ?? entry?.qty) || 0)),
  ]));
  return items
    .filter((item) => allocatedBySku.has(text(item?.sku, 160)))
    .map((item) => ({
      sku: text(item?.sku, 160),
      name: text(item?.name || item?.sku, 200),
      qty: allocatedBySku.get(text(item?.sku, 160)),
      backordered: Boolean(item?.backordered),
    }))
    .filter((line) => line.qty > 0);
}

export function packingSlipHtml(order, { shipment = null, generatedAt = null } = {}) {
  const reference = orderReference(order) || text(order?.id, 40);
  const lines = packingSlipLines(order, shipment);
  const rows = lines.map((line) => `<tr>
      <td>${htmlEscape(line.sku)}</td>
      <td>${htmlEscape(line.name)}${line.backordered ? ' <em>(backordered)</em>' : ''}</td>
      <td class="qty">${line.qty}</td>
      <td class="check"></td>
    </tr>`).join('');
  const address = addressLines(order).map((entry) => htmlEscape(entry)).join('<br>');
  const poNumber = text(order?.purchase_order_number, 64);
  const split = shipment?.split_key && shipment.split_key !== 'default'
    ? ` &middot; Shipment ${htmlEscape(text(shipment.split_key, 40))}`
    : '';

  // No prices: a packing slip travels with the goods and is frequently seen by the
  // recipient's dock staff, not the buyer.
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Packing slip ${htmlEscape(reference)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px; font: 14px/1.5 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #15171c; background: #fff; }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; border-bottom: 2px solid #0e7c86; padding-bottom: 16px; }
  .brand { font-size: 22px; font-weight: 800; letter-spacing: .04em; color: #0e7c86; }
  .brand small { display: block; font-size: 11px; letter-spacing: .16em; color: #6b7280; font-weight: 600; }
  h1 { font-size: 16px; margin: 0 0 4px; }
  .meta { text-align: right; font-size: 13px; color: #4b5563; }
  .panels { display: flex; gap: 32px; margin: 24px 0; }
  .panel { flex: 1; }
  .panel h2 { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: #6b7280; margin: 0 0 8px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { text-align: left; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #6b7280; border-bottom: 2px solid #d7e3e3; padding: 8px 6px; }
  td { border-bottom: 1px solid #eef2f2; padding: 10px 6px; vertical-align: top; }
  .qty { text-align: center; width: 64px; font-variant-numeric: tabular-nums; }
  .check { width: 48px; }
  .check::after { content: ""; display: block; width: 18px; height: 18px; border: 1.5px solid #9ca3af; border-radius: 3px; margin: 0 auto; }
  footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; }
  @media print { body { padding: 0; } @page { margin: 14mm; } }
</style></head>
<body>
  <header>
    <div class="brand">MASEST<small>VERTKLEEN</small></div>
    <div class="meta">
      <h1>Packing slip</h1>
      <div>Order ${htmlEscape(reference)}${split}</div>
      ${poNumber ? `<div>PO ${htmlEscape(poNumber)}</div>` : ''}
      ${generatedAt ? `<div>${htmlEscape(text(generatedAt, 40))}</div>` : ''}
    </div>
  </header>
  <div class="panels">
    <div class="panel"><h2>Ship to</h2><div>${address || '&mdash;'}</div></div>
    <div class="panel"><h2>Carrier</h2><div>${htmlEscape(text(order?.carrier, 80) || 'To be assigned')}${
      text(order?.tracking_number, 160) ? `<br>${htmlEscape(text(order.tracking_number, 160))}` : ''
    }</div></div>
  </div>
  <table>
    <thead><tr><th>SKU</th><th>Product</th><th class="qty">Qty</th><th class="check">Packed</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4">No shippable lines on this shipment.</td></tr>'}</tbody>
  </table>
  <footer>
    MASEST Consulting LLC &middot; Florida's Space Coast &middot; CAGE 0B2Q3 &middot; NAICS 424690<br>
    Questions about this shipment? Reply to your order confirmation email.
  </footer>
</body></html>`;
}
