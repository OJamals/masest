import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { normalizeLeadAttribution, leadAcquisitionLabel } from '../js/lead-attribution.js';
import { createQuoteHandler } from '../functions/api/quote.js';
import { createLeadAcquisitionHandler } from '../functions/api/admin/lead-acquisition.js';
import { loadLeadAcquisitionWindow, leadAcquisitionReport } from '../functions/_lib/lead-acquisition.js';
import { createQuoteLeadLifecycle } from '../functions/_lib/quote-leads.js';
import { deliverQuoteIntakeEmail } from '../functions/_lib/quote-intake-effects.js';
import { renderLeadAcquisition, createTrafficRenderer } from '../js/admin/traffic.js';
import { requestDetailsHtml } from '../js/admin/quotes.js';
import { pipelineSummary } from '../functions/_lib/crm-pipeline.js';
import { launchTestBrowser, startStaticTestServer } from '../tools/test-static-server.mjs';

const entry = {
  landing_path: '/blog/how-to-descale-heat-exchanger?email=buyer%40example.com#secret',
  referrer_origin: 'https://www.google.com/search?q=private&token=secret',
  utm_source: 'partner', utm_medium: 'email', utm_campaign: 'maintenance',
  visitor: 'must-not-link', email: 'buyer@example.com',
};
const safeEntry = {
  version: 1, landing_path: '/blog/how-to-descale-heat-exchanger',
  referrer_origin: 'https://www.google.com',
  utm_source: 'partner', utm_medium: 'email', utm_campaign: 'maintenance',
};
const quoteId = '22222222-2222-4222-8222-222222222222';
const intakeId = '11111111-1111-4111-8111-111111111111';

test('attribution keeps only bounded public context and removes URL secrets and identity', () => {
  assert.deepEqual(normalizeLeadAttribution(JSON.stringify(entry)), safeEntry);
  for (const value of [null, [], 'bad json', 'x'.repeat(2049), { landing_path: '/admin' },
    { landing_path: '/order/private-token' }, { referrer_origin: 'https://name:password@example.com' },
    { referrer_origin: 'https://masest.co/private' }, { referrer_origin: 'javascript:alert(1)' },
    { utm_source: 'buyer@example.com', utm_medium: '<script>', utm_campaign: '555-555-1234' },
    { utm_source: ['partner'], utm_campaign: 'a'.repeat(121) }]) {
    assert.equal(normalizeLeadAttribution(value), null);
  }
  assert.equal(normalizeLeadAttribution({ landing_path: '/products/hcr.html?token=secret' }).landing_path, '/products/hcr');
});

test('missing historical source stays unknown; captured entry without a referrer is direct or unknown', () => {
  assert.equal(leadAcquisitionLabel(null), 'Unknown');
  assert.equal(leadAcquisitionLabel({ landing_path: '/' }), 'Direct or unknown / Unknown');
  assert.equal(leadAcquisitionLabel({ referrer_origin: 'https://www.google.com' }), 'Google / Organic search');
  assert.equal(leadAcquisitionLabel({ referrer_origin: 'https://partner.example.org' }), 'partner.example.org / Referral');
});

test('Matthew receives readable acquisition context without raw tracking objects', async () => {
  let message;
  await deliverQuoteIntakeEmail({}, {}, { id: quoteId, type: 'callback', phone: '8135550123', payload: { attribution: entry } }, 'internal', {
    sendEmail: async (_env, value) => { message = value; return { ok: true }; },
  });
  assert.deepEqual(message.to, ['matthew@masest.co']);
  assert.match(message.html, /Acquisition source/);
  assert.match(message.html, /partner \/ email \/ maintenance/);
  assert.match(message.html, /Entry page/);
  assert.doesNotMatch(message.html, /\[object Object\]|private|secret|must-not-link/);
});

test('both public request modes preserve safe attribution without permitting reporting exclusion', async () => {
  for (const type of ['callback', 'private-label']) {
    let saved;
    const handler = createQuoteHandler({
      rateLimit: async () => ({ ok: true }), verifyTurnstile: async () => ({ status: 'verified' }),
      adminClient: () => ({}), saveIntake: async (_sb, value) => { saved = value; return { quoteId }; },
    });
    const response = await handler({ env: {}, request: new Request('https://masest.test/api/quote', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type, submission_id: intakeId, phone: '+1 (813) 555-0123', email: 'buyer@example.com',
        reporting_excluded: true, attribution: JSON.stringify(entry), utm_source: 'buyer@example.com', utm_term: 'private' }),
    }) });
    assert.equal(response.status, 201);
    assert.deepEqual(saved.row.payload.attribution, safeEntry);
    assert.equal(saved.row.reporting_excluded, undefined);
    assert.equal(saved.row.payload.utm_source, undefined);
    assert.equal(saved.row.payload.utm_term, undefined);
    assert.equal(saved.row.payload.contact_preference, type === 'callback' ? 'phone' : 'email');
    if (type === 'callback') assert.equal(saved.row.email, null);
  }
});

