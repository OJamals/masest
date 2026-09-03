import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderBlogEmail } from '../../functions/_lib/blog-newsletter.js';
import {
  renderCommerceEmail,
  renderMarketingEmail,
  renderSupportEmail,
} from '../../functions/_lib/email-renderers.js';
import { renderNewsletterEmail } from '../../functions/_lib/newsletter.js';

const root = dirname(fileURLToPath(import.meta.url));
const outputDir = join(root, 'rendered');
mkdirSync(outputDir, { recursive: true });

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

const order = {
  id: 'order-1',
  order_number: 'MST-00000005',
  created_at: '2026-09-03T14:30:00Z',
  currency: 'usd',
  subtotal: 578,
  shipping: 84,
  tax: 46.34,
  total: 708.34,
  user_id: 'user-1',
  purchase_order_number: 'PO-100',
  shipping_address: {
    name: 'Omar Rahman',
    company: 'Sample Facility',
    line1: '100 Industrial Way',
    city: 'Orlando',
    state: 'FL',
    postal_code: '32801',
  },
};

const items = [{
  name: 'VertKleen HVAC HCR',
  sku: 'VK-HCR-T16',
  pack: '5-gallon pail',
  qty: 2,
  unit_price: 289,
  image_url: 'https://media.masest.co/site/img/products/hvac-hcr-studio.webp',
  image_alt: 'VertKleen HVAC HCR five-gallon pail',
  image_width: 900,
  image_height: 1200,
}];

const previews = {
  'support-thread.html': renderSupportEmail({
    thread: {
      headers: {
        'In-Reply-To': '<parent@example.com>',
        References: '<root@example.com> <parent@example.com>',
      },
      viewUrl: 'https://masest.co/dashboard.html?order=order-1#messages',
      topic: 'Product compatibility for condenser coils',
    },
    message: {
      body: 'HCR is the better starting point for that deposit. Begin with the label dilution, verify material compatibility, and test a small area before the full clean.',
      sender_role: 'staff',
      sender_name: 'MASEST Support',
      created_at: '2026-09-03T14:42:00Z',
    },
    priorMessages: [
      { body: 'Can I use HCR on this condenser coil?', sender_role: 'buyer', created_at: '2026-09-03T14:31:00Z' },
      { body: 'What deposit and substrate are you working with?', sender_role: 'staff', created_at: '2026-09-03T14:35:00Z' },
    ],
    participant: { name: 'Northwind HVAC' },
    order: {
      id: order.id,
      reference: order.order_number,
      status: 'shipped',
      viewUrl: 'https://masest.co/dashboard.html?order=order-1#orders',
    },
    audience: 'buyer',
  }),
  'order-confirmation.html': renderCommerceEmail({
    event: 'confirmed',
    order,
    payment: { status: 'paid', label: 'Paid' },
    items,
    appUrl: 'https://masest.co',
  }),
  'shipment.html': renderCommerceEmail({
    event: 'shipped',
    order,
    fulfillment: {
      carrier: 'UPS',
      trackingNumber: '1Z999AA10123456784',
      trackingUrl: 'https://www.ups.com/track?loc=en_US&tracknum=1Z999AA10123456784',
      estimatedDelivery: '2026-09-08T12:00:00Z',
      method: 'UPS Ground',
      items,
    },
    appUrl: 'https://masest.co',
  }),
  'refund.html': renderCommerceEmail({
    event: 'refunded',
    order,
    refund: {
      amount: 289,
      methodLabel: 'the original payment method',
      remainingTotal: 419.34,
      items: [{ name: 'VertKleen HVAC HCR', sku: 'VK-HCR-T16', qty: 1, amount: 289 }],
    },
    appUrl: 'https://masest.co',
  }),
  'newsletter.html': renderNewsletterEmail({
    subject: 'A practical heat-exchanger cleaning plan',
    preview_text: 'Scope deposits, circulation, rinse, and verification before shutdown day.',
    body_md: '## Plan the whole cleaning loop\n\nA reliable shutdown starts with deposit identification, compatible chemistry, circulation access, rinse handling, and a clear verification step.\n\n[Read the field guide](https://masest.co/blog)',
  }),
  'blog-announcement.html': renderBlogEmail({
    slug: 'heat-exchanger-cleaning-plan',
    title: 'How to plan a heat-exchanger cleaning loop',
    excerpt: 'A field-ready sequence for deposit identification, circulation, rinse handling, and verification.',
    hero: '/img/blog/heat-exchanger-descaling-hero.webp',
    hero_alt: 'Technician preparing an industrial heat exchanger cleaning loop',
    hero_width: 1440,
    hero_height: 811,
    category: 'Field guide',
    author: 'MASEST Technical Team',
    date: 'September 3, 2026',
  }),
  'product-offer.html': renderMarketingEmail({
    kind: 'product',
    campaign: {
      subject: 'A more complete industrial degreasing cycle',
      previewText: 'Match chemistry to the full job.',
      eyebrow: 'Product spotlight · VertKleen CRHD',
      heading: 'Grease out. Equipment back.',
      bodyHtml: '<p>Plan dilution, dwell, agitation, recovery, and rinse as one operating cycle.</p>',
      ctaText: 'Explore VertKleen CRHD',
      ctaUrl: 'https://masest.co/products/crhd',
      heroImage: 'https://media.masest.co/site/img/blog/cases/cr-hd-walmart-product-field.webp',
      heroAlt: 'VertKleen CR HD at an industrial worksite',
      heroWidth: 367,
      heroHeight: 670,
    },
    modules: [{
      type: 'links',
      heading: 'Useful links',
      items: [{
        title: 'Read field notes',
        body: 'Practical application guidance.',
        href: 'https://masest.co/blog',
      }],
    }],
    recipientContext: { reason: 'You asked MASEST for product information.' },
  }),
};

