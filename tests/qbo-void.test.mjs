import assert from 'node:assert/strict';
import test from 'node:test';

import { voidQboInvoice } from '../functions/_lib/qbo.js';

function response(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

test('NET cancellation fetches latest SyncToken then verifies Invoice void', async () => {
  const calls = [];
  const result = await voidQboInvoice(
    { QBO_ENVIRONMENT: 'sandbox' },
    'access-token',
    'realm-1',
    'invoice-1',
    {
      async fetchImpl(url, init = {}) {
        calls.push([url, init]);
        if (init.method !== 'POST') {
          return response({ Invoice: { Id: 'invoice-1', SyncToken: '7', TotalAmt: 80, Balance: 80 } });
        }
        assert.deepEqual(JSON.parse(init.body), { Id: 'invoice-1', SyncToken: '7' });
        return response({ Invoice: { Id: 'invoice-1', SyncToken: '8', TotalAmt: 0, Balance: 0 } });
      },
    },
  );

  assert.match(calls[0][0], /\/v3\/company\/realm-1\/invoice\/invoice-1\?minorversion=70$/);
  assert.match(calls[1][0], /\/v3\/company\/realm-1\/invoice\?operation=void&minorversion=70$/);
  assert.equal(result.invoiceId, 'invoice-1');
  assert.equal(result.syncToken, '8');
  assert.equal(result.voided, true);
});

test('NET cancellation refuses an Invoice with payment activity', async () => {
  await assert.rejects(
    voidQboInvoice({}, 'access-token', 'realm-1', 'invoice-1', {
      fetchImpl: async () => response({
        Invoice: { Id: 'invoice-1', SyncToken: '7', TotalAmt: 80, Balance: 20 },
      }),
    }),
    /qbo_invoice_payment_state_ambiguous/,
  );
});
