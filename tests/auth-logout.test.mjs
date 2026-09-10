import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const authSource = readFileSync(new URL('../js/auth.js', import.meta.url), 'utf8');
let moduleSequence = 0;

async function withAuthClient(client, run) {
  const originals = new Map([
    ['window', globalThis.window],
    ['document', globalThis.document],
    ['CustomEvent', globalThis.CustomEvent],
    ['__MASEST_TEST_AUTH_CLIENT__', globalThis.__MASEST_TEST_AUTH_CLIENT__],
  ]);
  const existed = new Set([...originals.keys()].filter((key) => Object.hasOwn(globalThis, key)));
  const events = [];

  globalThis.window = {
    MASEST_SUPABASE_URL: 'https://auth.example.test',
    MASEST_SUPABASE_ANON: 'public-test-key',
    location: { hostname: 'localhost', href: 'http://localhost/' },
  };
  globalThis.document = { dispatchEvent: (event) => { events.push(event.type); } };
  globalThis.CustomEvent ||= class CustomEvent {
    constructor(type) { this.type = type; }
  };
  globalThis.__MASEST_TEST_AUTH_CLIENT__ = client;

  const source = authSource
    .replace(
      "import { createClient } from '../vendor/supabase-js.esm.js';",
      'const createClient = () => globalThis.__MASEST_TEST_AUTH_CLIENT__;',
    )
    .replace(
      "import { fetchBlobWithAuth } from './auth-blob.js?v=20260910a';",
      'const fetchBlobWithAuth = async () => { throw new Error(\'unused_test_stub\'); };',
    );

  try {
    const encoded = Buffer.from(source).toString('base64');
    moduleSequence += 1;
    const auth = await import(`data:text/javascript;base64,${encoded}#${moduleSequence}`);
    await run(auth, events);
  } finally {
    for (const [key, value] of originals) {
      if (existed.has(key)) globalThis[key] = value;
      else delete globalThis[key];
    }
  }
}

test('logout preserves the session surface when Supabase rejects sign-out', async () => {
  const providerError = new Error('provider_sign_out_failed');
  await withAuthClient({
    auth: { signOut: async () => ({ error: providerError }) },
  }, async ({ logout }, events) => {
    await assert.rejects(logout(), (error) => error === providerError);
    assert.deepEqual(events, [], 'failed sign-out must not broadcast a signed-out state');
  });
});

test('logout broadcasts auth change only after Supabase completes sign-out', async () => {
  await withAuthClient({
    auth: { signOut: async () => ({ error: null }) },
  }, async ({ logout }, events) => {
    await logout();
    assert.deepEqual(events, ['masest:auth']);
  });
});
