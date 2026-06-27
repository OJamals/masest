// Safety Data Sheet (SDS) attachment map for order-confirmation emails.
//
// B2B chemical orders should ship with the SDS. Resend can attach a PDF by URL (`path`),
// so the order-confirmation email (functions/api/stripe-webhook.js) attaches one SDS per
// distinct product in the order. SDS-only by design: TDS / labels / user guides are
// downloadable on the product page but are not safety-critical, and limiting the set to
// the SDS keeps the email lean (Resend caps attachments at 40MB).
//
// Two pieces of static data, both LOCKED against the catalog by tests/order-sds-map.test.mjs:
//   STEMS        — every variant-SKU stem (`sku_stem`) from data/catalog.seed.json. Needed in
//                  full so an SKU resolves to its OWN product by longest-prefix and never to a
//                  shorter sibling stem (e.g. VK-CR2 / VK-CRHD must not fall back to VK-CR).
//   SDS_BY_STEM  — the SDS PDF for the products that publish one, derived from
//                  js/main/catalog-data.js PRODUCTS[slug].docs. Products whose SDS is a
//                  manufacturer gap (cr-hd, alumibrite, cr2, glycols, …) are intentionally
//                  absent → those orders simply get no attachment.
// The test fails if a stem is added/renamed or a new product publishes an SDS, so the map
// can never silently drift out of sync with what the storefront actually offers.

export const STEMS = [
  'VK-HCR', 'VK-CR', 'VK-DSC', 'VK-CRHD', 'VK-CRHDLF', 'VK-NEU', 'VK-MW', 'VK-TRQ',
  'VK-ALU', 'VK-PRG', 'VK-LAM3', 'VK-WS60', 'VK-CR2', 'VK-SAR', 'VK-PG100', 'VK-PG50',
  'VK-EG100', 'VK-EG50', 'VK-EGU96', 'VK-EG5050',
];

export const SDS_BY_STEM = {
  'VK-HCR': 'docs/sds/vertkleen-hcr-sds.pdf',
  'VK-CR': 'docs/sds/vertkleen-cr-sds.pdf',
  'VK-DSC': 'docs/sds/vertkleen-descaler-sds.pdf',
  'VK-NEU': 'docs/sds/vertkleen-neutral-sds.pdf',
  'VK-MW': 'docs/sds/vertkleen-multiwash-sds.pdf',
  'VK-TRQ': 'docs/sds/vertkleen-torque-sds.pdf',
  'VK-PRG': 'docs/sds/vertkleen-purgo-sds.pdf',
  'VK-LAM3': 'docs/sds/vertkleen-lam3-sds.pdf',
  'VK-WS60': 'docs/sds/watersafe60-sds.pdf',
  'VK-SAR': 'docs/sds/vertkleen-sar-sds.pdf',
};

// Resolve a variant SKU (e.g. "VK-HCR-2.5", "VK-CRHD-55") to its product's SDS path, or
// null. Matches the LONGEST stem that the SKU equals or begins with ("<stem>-…"), so a
// size suffix never breaks the match and a product is never confused with a sibling whose
// stem is a prefix of it. Unknown SKUs and products without a published SDS return null.
export function sdsForSku(sku) {
  const s = String(sku || '').toUpperCase().trim();
  if (!s) return null;
  let best = null;
  for (const stem of STEMS) {
    if ((s === stem || s.startsWith(`${stem}-`)) && (!best || stem.length > best.length)) {
      best = stem;
    }
  }
  return best ? (SDS_BY_STEM[best] || null) : null;
}

// Build the Resend attachment list for an order's line items: one SDS per distinct product,
// fetched by Resend from the public site URL (`path`). Deduped by file and capped. `appUrl`
// may carry a trailing slash. Returns [] when nothing matches — the caller then sends a
// plain confirmation, exactly as before.
export function sdsAttachments(lines, appUrl, cap = 12) {
  const base = String(appUrl || 'https://masest.co').replace(/\/+$/, '');
  const seen = new Set();
  const out = [];
  for (const l of lines || []) {
    const file = sdsForSku(l?.sku);
    if (!file || seen.has(file)) continue;
    seen.add(file);
    out.push({ filename: file.split('/').pop(), path: `${base}/${file}` });
    if (out.length >= cap) break;
  }
  return out;
}