test('late or blocked attribution cannot change retry identity or lead priority', async () => {
  const saved = [];
  const handler = createQuoteHandler({
    rateLimit: async () => ({ ok: true }), verifyTurnstile: async () => ({ status: 'verified' }),
    adminClient: () => ({}), saveIntake: async (_sb, value) => {
      saved.push(value);
      if (saved.length > 1) assert.equal(value.fingerprint, saved[0].fingerprint);
      return { quoteId, duplicate: saved.length > 1 };
    },
  });
  for (const attribution of [undefined, { ...entry, utm_campaign: 'urgent distributor today' }, null]) {
    const response = await handler({ env: {}, request: new Request('https://masest.test/api/quote', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'quote', email: 'buyer@example.com', phone: '8135550123', submission_id: intakeId,
        attribution, ...(attribution ? { utm_source: 'urgent distributor', utm_campaign: 'today' } : {}) }),
    }) });
    assert.equal(response.status, saved.length === 1 ? 201 : 200);
  }
  assert.ok(saved.every(({ row }) => row.lead_score === saved[0].row.lead_score));
});

test('identical pre-release retries remain valid but old-fingerprint fallback rejects changed business details', async () => {
  // Captured shape of the preceding intake contract: campaign text affected its score.
  const fields = { type: 'quote', email: 'buyer@example.com', utm_source: 'urgent distributor', utm_campaign: 'today' };
  const original = {
    type: 'quote', name: null, email: fields.email, company: null, phone: null, product: null, industry: null,
    location: null, message: null,
    payload: { ...fields, contact_preference: 'email', marketing_email_enabled: false },
    source: 'contact', status: 'new', lead_score: 52, priority: 'normal', pipeline_stage: 'new', next_step: null,
  };
  const ordered = (value) => value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])])) : value;
  const originalFingerprint = createHash('sha256').update(JSON.stringify(ordered(original))).digest('hex');
  const attempts = [];
  const handler = createQuoteHandler({
    rateLimit: async () => ({ ok: true }), verifyTurnstile: async () => ({ status: 'verified' }),
    adminClient: () => ({ rpc: async (name, input) => {
      if (name === 'assert_email_effects_ready') return { data: true };
      attempts.push(input.p_fingerprint);
      return input.p_fingerprint === originalFingerprint
        ? { data: { quote_id: quoteId, duplicate: true } }
        : { error: { message: 'quote_intake_identity_collision' } };
    } }),
  });
  const submit = (body) => handler({ env: {}, request: new Request('https://masest.test/api/quote', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, submission_id: intakeId }),
  }) });
  const identical = await submit(fields);
  assert.equal(identical.status, 200);
  assert.equal((await identical.json()).duplicate, true);
  assert.equal(attempts.length, 2);
  assert.notEqual(attempts[0], originalFingerprint);
  assert.equal(attempts[1], originalFingerprint);
  const changed = await submit({ ...fields, email: 'different@example.com' });
  assert.equal(changed.status, 409);
  assert.equal((await changed.json()).error, 'idempotency_conflict');
});

const websiteLead = (overrides = {}) => ({ source: 'contact', status: 'new', type: 'callback', pipeline_stage: 'new',
  payload: { contact_preference: 'phone', attribution: safeEntry }, ...overrides });

