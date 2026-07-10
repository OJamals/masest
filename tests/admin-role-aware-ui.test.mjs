import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { capabilityReason, normalizeStaffContext, staffCan, staffRoleLabel } from '../js/admin/permissions.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('client permission helpers fail closed for explicit unknown roles', () => {
  assert.equal(normalizeStaffContext({ role: 'mystery', capabilities: ['product.write'] }).role, 'read_only');
  assert.equal(staffCan({ role: 'support', capabilities: ['company.view_as'] }, 'company.view_as'), true);
  assert.equal(staffCan({ role: 'support', capabilities: ['company.view_as'] }, 'company.credit'), false);
  assert.equal(staffRoleLabel('finance'), 'Finance');
  assert.match(capabilityReason('order.refund'), /finance or owner access/);
});

test('admin boot consumes uncached staff context and reapplies permissions to dynamic UI', () => {
  const source = read('js/admin.js');
  assert.match(source, /applyStaffContext\(stats\.staff_context\)/);
  assert.match(source, /MutationObserver\([\s\S]*applyCapabilityUi/);
  assert.match(source, /renderQboStatus\(\)\.finally\(\(\) => applyCapabilityUi\(document\.body/);
});

test('high-risk admin controls declare the same capabilities as their APIs', () => {
  const html = read('admin.html');
  const orders = read('js/admin/orders.js');
  const companies = read('js/admin/companies.js');
  const products = read('js/admin/products.js');
  const content = read('js/admin/content.js');

  assert.match(html, /adm-order-create" data-capability="order\.write" data-capability-mode="hide"/);
  assert.match(html, /id="admInventory" data-capability-scope="admin\.write"/);
  assert.match(orders, /data-refund-order=.*data-capability="order\.refund"/);
  assert.match(orders, /data-delete-order=.*data-capability="order\.delete"/);
  assert.match(orders, /data-mark-net-paid-order=.*data-capability="company\.credit"/);
  assert.match(companies, /data-company-view-as=.*data-capability="company\.view_as"/);
  assert.match(companies, /data-au-staff-role=.*data-capability="user\.role"/);
  assert.match(products, /data-capability-scope="product\.write"/);
  assert.match(content, /data-content-action="publish" data-capability="content\.publish"/);
  assert.match(content, /data-content-action="upload_asset" data-capability="content\.assets"/);
});
