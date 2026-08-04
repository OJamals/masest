import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('admin integrations shows redacted ShipStation API Free readiness', async () => {
  const [html, admin, module] = await Promise.all([
    read('../admin.html'),
    read('../js/admin.js'),
    read('../js/admin/shipstation.js'),
  ]);
  assert.match(html, /id="admShipStation"/);
  assert.match(html, /ShipStation API Free/);
  assert.match(html, /id="shipstationRefresh"/);
  assert.match(html, /id="shipstationConfigureWebhook"/);
  assert.match(html, /id="admStripe"/);
  assert.match(admin, /renderShipStationStatus/);
  assert.match(module, /\/api\/admin\/shipstation/);
  assert.match(module, /Warehouse not available/);
  assert.doesNotMatch(module, /SHIPSTATION_API_KEY/);
});

test('admin integrations exposes redacted Stripe production and webhook readiness', async () => {
  const [html, admin, module] = await Promise.all([
    read('../admin.html'),
    read('../js/admin.js'),
    read('../js/admin/stripe.js'),
  ]);
  assert.match(html, /id="stripeStatus"/);
  assert.match(html, /id="stripeWebhookStatus"/);
  assert.match(admin, /renderStripeStatus/);
  assert.match(module, /\/api\/admin\/stripe/);
  assert.doesNotMatch(module, /STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET/);
});

test('orders UI supports multi-package rates and confirms live label purchase', async () => {
  const source = await read('../js/admin/orders.js');
  assert.match(source, /function parseShippingPackages/);
  assert.match(source, /data-shipstation-rates/);
  assert.match(source, /data-shipstation-buy-label/);
  assert.match(source, /ShipStation will charge/);
  assert.match(source, /action: 'rates'/);
  assert.match(source, /action: 'buy_label'/);
});