test('report counts durable website requests, explicit exclusions, and current stages without inferring qualification', () => {
  const rows = [
    websiteLead({ pipeline_stage: 'qualified' }),
    websiteLead({ pipeline_stage: 'sample_audit' }),
    websiteLead({ type: 'private-label', email: 'buyer@example.com', pipeline_stage: 'proposal', payload: { contact_preference: 'email' } }),
    websiteLead({ pipeline_stage: 'lost', payload: { contact_preference: 'phone' } }),
    websiteLead({ status: 'spam' }), websiteLead({ reporting_excluded: true }),
    websiteLead({ email: ' STAFF@example.com ' }), websiteLead({ source: 'requisition' }),
    websiteLead({ payload: { reporting_excluded: true, contact_preference: 'phone' } }),
  ];
  const report = leadAcquisitionReport(rows, ['staff@example.com']);
  assert.deepEqual(report.totals, { requests: 5, phone: 4, email: 1, unknown_contact: 0, qualified: 1, proposal: 1, won: 0 });
  assert.deepEqual(report.excluded, { spam: 1, staff: 1, internal_test: 1 });
  assert.equal(report.sources.find((row) => row.key === 'Unknown').requests, 3);
  assert.equal(report.landing_pages.find((row) => row.key === safeEntry.landing_path).requests, 2);
  assert.doesNotMatch(JSON.stringify(report), /buyer@|staff@|"payload"|"email":\s*"/);
  assert.equal(leadAcquisitionReport([websiteLead({ payload: { utm_source: 'legacy-partner' } })]).sources[0].key, 'legacy-partner / Unspecified');
});

function database(rows, cap = 1000, error = null) {
  const ranges = [];
  return { ranges, from(table) {
    assert.equal(table, 'quotes');
    let selected = rows;
    return {
      select(_columns, options) { assert.equal(options.count, 'exact'); return this; },
      eq(key, value) { selected = selected.filter((row) => row[key] === value); return this; },
      gte(key, value) { selected = selected.filter((row) => row[key] >= value); return this; },
      lt(key, value) { selected = selected.filter((row) => row[key] < value); return this; },
      order() { return this; },
      async range(from, to) { ranges.push([from, to]); return { data: selected.slice(from, Math.min(to + 1, from + cap)), count: selected.length, error }; },
    };
  } };
}

test('lead window follows database caps, fixed bounds, and discloses truncation', async () => {
  const rows = Array.from({ length: 2505 }, (_, id) => websiteLead({ id, created_at: '2026-09-27' }));
  const sb = database([...rows, websiteLead({ created_at: '2026-09-29' }), websiteLead({ source: 'requisition', created_at: '2026-09-27' })], 800);
  const complete = await loadLeadAcquisitionWindow(sb, '2026-09-01', '2026-09-29');
  assert.equal(complete.rows.length, 2505);
  assert.equal(complete.matched, 2505);
  assert.equal(complete.truncated, false);
  assert.deepEqual(sb.ranges.map(([offset]) => offset), [0, 800, 1600, 2400]);
  const limited = await loadLeadAcquisitionWindow(database(rows), '2026-09-01', '2026-09-29', 1200);
  assert.equal(limited.rows.length, 1200);
  assert.equal(limited.truncated, true);
  await assert.rejects(loadLeadAcquisitionWindow(database([], 1000, new Error('unavailable')), '2026-09-01', '2026-09-29'), /unavailable/);
});

test('acquisition endpoint authenticates before querying and reports unavailable separately from zero', async () => {
  const request = new Request('https://masest.test/api/admin/lead-acquisition?days=28');
  let queried = false;
  for (const [identity, status] of [[{ user: null }, 401], [{ user: {}, staff: false }, 403]]) {
    const handler = createLeadAcquisitionHandler({ requireStaff: async () => identity, adminClient: () => { queried = true; } });
    assert.equal((await handler({ request, env: {} })).status, status);
  }
  assert.equal(queried, false);
  const base = { requireStaff: async () => ({ user: {}, staff: true }), adminClient: () => ({}), now: () => new Date('2026-09-29T12:00:00Z') };
  const handler = createLeadAcquisitionHandler({ ...base, loadWindow: async (_sb, since, until) => {
    assert.equal(since, '2026-09-01T12:00:00.000Z');
    assert.equal(until, '2026-09-29T12:00:00.000Z');
    return { rows: [], matched: 0, truncated: false };
  } });
  const response = await handler({ request, env: {} });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).totals.requests, 0);
  const failed = createLeadAcquisitionHandler({ ...base, loadWindow: async () => { throw new Error('private database detail'); } });
  const failure = await failed({ request, env: {} });
  assert.equal(failure.status, 503);
  assert.deepEqual(await failure.json(), { available: false, error: 'lead_report_unavailable' });
});

test('staff reporting exclusion changes no pipeline state and rejects ambiguous flag values', async () => {
  const patches = [];
  const lifecycle = createQuoteLeadLifecycle({ store: { updateQuote: async (id, patch) => { patches.push(patch); return { id, ...patch }; } } });
  for (const reporting_excluded of [true, false]) {
    const result = await lifecycle.update({ id: quoteId, changes: { reporting_excluded }, actor: 'staff@example.com' });
    assert.equal(result.ok, true);
    assert.deepEqual(patches.at(-1), { reporting_excluded });
  }
  for (const reporting_excluded of ['false', 1, null]) {
    assert.equal((await lifecycle.update({ id: quoteId, changes: { reporting_excluded } })).error, 'invalid_reporting_excluded');
  }
  assert.equal(patches.length, 2);
});

