import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { crispIdentityToken } from '../functions/_lib/crisp.js';

test('crispIdentityToken: deterministic SHA-256 HMAC, case-insensitive, gated', async () => {
  const a = await crispIdentityToken('User@X.co', 'secret');
  const b = await crispIdentityToken('user@x.co', 'secret');
  assert.equal(a, b); // email lower-cased
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, await crispIdentityToken('user@x.co', 'other-secret'));
  assert.equal(await crispIdentityToken('user@x.co', ''), '');
  assert.equal(await crispIdentityToken('', 'secret'), '');
});

const me = readFileSync(new URL('../functions/api/account/me.js', import.meta.url), 'utf8');
test('me() issues a Crisp identity signature for the authenticated email only', () => {
  assert.match(me, /import \{ crispIdentityToken \} from '\.\.\/\.\.\/_lib\/crisp\.js'/);
  assert.match(me, /env\.CRISP_IDENTITY_SECRET \? await crispIdentityToken\(user\.email, env\.CRISP_IDENTITY_SECRET\) : null/);
  assert.match(me, /crisp_signature: crispSignature/);
});

const integ = readFileSync(new URL('../js/integrations.js', import.meta.url), 'utf8');
test('account context pushes a signed email when the signature is present', () => {
  assert.match(integ, /account\.crisp_signature/);
  assert.match(integ, /emailSignature \? \[email, emailSignature\] : \[email\]/);
});
