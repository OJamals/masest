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

test('upsertCrispPerson POSTs people/profile to create (201)', async () => {
  const env = { CRISP_TOKEN_ID: 'id', CRISP_TOKEN_KEY: 'key', MASEST_CRISP_ID: 'wid' };
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { calls.push({ url, opts }); return { status: 201 }; };
  try {
    const r = await upsertCrispPerson(env, { email: 'jane@acme.co', name: 'Jane', company: 'Acme' });
    assert.deepEqual(r, { ok: true, status: 201, created: true });
    assert.equal(calls.length, 1, 'no PATCH when the POST creates');
    assert.equal(calls[0].opts.method, 'POST');
    assert.match(calls[0].url, /\/v1\/website\/wid\/people\/profile$/);
    const body = JSON.parse(calls[0].opts.body);
    assert.equal(body.email, 'jane@acme.co');
    assert.equal(body.person.nickname, 'Jane');
    assert.equal(body.company.name, 'Acme');
    assert.match(calls[0].opts.headers.Authorization, /^Basic /);
  } finally { globalThis.fetch = orig; }
});

test('upsertCrispPerson PATCHes the existing profile (by email) when the POST returns 409', async () => {
  const env = { CRISP_TOKEN_ID: 'id', CRISP_TOKEN_KEY: 'key', MASEST_CRISP_ID: 'wid' };
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { calls.push({ url, opts }); return { status: opts.method === 'PATCH' ? 200 : 409 }; };
  try {
    const r = await upsertCrispPerson(env, { email: 'Jane@Acme.CO', name: 'Jane Updated', phone: '555' });
    assert.deepEqual(r, { ok: true, status: 200, updated: true });
    assert.equal(calls.length, 2, 'POST then PATCH');
    assert.equal(calls[1].opts.method, 'PATCH');
    assert.match(calls[1].url, /\/people\/profile\/jane%40acme\.co$/, 'email is the people_id, lowercased + encoded');
    assert.equal(JSON.parse(calls[1].opts.body).person.nickname, 'Jane Updated');
  } finally { globalThis.fetch = orig; }
});

test('upsertCrispPerson reports not-ok on an unexpected status', async () => {
  const env = { CRISP_TOKEN_ID: 'id', CRISP_TOKEN_KEY: 'key', MASEST_CRISP_ID: 'wid' };
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({ status: 500 });
  try {
    assert.deepEqual(await upsertCrispPerson(env, { email: 'a@b.co' }), { ok: false, status: 500 });
  } finally { globalThis.fetch = orig; }
});

const contacts = readFileSync(new URL('../functions/api/admin/crm/contacts.js', import.meta.url), 'utf8');
test('creating a CRM contact seeds it into Crisp People', () => {
  assert.match(contacts, /import \{ upsertCrispPerson \} from '\.\.\/\.\.\/\.\.\/_lib\/crisp\.js'/);
  assert.match(contacts, /upsertCrispPerson\(env, \{ email: built\.row\.email, name: built\.row\.name, company: co\?\.name, phone: built\.row\.phone \}\)/);
});

test('updating a CRM contact propagates the edit to Crisp People', () => {
  assert.match(contacts, /upsertCrispPerson\(env, \{ email: data\.email, name: data\.name, company: co\?\.name, phone: data\.phone \}\)/);
});
