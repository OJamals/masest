import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const track = readFileSync(new URL('../js/track.js', import.meta.url), 'utf8');
const confirmation = readFileSync(new URL('../order-confirmed.html', import.meta.url), 'utf8')
  .match(/<script>\s*([\s\S]*?)<\/script>/)[1];
const storage = () => {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) };
};

function tracking({ sessionStorage = storage(), referrer = '', pathname = '/', search = '', accepted = true, ahrefs } = {}) {
  const blobs = [];
  const fallbacks = [];
  const window = { AhrefsAnalytics: ahrefs };
  let trackerLoaded;
  const trackerAttributes = {};
  runInNewContext(track, {
    window, sessionStorage, document: {
      referrer,
      querySelector: () => ({
        addEventListener: (_event, handler) => { trackerLoaded = handler; },
        setAttribute: (name, value) => { trackerAttributes[name] = value; },
      }),
    },
    location: { hostname: 'masest.co', pathname, search },
    crypto: { randomUUID: () => 'session-id' }, URL, URLSearchParams, Blob,
    navigator: { sendBeacon: (_url, blob) => { if (accepted) blobs.push(blob); return accepted; } },
    fetch: async (_url, init) => { fallbacks.push(JSON.parse(init.body)); return { ok: true }; },
  });
  return { window, sessionStorage, fallbacks, trackerAttributes, trackerLoaded: () => trackerLoaded(), packets: async () => Promise.all(blobs.map(async (blob) => JSON.parse(await blob.text()))) };
}

test('Ahrefs receives funnel events once without form details or duplicate pageviews', () => {
  const events = [];
  const result = tracking({ ahrefs: { sendEvent: (...args) => events.push(args) } });
  result.window.mtrack('quote_submit', { dedupe_key: 'private-quote-id', email: 'buyer@example.com', product: 'private notes' });
  result.window.mtrack('quote_submit', { dedupe_key: 'private-quote-id' });
  result.window.mtrack('checkout_start');
  result.window.mtrack('order_confirmed');
  result.window.mtrack('document_download', { document: 'document.pdf' });
  result.window.mtrack('unrecognized_event');
  assert.deepEqual(events, [['quote_submit'], ['checkout_start'], ['order_confirmed'], ['document_download']]);
});

test('early funnel events survive async Ahrefs loading and repeated load notifications', () => {
  const events = [];
  const result = tracking();
  result.window.mtrack('quote_submit', { dedupe_key: 'one' });
  result.window.mtrack('quote_submit', { dedupe_key: 'one' });
  result.window.AhrefsAnalytics = { sendEvent: (...args) => events.push(args) };
  result.trackerLoaded();
  result.trackerLoaded();
  assert.deepEqual(events, [['quote_submit']]);
});

test('missing or throwing Ahrefs leaves first-party conversion tracking intact', async () => {
  for (const ahrefs of [undefined, { sendEvent: () => { throw new Error('provider failed'); } }]) {
    const result = tracking({ ahrefs });
    result.window.mtrack('quote_submit', { dedupe_key: 'one' });
    result.window.mtrack('quote_submit', { dedupe_key: 'one' });
    assert.equal((await result.packets()).filter((packet) => packet.event === 'quote_submit').length, 1);
  }
});

test('custom-event URLs exclude checkout capabilities; query-bearing referrers stay first-party only', async () => {
  const events = [];
  const ahrefs = { sendEvent: (...args) => events.push(args) };
  const safe = tracking({ ahrefs, pathname: '/order-confirmed', search: '?session_id=secret&email=buyer@example.com', referrer: 'https://checkout.stripe.com/' });
  safe.window.mtrack('order_confirmed');
  assert.equal(safe.trackerAttributes['data-page-location'], '/order-confirmed');
  assert.deepEqual(events, [['order_confirmed']]);
  const sensitive = tracking({ ahrefs, referrer: 'https://masest.co/contact?email=buyer%40example.com' });
  sensitive.window.mtrack('quote_submit', { dedupe_key: 'one' });
  assert.equal(events.length, 1);
  assert.equal((await sensitive.packets()).filter((packet) => packet.event === 'quote_submit').length, 1);
});

test('entry referrer survives internal navigation and strips URL secrets', async () => {
  const first = tracking({ referrer: 'https://www.google.com/search?q=private&email=person%40example.com' });
  const next = tracking({ sessionStorage: first.sessionStorage, referrer: 'https://masest.co/products/hcr?token=secret', pathname: '/contact', search: '?session_id=secret' });
  next.window.mtrack('quote_submit', { dedupe_key: 'quote-id', request_type: 'sample' });
  const packets = [...await first.packets(), ...await next.packets()];
  assert.ok(packets.every((packet) => packet.referrer === 'https://www.google.com'));
  assert.equal(packets[2].path, '/contact#request_type=sample');
  assert.doesNotMatch(JSON.stringify(packets), /private|person|secret|quote-id/);
});

