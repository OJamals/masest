import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { memberEmails } from '../functions/api/admin/offers.js';

const src = readFileSync(new URL('../functions/api/admin/offers.js', import.meta.url), 'utf8');

test('offer persistence succeeds before notifications or SES deliveries fan out', () => {
  const offerInsert = src.indexOf("sb.from('offers').insert");
  const notificationInsert = src.indexOf("sb.from('notifications').insert");
  const marketingQueue = src.indexOf('queueMarketingEmail(env');
  assert.ok(offerInsert > -1 && notificationInsert > -1 && marketingQueue > -1);
  assert.ok(offerInsert < notificationInsert, 'canonical offer row must exist before in-app fanout');
  assert.ok(offerInsert < marketingQueue, 'canonical offer row must exist before email fanout');
  assert.match(src, /error:\s*offerError/);
  assert.match(src, /if \(offerError \|\| !offer\?\.id\)/);
  assert.doesNotMatch(src, /offer\?\.id \|\| 'unknown'/);
});

test('offer recipients resolve through one canonical database RPC', async () => {
  const calls = [];
  const sb = {
    async rpc(name, args) {
      calls.push({ name, args });
      return {
        data: [
          { email: 'Buyer@Example.com' },
          { email: 'buyer@example.com' },
          { email: 'invalid' },
        ],
        error: null,
      };
    },
  };

  assert.deepEqual(await memberEmails(sb, ['company-1', 'company-2']), ['buyer@example.com']);
  assert.deepEqual(calls, [{
    name: 'marketing_company_emails',
    args: { p_company_ids: ['company-1', 'company-2'] },
  }]);
});

test('offer recipient resolution fails closed when the canonical RPC is unavailable', async () => {
  const sb = { rpc: async () => ({ data: null, error: new Error('down') }) };
  await assert.rejects(memberEmails(sb, ['company-1']), /marketing_company_emails_unavailable/);
  assert.deepEqual(await memberEmails(sb, []), []);
});

test('offer fanout records recipient lookup failure instead of abandoning the request', () => {
  const lookup = src.indexOf('await memberEmails(sb, companyIds)');
  const handled = src.indexOf("emailError = error.message || 'marketing_company_emails_unavailable'", lookup);
  const statusSave = src.indexOf("sb.from('offers').update", lookup);
  assert.ok(lookup > -1 && handled > lookup && statusSave > handled);
});
