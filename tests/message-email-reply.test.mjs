import assert from 'node:assert/strict';
import test from 'node:test';
import { companyIdFromReplyAddress, inboundReplyText, messageReplyAddress } from '../functions/_lib/message-replies.js';

const companyId = '9b081f60-7410-4b04-bf1e-30f109b20b9a';
const env = { RESEND_INBOUND_DOMAIN: 'replies.masest.co', MESSAGE_REPLY_SECRET: 'test-secret' };

test('signed Reply-To address routes only to its company', async () => {
  const address = await messageReplyAddress(env, companyId);
  assert.match(address, /^reply\+9b081f60-7410-4b04-bf1e-30f109b20b9a\.[a-f0-9]{24}@replies\.masest\.co$/);
  assert.equal(await companyIdFromReplyAddress(env, [address]), companyId);
  assert.equal(await companyIdFromReplyAddress(env, [address.replace(/.$/, 'x')]), null);
  assert.equal(await companyIdFromReplyAddress({ ...env, MESSAGE_REPLY_SECRET: 'other' }, [address]), null);
});

test('inbound reply text drops common quoted content and caps the payload', () => {
  assert.equal(inboundReplyText('New answer\n\nOn Tuesday wrote:\n> Older content'), 'New answer');
  assert.equal(inboundReplyText('> quoted\n\nActual reply'), 'Actual reply');
  assert.equal(inboundReplyText('x'.repeat(5000)).length, 4000);
});
