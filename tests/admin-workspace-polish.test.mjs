import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const html = read('admin.html');
const savedViews = read('js/admin/saved-views.js');
const products = read('js/admin/products.js');

function panel(name, nextName) {
  const start = html.indexOf(`data-panel="${name}"`);
  assert.notEqual(start, -1, `${name} panel should exist`);
  const end = nextName ? html.indexOf(`data-panel="${nextName}"`, start) : html.length;
  return html.slice(start, end);
}

test('operational workspaces share the same page-level heading pattern', () => {
  const sections = [
    ['orders', 'companies'],
    ['companies', 'products'],
    ['products', 'content'],
    ['support-settings', 'quotes'],
    ['quotes', 'reviews'],
    ['reviews', 'newsletter'],
  ];

  for (const [name, next] of sections) {
    const source = panel(name, next);
    // Compact heading row, not a stacked header card: each workspace already
    // carries its own card header below this.
    assert.match(source, /class="adm-panel-title"/, `${name} should have a workspace heading`);
    assert.match(source, /<h2>[^<]+<\/h2><p class="muted">/, `${name} should explain the workspace`);
  }
});

test('primary queues appear before exception-creation controls', () => {
  const orders = panel('orders', 'companies');
  assert.ok(orders.indexOf('id="admOrders"') < orders.indexOf('id="ordCreateForm"'), 'order queue should precede manual order creation');

  const products = panel('products', 'content');
  assert.ok(products.indexOf('id="prodSearch"') < products.indexOf('id="admInventory"'), 'catalog search should precede inventory tools');
  assert.ok(products.indexOf('id="admProducts"') < products.indexOf('id="prodForm"'), 'existing products should precede product creation');
  assert.match(products, /<details class="adm-card adm-summary-card" data-capability="product\.write"/);
});

test('secondary create controls have descriptive disclosure summaries', () => {
  const orders = panel('orders', 'companies');
  assert.match(orders, /adm-summary-copy"><b>Create manual order<\/b><small>/);

  const reviews = panel('reviews', 'newsletter');
  assert.match(reviews, /<details class="adm-card adm-summary-card"[\s\S]*adm-summary-copy"><b>Add a manual review<\/b><small>/);
});

test('saved-view actions expose valid disabled states', () => {
  assert.match(savedViews, /data-sv-save disabled/);
  assert.match(savedViews, /data-sv-del disabled/);
  assert.match(savedViews, /save\.disabled = !name/);
  assert.match(savedViews, /del\.disabled = !findView\(read\(\), selected \|\| name\)/);
  assert.match(savedViews, /event\.target\.matches\('\[data-sv-name\]'\).*updateActions\(box\)/);
});

test('catalog row actions and create disclosures report status where the action occurred', () => {
  assert.match(products, /saveVariantRow[\s\S]*message\('prodStatus', 'Saving variant…'/);
  assert.match(products, /wireProductForm[\s\S]*message\('prodCreateStatus', 'Saving…'/);
  assert.match(products, /wireVariantForm[\s\S]*message\('variantCreateStatus', 'Saving…'/);
  const productPanel = panel('products', 'content');
  assert.match(productPanel, /id="prodCreateStatus"[^>]*aria-live="polite"/);
  assert.match(productPanel, /id="variantCreateStatus"[^>]*aria-live="polite"/);
});
