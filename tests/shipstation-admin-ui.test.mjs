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

test('orders UI proxies label documents and confirms reconciliation and returns', async () => {
  const [source, ordersApi, adminEntry] = await Promise.all([
    read('../js/admin/orders.js'),
    read('../functions/api/admin/orders.js'),
    read('../js/admin.js'),
  ]);
  assert.match(source, /data-shipstation-download-label/);
  assert.match(source, /data-shipstation-reconcile-label/);
  assert.match(source, /data-shipstation-return-label/);
  assert.match(source, /action: 'reconcile_label_purchase'/);
  assert.match(source, /action: 'return_label'/);
  assert.match(source, /\/api\/admin\/shipstation\?action=label_document/);
  assert.match(source, /await apiBlob\(url\)/);
  assert.match(adminEntry, /\$, api, apiBlob, state/);
  assert.doesNotMatch(source, /window\.open\(url/);
  assert.doesNotMatch(source, /shipstation_label_url[^\n]+href=/);
  assert.match(source, /Confirm return-label carrier charge/);
  assert.match(source, /Confirm reconciliation/);
  assert.match(ordersApi, /delete safeOrder\.shipstation_label_url/);
  const listSelect = ordersApi.match(/\.select\('id,order_number,[^']+'/)?.[0] || '';
  assert.doesNotMatch(listSelect, /shipstation_label_url/);
});