for (const [file, preview] of Object.entries(previews)) {
  // Keep provider tokens inspectable without making local-preview link checkers
  // treat them as relative files. Production renderer output stays unchanged.
  const browserSafeHtml = preview.html
    .replaceAll('href="{% web_view_link %}"', 'href="https://masest.co" data-klaviyo-href="{% web_view_link %}"')
    .replaceAll('href="{% unsubscribe_link %}"', 'href="https://masest.co/dashboard.html#notifications" data-klaviyo-href="{% unsubscribe_link %}"');
  writeFileSync(join(outputDir, file), browserSafeHtml, 'utf8');
  writeFileSync(join(outputDir, file.replace(/\.html$/, '.txt')), `${preview.text || ''}\n`, 'utf8');
}

const manifest = Object.fromEntries(Object.entries(previews).map(([file, preview]) => [file, {
    subject: preview.subject,
    previewText: preview.previewText,
    hasTextFallback: Boolean(preview.text),
  }]));

writeFileSync(join(outputDir, 'manifest.json'), JSON.stringify(
  manifest,
  null,
  2,
) + '\n', 'utf8');

const labels = {
  'support-thread.html': 'Support thread',
  'order-confirmation.html': 'Order confirmed',
  'shipment.html': 'Shipment sent',
  'refund.html': 'Refund issued',
  'newsletter.html': 'Newsletter',
  'blog-announcement.html': 'Blog announcement',
  'product-offer.html': 'Product offer',
};
const buttons = Object.entries(manifest).map(([file, entry], index) => (
  `<button type="button" class="preview-choice${index ? '' : ' is-active'}" data-preview="${escapeHtml(file)}" data-subject="${escapeHtml(entry.subject)}">${escapeHtml(labels[file] || entry.subject)}</button>`
)).join('');
writeFileSync(join(outputDir, 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MASEST production email renderer QA</title>
<style>
  :root{color-scheme:light;font-family:Arial,Helvetica,sans-serif;background:#eef1f2;color:#15171c}
  *{box-sizing:border-box}body{margin:0}.qa-shell{min-height:100vh;display:grid;grid-template-columns:260px minmax(0,1fr)}
  .qa-sidebar{padding:24px;background:#111518;color:#fff}.qa-sidebar h1{margin:0 0 8px;font-size:20px}.qa-sidebar p{margin:0 0 20px;color:#b8c2c5;font-size:12px;line-height:1.5}
  .preview-choice{display:block;width:100%;margin:0 0 7px;padding:10px 12px;border:1px solid #374146;border-radius:8px;background:#1c2327;color:#e5ecee;text-align:left;font:inherit;font-size:13px;cursor:pointer}
  .preview-choice:hover,.preview-choice:focus-visible{border-color:#77c7cc;outline:none}.preview-choice.is-active{background:#0e7c86;border-color:#0e7c86;color:#fff;font-weight:700}
  .qa-main{min-width:0;padding:22px}.qa-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 auto 14px;max-width:960px}
  .qa-subject{margin:0;font-size:15px}.qa-sizes{display:flex;gap:6px}.qa-sizes button{padding:7px 10px;border:1px solid #c8ced1;border-radius:999px;background:#fff;cursor:pointer}.qa-sizes button.is-active{background:#15171c;color:#fff;border-color:#15171c}
  .qa-frame-wrap{margin:auto;max-width:960px;min-height:calc(100vh - 84px);display:flex;justify-content:center;overflow:auto}.qa-frame{width:100%;height:calc(100vh - 90px);border:1px solid #c8ced1;border-radius:12px;background:#fff;box-shadow:0 12px 36px rgba(0,0,0,.09);transition:width .18s ease}
  @media(max-width:760px){.qa-shell{grid-template-columns:1fr}.qa-sidebar{padding:18px}.qa-main{padding:14px}.qa-frame{height:900px}}
</style></head><body><div class="qa-shell"><aside class="qa-sidebar"><h1>Production renderer QA</h1><p>Generated directly from canonical support, commerce, newsletter, blog, and marketing renderers. No send action.</p><nav aria-label="Email previews">${buttons}</nav></aside><main class="qa-main"><div class="qa-toolbar"><p class="qa-subject" data-subject>${escapeHtml(manifest['support-thread.html'].subject)}</p><div class="qa-sizes" aria-label="Preview width"><button type="button" class="is-active" data-width="100%">Desktop</button><button type="button" data-width="390px">Mobile</button></div></div><div class="qa-frame-wrap"><iframe class="qa-frame" title="Support thread email preview" src="support-thread.html" data-frame></iframe></div></main></div>
<script>
  const frame=document.querySelector('[data-frame]');const subject=document.querySelector('[data-subject]');
  document.querySelectorAll('[data-preview]').forEach((button)=>button.addEventListener('click',()=>{document.querySelectorAll('[data-preview]').forEach((item)=>item.classList.toggle('is-active',item===button));frame.src=button.dataset.preview;frame.title=button.textContent+' email preview';subject.textContent=button.dataset.subject;}));
  document.querySelectorAll('[data-width]').forEach((button)=>button.addEventListener('click',()=>{document.querySelectorAll('[data-width]').forEach((item)=>item.classList.toggle('is-active',item===button));frame.style.width=button.dataset.width;}));
</script></body></html>`, 'utf8');

console.log(`rendered ${Object.keys(previews).length} production email previews -> ${outputDir}`);
