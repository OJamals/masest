import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/admin/users.js';

const req = (method = 'GET', body = {}) => ({
  method, url: 'https://masest.co/api/admin/users',
  headers: { get: () => null }, json: async () => body,
});

test('users: 401 for anonymous GET', async () => {
  const res = await onRequest({ request: req('GET'), env: {} });
  assert.equal(res.status, 401);
});

test('users: 401 for anonymous POST create', async () => {
  const res = await onRequest({ request: req('POST', { action: 'create', email: 'x@y.com', password: 'password1' }), env: {} });
  assert.equal(res.status, 401);
});

test('users: method not allowed for PUT (after auth would 401 first here)', async () => {
  const res = await onRequest({ request: req('PUT'), env: {} });
  assert.equal(res.status, 401); // anon fails auth before method check
});
