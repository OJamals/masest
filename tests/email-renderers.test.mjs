import assert from 'node:assert/strict';
import test from 'node:test';

import {
  renderCommerceEmail,
  renderMarketingEmail,
  renderSupportEmail,
} from '../functions/_lib/email-renderers.js';

test('support renderer keeps reply, online thread, linked order, bounded history, and RFC headers together', () => {
  const rendered = renderSupportEmail({
    thread: {
      headers: {
        'In-Reply-To': '<parent@example.com>',
        References: '<root@example.com> <parent@example.com>',
      },
      viewUrl: 'https://masest.co/dashboard.html?order=order-1#messages',
      topic: 'Product compatibility for condenser coils',
    },
    message: {
      body: 'HCR is the better starting point. <script>alert(1)</script>',
      sender_role: 'staff',
      sender_name: 'Maya',
      created_at: '2026-09-03T14:42:00Z',
    },
    priorMessages: [
      { body: 'First question', sender_role: 'buyer', created_at: '2026-09-03T14:31:00Z' },
      { body: 'First reply', sender_role: 'staff', created_at: '2026-09-03T14:35:00Z' },
      { body: 'Must not appear', sender_role: 'buyer', created_at: '2026-09-03T14:37:00Z' },
    ],
    participant: { name: 'Northwind HVAC' },
    order: {
      id: 'order-1',
      reference: 'MST-00000005',
      status: 'shipped',
      viewUrl: 'https://masest.co/dashboard.html?order=order-1#orders',
    },
    audience: 'buyer',
  });

  assert.equal(rendered.subject, 'Re: MASEST support · Northwind HVAC · Order MST-00000005');
  assert.equal(rendered.headers['In-Reply-To'], '<parent@example.com>');
  assert.match(rendered.previewText, /New reply from Maya/);
  assert.match(rendered.html, /View conversation online/);
  assert.match(rendered.html, /Reply directly to this email/);
  assert.match(rendered.html, /View order MST-00000005/);
  assert.match(rendered.html, /Earlier in this conversation/);
  assert.match(rendered.html, /First question/);
  assert.match(rendered.html, /First reply/);
  assert.doesNotMatch(rendered.html, /Must not appear/);
  assert.doesNotMatch(rendered.html, /<script>/);
  assert.match(rendered.text, /Reply directly to this email/);
  assert.match(rendered.text, /Support conversation notification/);
  assert.doesNotMatch(rendered.text, /Required support conversation/);
  assert.doesNotMatch(rendered.html, /unsubscribe/i);
  assert.match(rendered.html, /Support conversation notification/);
  assert.doesNotMatch(rendered.html, /cannot be disabled/i);
});

