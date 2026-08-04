import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchBlobWithAuth } from '../js/auth-blob.js';

test('fetchBlobWithAuth sends bearer auth and returns provider bytes', async () => {
  let request;
  const blob = await fetchBlobWithAuth('/api/admin/shipstation?action=label_document', {
    getToken: async () => 'staff-access-token',
    refreshSession: async () => false,
    fetchImpl: async (path, options) => {
      request = { path, options };
      return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
        headers: { 'content-type': 'application/pdf' },
      });
    },
  });
  assert.equal(request.path, '/api/admin/shipstation?action=label_document');
  assert.equal(request.options.headers.Authorization, 'Bearer staff-access-token');
  assert.equal(blob.type, 'application/pdf');
  assert.equal(blob.size, 4);
});

test('fetchBlobWithAuth refreshes once after 401 and retries with new token', async () => {
  let token = 'expired';
  const requests = [];
  const blob = await fetchBlobWithAuth('/label', {
    getToken: async () => token,
    refreshSession: async () => { token = 'refreshed'; return true; },
    fetchImpl: async (_path, options) => {
      requests.push(options.headers.Authorization);
      return requests.length === 1
        ? Response.json({ error: 'unauthenticated' }, { status: 401 })
        : new Response('pdf', { headers: { 'content-type': 'application/pdf' } });
    },
  });
  assert.deepEqual(requests, ['Bearer expired', 'Bearer refreshed']);
  assert.equal(await blob.text(), 'pdf');
});
