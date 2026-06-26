import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildPersonProfile, upsertCrispPerson } from '../functions/_lib/crisp.js';

test('buildPersonProfile lowercases email + nests person/company; minimal when sparse', () => {
  assert.deepEqual(
    buildPersonProfile({ email: 'Jane@Acme.CO', name: 'Jane', company: 'Acme', phone: '555' }),
    { email: 'jane@acme.co', person: { nickname: 'Jane', phones: ['555'] }, company: { name: 'Acme' } },
  );
  assert.deepEqual(buildPersonProfile({ email: 'a@b.co' }), { email: 'a@b.co' });
});

test('upsertCrispPerson no-ops without config or email', async () => {
  assert.deepEqual(await upsertCrispPerson({}, { email: 'a@b.co' }), { ok: false, skipped: true });
  const env = { CRISP_TOKEN_ID: 'a', CRISP_TOKEN_KEY: 'b', MASEST_CRISP_ID: 'c' };
  assert.deepEqual(await upsertCrispPerson(env, {}), { ok: false, skipped: true });
});

test('upsertCrispPerson POSTs people/profile; 409 already-exists counts as ok', async () => {
  const env = { CRISP_TOKEN_ID: 'id', CRISP_TOKEN_KEY: 'key', MASEST_CRISP_ID: 'wid' };
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { calls.push({ url, opts }); return { status: 409 }; };
  try {
    const r = await upsertCrispPerson(env, { email: 'jane@acme.co', name: 'Jane', company: 'Acme' });
    assert.equal(r.ok, true);
    assert.match(calls[0].url, /\/v1\/website\/wid\/people\/profile$/);
    const body = JSON.parse(calls[0].opts.body);
    assert.equal(body.email, 'jane@acme.co');
    assert.equal(body.person.nickname, 'Jane');
    assert.equal(body.company.name, 'Acme');
    assert.match(calls[0].opts.headers.Authorization, /^Basic /);
  } finally { globalThis.fetch = orig; }
});

const contacts = readFileSync(new URL('../functions/api/admin/crm/contacts.js', import.meta.url), 'utf8');
test('creating a CRM contact seeds it into Crisp People', () => {
  assert.match(contacts, /import \{ upsertCrispPerson \} from '\.\.\/\.\.\/\.\.\/_lib\/crisp\.js'/);
  assert.match(contacts, /upsertCrispPerson\(env, \{ email: built\.row\.email, name: built\.row\.name, company: co\?\.name, phone: built\.row\.phone \}\)/);
});