test('commerce renderer makes confirmation operational, itemized, and promotion-free', () => {
  const rendered = renderCommerceEmail({
    event: 'confirmed',
    order: {
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
    },
    payment: { status: 'paid', label: 'Paid' },
    items: [
      {
        name: 'VertKleen HVAC HCR <unsafe>',
        sku: 'VK-HCR-T16',
        qty: 2,
        unit_price: 289,
        image_url: 'https://media.masest.co/site/img/products/hvac-hcr-studio.webp',
        image_width: 900,
        image_height: 1200,
      },
    ],
    appUrl: 'https://masest.co',
  });

  assert.equal(rendered.subject, 'Order MST-00000005 confirmed');
  assert.match(rendered.previewText, /review items, total, and delivery details/i);
  assert.match(rendered.html, /We received your order/);
  assert.match(rendered.html, /Order summary/);
  assert.match(rendered.html, /VertKleen HVAC HCR &lt;unsafe&gt;/);
  assert.match(rendered.html, /USD 708\.34/);
  assert.match(rendered.html, /100 Industrial Way/);
  assert.match(rendered.html, /Purchase order/);
  assert.match(rendered.html, /Product labels and public documents/);
  assert.match(rendered.html, /href="https:\/\/masest\.co\/resources"/);
  assert.match(rendered.html, /hvac-hcr-studio\.webp" width="70" height="93"/);
  assert.match(rendered.html, /View order/);
  assert.equal((rendered.html.match(/ORDER DATE/g) || []).length, 1);
  assert.match(rendered.text, /2 × VertKleen HVAC HCR <unsafe>/);
  assert.doesNotMatch(rendered.html, /unsubscribe|coupon|shop now/i);
});

test('commerce renderer makes refund amount and timing first-class', () => {
  const rendered = renderCommerceEmail({
    event: 'refunded',
    order: {
      id: 'order-1',
      order_number: 'MST-00000005',
      currency: 'usd',
      total: 708.34,
      user_id: 'user-1',
    },
    refund: {
      amount: 289,
      methodLabel: 'original payment method',
      remainingTotal: 419.34,
      items: [{ name: 'VertKleen HVAC HCR', qty: 1, amount: 289 }],
    },
    appUrl: 'https://masest.co',
  });

  assert.equal(rendered.subject, 'USD 289.00 refund issued for order MST-00000005');
  assert.match(rendered.html, /USD 289\.00 is headed back to you/);
  assert.match(rendered.html, /5–10 business days/);
  assert.match(rendered.html, /Remaining order total/);
  assert.match(rendered.text, /USD 419\.34/);
});

test('commerce renderer handles stored ship_address and avoids false no-payment claims on cancellation', () => {
  const rendered = renderCommerceEmail({
    event: 'canceled',
    order: {
      id: 'order-1',
      order_number: 'MST-00000005',
      currency: 'usd',
      ship_address: { address: { line1: '100 Industrial Way', city: 'Orlando', state: 'FL', postal_code: '32801' } },
    },
    refund: { amount: 0 },
  });

  assert.match(rendered.html, /100 Industrial Way/);
  assert.match(rendered.html, /No card refund is included with this notice/);
  assert.doesNotMatch(rendered.html, /No captured payment/);
});

test('marketing renderer uses provider-neutral browser/unsubscribe links and confirmed postal identity', () => {
  const rendered = renderMarketingEmail({
    kind: 'product',
    campaign: {
      subject: 'A more complete industrial degreasing cycle',
      previewText: 'Match chemistry to the full job.',
      eyebrow: 'Product spotlight · VertKleen CRHD',
      heading: 'Grease out. Equipment back.',
      bodyHtml: '<p>Plan dilution, dwell, agitation, recovery, and rinse.</p>',
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
      items: [{ title: 'Read field notes', body: 'Practical application guidance.', href: 'https://masest.co/blog' }],
    }, {
      type: 'feature',
      title: 'Field result',
      image: 'https://media.masest.co/site/img/blog/heat-exchanger-descaling-hero.webp',
      imageWidth: 1440,
      imageHeight: 811,
    }],
    recipientContext: { reason: 'You asked MASEST for product information.' },
  });

  assert.equal(rendered.subject, 'A more complete industrial degreasing cycle');
  assert.match(rendered.html, /href="\{\{web_view_url\}\}"/);
  assert.match(rendered.html, /href="\{\{unsubscribe_url\}\}"/);
  assert.match(rendered.html, /Products/);
  assert.match(rendered.html, /Industries/);
  assert.match(rendered.html, /Blog/);
  assert.match(rendered.html, /1361 Grand Cayman Dr/);
  assert.match(rendered.html, /Merritt Island, FL 32952/);
  assert.match(rendered.html, /Advertisement/);
  assert.match(rendered.html, /cr-hd-walmart-product-field\.webp" width="600" height="1095"/);
  assert.match(rendered.html, /heat-exchanger-descaling-hero\.webp" width="220" height="124"/);
  assert.match(rendered.text, /Unsubscribe: \{\{unsubscribe_url\}\}/);
  assert.deepEqual(rendered.headers, {});
});

test('renderers reject unsafe CTA and media protocols', () => {
  const marketing = renderMarketingEmail({
    campaign: {
      subject: 'Safe',
      heading: 'Safe',
      ctaText: 'Bad CTA',
      ctaUrl: 'javascript:alert(1)',
      heroImage: 'data:image/svg+xml,<svg onload=alert(1)>',
    },
  });
  assert.doesNotMatch(marketing.html, /Bad CTA|data:image|onload=/);

  const commerce = renderCommerceEmail({
    event: 'shipped',
    order: { id: 'order-1', order_number: 'MST-1' },
    fulfillment: { trackingUrl: 'javascript:alert(1)' },
  });
  assert.doesNotMatch(commerce.html, /javascript:/i);

  assert.doesNotThrow(() => renderMarketingEmail({
    campaign: { subject: 'Malformed module remains bounded' },
    modules: [{ type: 'links', items: { not: 'an array' } }],
  }));
});
