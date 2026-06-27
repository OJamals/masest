import assert from 'node:assert/strict';
import test from 'node:test';
import { sdsForSku, sdsAttachments, SDS_BY_STEM } from '../functions/_lib/sds-docs.js';

test('resolves a variant SKU to its product SDS regardless of size suffix', () => {
  assert.equal(sdsForSku('VK-HCR-1'), 'docs/sds/vertkleen-hcr-sds.pdf');
  assert.equal(sdsForSku('VK-HCR-2.5'), 'docs/sds/vertkleen-hcr-sds.pdf');
  assert.equal(sdsForSku('VK-HCR-55'), 'docs/sds/vertkleen-hcr-sds.pdf');
  assert.equal(sdsForSku('VK-WS60-5'), 'docs/sds/watersafe60-sds.pdf');
});

test('is case- and whitespace-insensitive', () => {
  assert.equal(sdsForSku('  vk-hcr-1 '), 'docs/sds/vertkleen-hcr-sds.pdf');
});

test('a longer sibling stem never falls back to a shorter stem with an SDS', () => {
  // VK-CRHD / VK-CR2 share the "VK-CR" lead but are distinct products with no SDS —
  // they must resolve to null, NOT to the VK-CR safety sheet.
  assert.equal(sdsForSku('VK-CRHD-5'), null);
  assert.equal(sdsForSku('VK-CRHDLF-5'), null);
  assert.equal(sdsForSku('VK-CR2-5'), null);
  // ...while plain VK-CR still resolves.
  assert.equal(sdsForSku('VK-CR-5'), 'docs/sds/vertkleen-cr-sds.pdf');
});

test('products without a published SDS and unknown SKUs return null', () => {
  assert.equal(sdsForSku('VK-ALU-5'), null);   // alumibrite — manufacturer gap
  assert.equal(sdsForSku('VK-EG5050-55'), null); // glycol blend
  assert.equal(sdsForSku('NOT-A-SKU'), null);
  assert.equal(sdsForSku(''), null);
  assert.equal(sdsForSku(null), null);
});

test('builds deduped Resend attachments with absolute URLs', () => {
  const lines = [
    { sku: 'VK-HCR-1', qty: 2 },
    { sku: 'VK-HCR-55', qty: 1 }, // same product, second size → deduped
    { sku: 'VK-CR-5', qty: 1 },
    { sku: 'VK-ALU-5', qty: 1 },  // no SDS → skipped
  ];
  const att = sdsAttachments(lines, 'https://masest.co');
  assert.equal(att.length, 2);
  assert.deepEqual(att[0], { filename: 'vertkleen-hcr-sds.pdf', path: 'https://masest.co/docs/sds/vertkleen-hcr-sds.pdf' });
  assert.equal(att[1].path, 'https://masest.co/docs/sds/vertkleen-cr-sds.pdf');
});

test('strips a trailing slash on appUrl and defaults when absent', () => {
  assert.equal(sdsAttachments([{ sku: 'VK-HCR-1' }], 'https://staging.masest.co/')[0].path,
    'https://staging.masest.co/docs/sds/vertkleen-hcr-sds.pdf');
  assert.equal(sdsAttachments([{ sku: 'VK-HCR-1' }])[0].path,
    'https://masest.co/docs/sds/vertkleen-hcr-sds.pdf');
});

test('caps the attachment count', () => {
  const lines = Object.keys(SDS_BY_STEM).map((stem) => ({ sku: `${stem}-1` }));
  assert.ok(lines.length > 3);
  assert.equal(sdsAttachments(lines, 'https://masest.co', 3).length, 3);
});

test('empty / missing lines produce no attachments', () => {
  assert.deepEqual(sdsAttachments([], 'https://masest.co'), []);
  assert.deepEqual(sdsAttachments(null, 'https://masest.co'), []);
  assert.deepEqual(sdsAttachments([{ qty: 1 }], 'https://masest.co'), []);
});