test('form attribution retains the session entry page without exposing visitor identity', () => {
  const first = tracking({ pathname: '/blog/how-to-descale-heat-exchanger', referrer: 'https://www.google.com/search?q=secret' });
  const next = tracking({ sessionStorage: first.sessionStorage, pathname: '/contact', search: '?email=person%40example.com' });
  const context = JSON.parse(JSON.stringify(next.window.masestAttribution()));
  assert.deepEqual(context, { landing_path: '/blog/how-to-descale-heat-exchanger', referrer_origin: 'https://www.google.com' });
  assert.doesNotMatch(JSON.stringify(context), /person|secret|session-id/);
});

test('an untagged entry cannot acquire campaign labels from a later internal link', () => {
  const first = tracking({ pathname: '/blog/how-to-descale-heat-exchanger', referrer: 'https://www.google.com' });
  const next = tracking({ sessionStorage: first.sessionStorage, pathname: '/contact', search: '?utm_source=later&utm_medium=email' });
  assert.deepEqual(JSON.parse(JSON.stringify(next.window.masestUtm())), {});
  assert.equal(next.window.masestAttribution().landing_path, '/blog/how-to-descale-heat-exchanger');
});

test('upgrading an existing untagged session does not invent a landing page or campaign', () => {
  const sessionStorage = storage();
  sessionStorage.setItem('masest_vid', 'older-session');
  sessionStorage.setItem('masest_utm', JSON.stringify({ utm_source: 'uncertain-old-campaign' }));
  const upgraded = tracking({ sessionStorage, pathname: '/contact', search: '?utm_source=later' });
  assert.deepEqual(JSON.parse(JSON.stringify(upgraded.window.masestUtm())), {});
  assert.equal(upgraded.window.masestAttribution().landing_path, '');
});

test('repeat acknowledgement of one quote emits once; different quote emits separately', async () => {
  const first = tracking();
  first.window.mtrack('quote_submit', { dedupe_key: 'one' });
  first.window.mtrack('quote_submit', { dedupe_key: 'one' });
  const next = tracking({ sessionStorage: first.sessionStorage });
  next.window.mtrack('quote_submit', { dedupe_key: 'one' });
  next.window.mtrack('quote_submit', { dedupe_key: 'two' });
  const packets = [...await first.packets(), ...await next.packets()];
  assert.equal(packets.filter((packet) => packet.event === 'quote_submit').length, 2);
  assert.equal(packets.filter((packet) => packet.event === 'pageview').length, 2);
});

test('rejected sendBeacon queue falls back to fetch, preserving attribution', () => {
  const result = tracking({ accepted: false, search: '?utm_source=partner&utm_medium=email' });
  result.window.mtrack('quote_submit', { dedupe_key: 'one' });
  result.window.mtrack('quote_submit', { dedupe_key: 'one' });
  assert.equal(result.fallbacks.length, 2);
  assert.equal(result.fallbacks[1].utm.utm_source, 'partner');
});

async function confirm(order, sessionStorage = storage(), search = '?session_id=cs_example') {
  const events = [];
  const nodes = {};
  runInNewContext(confirmation, {
    location: { search }, URLSearchParams, Intl,
    document: { getElementById: (id) => nodes[id] ||= {}, querySelectorAll: () => [] },
    localStorage: storage(), sessionStorage,
    window: { mtrack: (event) => events.push(event) },
    fetch: async () => ({ ok: true, json: async () => order }),
  });
  await new Promise(setImmediate);
  return { events, nodes, sessionStorage };
}

test('only explicit live paid Checkout Sessions emit confirmation events', async () => {
  for (const order of [
    { payment_status: 'unpaid', live_mode: true },
    { payment_status: 'paid', live_mode: false },
    { payment_status: 'paid' },
    { live_mode: true },
    { payment_status: 'no_payment_required', live_mode: true },
  ]) assert.deepEqual((await confirm(order)).events, []);
  assert.deepEqual((await confirm({ payment_status: 'paid', live_mode: true })).events, ['order_confirmed']);
});

test('unpaid return does not consume the later paid confirmation; reload deduplicates', async () => {
  const first = await confirm({ payment_status: 'unpaid', live_mode: true });
  assert.match(first.nodes.sessionSummary.textContent, /payment is processing/);
  const paid = await confirm({ payment_status: 'paid', live_mode: true }, first.sessionStorage);
  assert.deepEqual(paid.events, ['order_confirmed']);
  assert.deepEqual((await confirm({ payment_status: 'paid', live_mode: true }, first.sessionStorage)).events, []);
});

test('direct confirmation-page visit never emits a paid event', async () => {
  assert.deepEqual((await confirm({ payment_status: 'paid', live_mode: true }, storage(), '')).events, []);
});
