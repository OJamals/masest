import test from 'node:test';
import assert from 'node:assert/strict';
import { parseImportEmails, onRequest as recipientsRoute } from '../functions/api/admin/recipients.js';
import { onRequest as newslettersRoute } from '../functions/api/admin/newsletters.js';

test('parseImportEmails: dedupes + validates from array and CSV blob', () => {
  const out = parseImportEmails({ emails: ['A@x.com', 'bad'], csv: 'b@x.com, a@x.com\nc@x.com;notanemail' });
  assert.deepEqual(out, ['a@x.com', 'b@x.com', 'c@x.com']);
});

const anonReq = (method = 'GET', body = {}) => ({
  method,
  url: 'https://masest.co/api/admin/newsletters',
  headers: { get: () => null },
  json: async () => body,
});

test('recipients: 401 for anonymous', async () => {
  const res = await recipientsRoute({ request: anonReq('GET'), env: {} });
  assert.equal(res.status, 401);
});

test('newsletters: 401 for anonymous staff action', async () => {
  const res = await newslettersRoute({ request: anonReq('GET'), env: {} });
  assert.equal(res.status, 401);
});

test('newsletters: sweep_due 401 without cron secret', async () => {
  const res = await newslettersRoute({ request: anonReq('POST', { action: 'sweep_due' }), env: { NEWSLETTER_CRON_SECRET: 'right' } });
  assert.equal(res.status, 401);
});

test('newsletters: sweep_due 401 when no secret configured', async () => {
  const res = await newslettersRoute({ request: anonReq('POST', { action: 'sweep_due' }), env: {} });
  assert.equal(res.status, 401);
});