test('staff views escape acquisition labels and explain partial windows and unknown sources', async () => {
  const html = renderLeadAcquisition({ available: true, days: 28, since: '2026-09-01', until: '2026-09-29',
    totals: { requests: 2, phone: 1, email: 1 }, excluded: {}, truncated: true, scanned: 2, matched: 9,
    sources: [{ key: '<script>unsafe</script>', requests: 2, qualified: 1, proposal: 0, won: 0 }], landing_pages: [] });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /Partial window/);
  assert.match(html, /current state/);
  assert.match(html, /Unknown means/);
  assert.match(requestDetailsHtml(websiteLead({ reporting_excluded: true })), /Internal\/test inquiry/);
  assert.match(requestDetailsHtml(websiteLead()), /Entry page/);
  const box = {};
  const render = createTrafficRenderer({ $: () => box, admSkeleton: () => '', pct: () => '', api: async (url) => {
    if (url.includes('/traffic?')) throw new Error('beacons unavailable');
    return { available: true, days: 28, totals: { requests: 0, phone: 0, email: 0 }, excluded: {}, sources: [], landing_pages: [] };
  } });
  await render();
  assert.match(box.innerHTML, /0 saved requests/);
  assert.match(box.innerHTML, /Browser activity unavailable/);
});

test('staff can inspect acquisition on mobile and exclude a phone-only test without moving its stage', async () => {
  const server = await startStaticTestServer(new URL('../', import.meta.url));
  const browser = await launchTestBrowser();
  try {
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    await page.addInitScript(() => {
      window.MASEST_SUPABASE_URL = 'https://stub.supabase.co';
      window.MASEST_SUPABASE_ANON = 'stub-anon-key';
    });
    const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    await page.route('**/*.supabase.co/**', (route) => route.fulfill(json({ data: { session: null }, session: null })));
    let quote = websiteLead({ id: quoteId, phone: '8135550123', priority: 'low', reporting_excluded: false });
    const mutations = [];
    await page.route('**/api/admin/**', (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/admin/lead-acquisition') return route.fulfill(json({
        available: true, days: 28, since: '2026-09-01', until: '2026-09-29',
        ...leadAcquisitionReport([quote]),
      }));
      if (url.pathname === '/api/admin/traffic') return route.fulfill(json({ available: false }));
      if (url.pathname === '/api/admin/quotes') {
        if (route.request().method() === 'POST') {
          const changes = route.request().postDataJSON();
          mutations.push(changes);
          quote = { ...quote, ...changes };
          return route.fulfill(json({ ok: true, quote }));
        }
        if (url.searchParams.get('view') === 'pipeline') return route.fulfill(json({ summary: pipelineSummary([quote]) }));
        return route.fulfill(json({ quotes: [quote], total: 1, has_more: false, new_count: 1, urgent_count: 0 }));
      }
      return route.fulfill(json({ companies: [], timeline: [], tasks: [], notes: [], total: 0, has_more: false }));
    });
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${server.baseUrl}/admin.html#seo`);
      await page.getByRole('region', { name: 'Website inquiry acquisition' }).waitFor();
      assert.match(await page.locator('#admTraffic').innerText(), /1 saved requests · 1 call requests/);
      assert.match(await page.locator('#admTraffic').innerText(), /partner \/ email \/ maintenance/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    await page.goto(`${server.baseUrl}/admin.html#quotes`);
    await page.locator('.pipe-toggle [data-view="board"]').click();
    await page.locator(`.pipe-card[data-card-id="${quoteId}"]`).click();
    await page.getByLabel('Exclude from acquisition reporting', { exact: false }).check();
    await page.locator('[data-drawer-save]').click();
    await page.getByText('Saved.', { exact: true }).waitFor();
    assert.equal(mutations.length, 1);
    assert.equal(mutations[0].reporting_excluded, true);
    assert.equal(mutations[0].pipeline_stage, undefined);
    await page.goto(`${server.baseUrl}/admin.html#seo`);
    await page.getByRole('region', { name: 'Website inquiry acquisition' }).waitFor();
    assert.match(await page.locator('#admTraffic').innerText(), /0 saved requests/);
    assert.match(await page.locator('#admTraffic').innerText(), /1 marked internal\/test/);
  } finally { await browser.close(); await server.close(); }
});
