import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseImportEmails, onRequest as recipientsRoute } from '../functions/api/admin/recipients.js';
import {
  claimNewsletter,
  recoverNewsletterPreparation,
  onRequest as newslettersRoute,
} from '../functions/api/admin/newsletters.js';
import { claimBlogNewsletter, onRequestPost as blogNewsletterRoute } from '../functions/api/admin/blog-newsletter.js';

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('parseImportEmails: dedupes + validates from array and CSV blob', () => {
  const out = parseImportEmails({ emails: ['A@x.com', 'bad'], csv: 'b@x.com, a@x.com\nc@x.com;notanemail' });
  assert.deepEqual(out, ['a@x.com', 'b@x.com', 'c@x.com']);
});

const anonReq = (method = 'GET', body = {}) => ({
  method,
  url: 'https://masest.co/api/admin/newsletters',
  headers: { get: () => null },
  json: async () => body,
});

const staffEnv = {
  SUPABASE_URL: 'https://supabase.test',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
};

function staffReq(method, body = {}, onParse = () => {}) {
  return {
    method,
    url: 'https://masest.co/api/admin/recipients',
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'authorization' ? 'Bearer staff-token' : null;
      },
    },
    async json() {
      onParse();
      return body;
    },
  };
}

function mockStaffFetch(role) {
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes('/auth/v1/user')) {
      return Response.json({ id: 'staff-user', email: `${role}@example.test` });
    }
    if (url.includes('/rest/v1/profiles')) {
      return Response.json({ is_staff: true, staff_role: role });
    }
    if (url.includes('/auth/v1/admin/users')) {
      return Response.json({ users: [] });
    }
    if (url.includes('/rest/v1/newsletter_recipients')) {
      const method = init.method || 'GET';
      return method === 'GET' ? Response.json([]) : new Response(null, { status: 201 });
    }
    if (url.includes('/rest/v1/rpc/set_marketing_email_preferences')) {
      return Response.json(1);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
}

test('recipients: 401 for anonymous', async () => {
  const res = await recipientsRoute({ request: anonReq('GET'), env: {} });
  assert.equal(res.status, 401);
});

test('recipients: read_only retains canonical audience count and import-audit access', async () => {
  mockStaffFetch('read_only');
  let parseCalls = 0;
  const res = await recipientsRoute({
    request: staffReq('GET', {}, () => { parseCalls += 1; }),
    env: staffEnv,
  });

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    recipients: [],
    counts: { subscribers: 0, imported: 0 },
  });
  assert.equal(parseCalls, 0);
});

const RECIPIENT_WRITES = [
  ['import', { action: 'import', emails: ['reader@example.test'] }],
  ['add', { action: 'add', email: 'reader@example.test' }],
  ['update', { action: 'update', email: 'reader@example.test', name: 'Reader' }],
  ['unsubscribe', { action: 'update', email: 'reader@example.test', subscribed: false }],
  ['delete', { action: 'remove', email: 'reader@example.test' }],
];

test('recipients: read_only denies every mutation before body parsing', async (t) => {
  for (const [name, body] of RECIPIENT_WRITES) {
    await t.test(name, async () => {
      mockStaffFetch('read_only');
      let parseCalls = 0;
      const res = await recipientsRoute({
        request: staffReq('POST', body, () => { parseCalls += 1; }),
        env: staffEnv,
      });

      assert.equal(res.status, 403);
      assert.deepEqual(await res.json(), {
        error: 'forbidden',
        message: 'Read-only staff cannot make changes.',
      });
      assert.equal(parseCalls, 0);
    });
  }
});

test('recipients: existing writer roles retain mutation success', async (t) => {
  for (const role of ['owner', 'finance', 'support']) {
    await t.test(role, async () => {
      mockStaffFetch(role);
      let parseCalls = 0;
      const res = await recipientsRoute({
        request: staffReq('POST', { action: 'add', email: `${role}@example.test` }, () => { parseCalls += 1; }),
        env: staffEnv,
      });

      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { ok: true });
      assert.equal(parseCalls, 1);
    });
  }
});

test('newsletters: 401 for anonymous staff action', async () => {
  const res = await newslettersRoute({ request: anonReq('GET'), env: {} });
  assert.equal(res.status, 401);
});

test('newsletters: sweep_due 401 without cron secret', async () => {
  const res = await newslettersRoute({ request: anonReq('POST', { action: 'sweep_due' }), env: { NEWSLETTER_CRON_SECRET: 'right' } });
  assert.equal(res.status, 401);
});

test('newsletters: sweep_due 401 when no secret configured', async () => {
  const res = await newslettersRoute({ request: anonReq('POST', { action: 'sweep_due' }), env: {} });
  assert.equal(res.status, 401);
});

test('claimNewsletter: atomically moves one allowed row to queueing', async () => {
  const calls = [];
  const claimed = { id: 'newsletter-1', status: 'queueing', subject: 'Claimed' };
  const sb = {
    from(table) {
      calls.push(['from', table]);
      return {
        update(patch) {
          calls.push(['update', patch]);
          return {
            eq(column, value) {
              calls.push(['eq', column, value]);
              return {
                in(statusColumn, statuses) {
                  calls.push(['in', statusColumn, statuses]);
                  return {
                    select(columns) {
                      calls.push(['select', columns]);
                      return {
                        async maybeSingle() {
                          calls.push(['maybeSingle']);
                          return { data: claimed, error: null };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };

  const result = await claimNewsletter(sb, 'newsletter-1', ['draft', 'scheduled']);

  assert.deepEqual(result, { newsletter: claimed, error: null });
  assert.deepEqual(calls[0], ['from', 'newsletters']);
  assert.equal(calls[1][0], 'update');
  assert.equal(calls[1][1].status, 'queueing');
  assert.deepEqual(calls.slice(2), [
    ['eq', 'id', 'newsletter-1'],
    ['in', 'status', ['draft', 'scheduled']],
    ['select', '*'],
    ['maybeSingle'],
  ]);
});

test('recoverNewsletterPreparation: uses the fenced lease RPC and returns the reclaimed row', async () => {
  const calls = [];
  const sb = { async rpc(name, args) { calls.push([name, args]); return { data: [{ id: 'n1', status: 'queueing' }], error: null }; } };
  const result = await recoverNewsletterPreparation(sb, 'n1', '11111111-1111-4111-8111-111111111111');
  assert.equal(result.newsletter.status, 'queueing');
  assert.equal(calls[0][0], 'claim_newsletter_preparation');
  assert.equal(calls[0][1].p_lease_token, '11111111-1111-4111-8111-111111111111');
});

test('claimBlogNewsletter: primary-key insert claims one post before provider work', async () => {
  let inserted = null;
  const sb = {
    from(table) {
      assert.equal(table, 'blog_newsletter_sends');
      return {
        async insert(row) {
          inserted = row;
          return { error: null };
        },
      };
    },
  };

  const claim = await claimBlogNewsletter(sb, 'new-post');
  assert.equal(claim.claimed, true);
  assert.equal(claim.error, null);
  assert.match(claim.leaseToken, /^[0-9a-f-]{36}$/);
  assert.equal(inserted.slug, 'new-post');
  assert.equal(inserted.provider, 'ses');
  assert.equal(inserted.provider_status, 'queueing');
  assert.equal(inserted.sent_at, null);
});

test('claimBlogNewsletter: duplicate primary key is an already-claimed no-op', async () => {
  const sb = {
    from() {
      return { insert: async () => ({ error: { code: '23505' } }) };
    },
  };

  assert.deepEqual(await claimBlogNewsletter(sb, 'new-post'), { claimed: false, error: null });
});

test('newsletters: send_now materializes durable SES deliveries', () => {
  const source = readFileSync(new URL('../functions/api/admin/newsletters.js', import.meta.url), 'utf8');
  const preparation = readFileSync(new URL('../functions/_lib/newsletter-preparation.js', import.meta.url), 'utf8');
  const start = source.indexOf("if (action === 'send_now')");
  const end = source.indexOf("return json(400, { error: 'bad_action' })", start);
  const sendNow = source.slice(start, end);
  assert.match(sendNow, /await claimNewsletter\(sb, body\.id/);
  assert.match(sendNow, /await queueNewsletter\(env, sb, claim\.newsletter\)/);
  assert.match(sendNow, /return json\(202,/);
  assert.match(source, /materializeDeliverySource/);
  assert.match(source, /enqueueMarketingDelivery/);
  assert.doesNotMatch(source, /runSupabaseDeliveryWorker/);
  assert.match(preparation, /loadMarketingAudience/);
  assert.match(source, /provider: 'ses'/);
  assert.doesNotMatch(source, /klaviyo/i);
  const ui = readFileSync(new URL('../js/admin/newsletter.js', import.meta.url), 'utf8');
  assert.match(ui, /Queued \$\{Number\(res\.total/);
  assert.doesNotMatch(ui, /klaviyo/i);
  const adminEntry = readFileSync(new URL('../js/admin.js', import.meta.url), 'utf8');
  // Derived from the deployed entry so a release bump stays a one-line change.
  const release = readFileSync(new URL('../admin.html', import.meta.url), 'utf8').match(/js\/admin\.js\?v=(\d{8}[a-z])/)?.[1];
  assert.ok(release, 'admin.html must cache-bust the admin entrypoint');
  assert.match(adminEntry, new RegExp(`\\./admin/newsletter\\.js\\?v=${release}`));
});

test('blog sweep materializes durable SES deliveries after claiming each post', () => {
  const source = readFileSync(new URL('../functions/api/admin/blog-newsletter.js', import.meta.url), 'utf8');
  const claimAt = source.indexOf('await claimBlogNewsletter(sb, post.slug)');
  const materializeAt = source.indexOf('await materializeDeliverySource(sb, {');
  assert.ok(claimAt >= 0 && claimAt < materializeAt, 'blog post must be claimed before delivery materialization');
  assert.match(source, /materializeDeliverySource/);
  assert.match(source, /enqueueMarketingDelivery/);
  assert.doesNotMatch(source, /runSupabaseDeliveryWorker/);
  assert.match(source, /loadMarketingAudience/);
  assert.match(source, /provider: 'ses'/);
  assert.doesNotMatch(source, /klaviyo/i);
});

test('campaign preparation migration preserves explicit one-shot and nonrecurring source identity', () => {
  const migration = readFileSync(new URL('../supabase/migrate-campaign-preparation-recovery-2026-09-05.sql', import.meta.url), 'utf8');
  assert.match(migration, /^begin;\s*$/m);
  assert.match(migration, /new\.preparation_scheduled\s*:=\s*coalesce\(new\.preparation_scheduled, old\.status = 'scheduled'\)/);
  assert.match(migration, /preparation_source_id\s*=\s*coalesce\(preparation_source_id, case when schedule->>'mode' = 'recurring'[\s\S]*?else id::text end\)/);
  assert.match(migration, /commit;\s*$/m);
});

// These route tests deliberately exercise the real Supabase client created by
// adminClient(). The fetch router below stands in for PostgREST/Auth/RPC only;
// no route-local store or mocked Supabase client can hide an SDK request-shape
// regression.
const newsletterEnv = (queue) => ({
  SUPABASE_URL: 'https://supabase.test',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  ADMIN_EMAILS: 'staff@example.test',
  MARKETING_EMAIL_QUEUE: queue,
});

const newsletterRequest = (body, { cronSecret = null } = {}) => ({
  method: 'POST',
  url: 'https://masest.co/api/admin/newsletters',
  headers: {
    get(name) {
      const key = String(name).toLowerCase();
      if (key === 'authorization') return 'Bearer staff-token';
      if (key === 'x-newsletter-cron-secret') return cronSecret;
      return null;
    },
  },
  json: async () => body,
});

function installNewsletterRouteFetch({
  newsletter,
  source = null,
  sourceError = false,
  materialize = [{ created: true, total_count: 1 }],
  parentSaveLost = false,
  scheduled = [],
  queueing = [],
  failed = [],
  recovery = null,
  audience = ['buyer@example.test'],
} = {}) {
  const calls = [];
  let current = { ...(newsletter || {}) };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || 'GET').toUpperCase();
    const path = url.pathname;
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, path, search: url.search, body });

    if (path.endsWith('/auth/v1/user')) return Response.json({ id: 'staff-user', email: 'staff@example.test' });
    if (path.includes('/rest/v1/newsletter_recipients')) return Response.json((audience || []).map((email) => ({ email })));
    if (path.includes('/rest/v1/newsletter_settings')) return Response.json([{ auto_send_latest_blog: false }]);
    if (path.includes('/rest/v1/automation_runs')) return new Response(null, { status: 201 });

    if (path.includes('/rest/v1/newsletter_delivery_sources')) {
      if (method === 'GET') {
        if (sourceError) return Response.json({ code: 'PGRST000', message: 'source lookup failed' }, { status: 500 });
        return Response.json(source ? [source] : []);
      }
      return new Response(null, { status: 204 });
    }

    if (path.includes('/rest/v1/rpc/claim_newsletter_preparation')) {
      return Response.json(recovery ? [recovery] : []);
    }
    if (path.includes('/rest/v1/rpc/materialize_newsletter_deliveries_fenced')) return Response.json(materialize);
    if (path.includes('/rest/v1/rpc/materialize_newsletter_deliveries')) return Response.json(materialize);

    if (path.endsWith('/rest/v1/newsletters')) {
      if (method === 'GET') {
        if (url.searchParams.get('status') === 'eq.scheduled') {
          return Response.json(url.search.includes('next_run_at=is.null') ? [] : scheduled);
        }
        if (url.searchParams.get('status') === 'eq.queueing') return Response.json(queueing);
        if (url.searchParams.get('status') === 'eq.failed') return Response.json(failed);
        return Response.json(current.id ? [current] : []);
      }
      if (method === 'PATCH') {
        if (body?.status === 'queueing') {
          current = { ...current, ...body };
          return Response.json([current]);
        }
        if (body?.status === 'failed' && !url.search.includes('select=')) return new Response(null, { status: 204 });
        if (parentSaveLost) return Response.json([]);
        current = { ...current, ...body };
        return Response.json([current]);
      }
    }

    throw new Error(`Unexpected newsletter route fetch: ${method} ${url}`);
  };
  return calls;
}

function callFor(calls, predicate) {
  const found = calls.find(predicate);
  assert.ok(found, `expected Supabase call; saw ${calls.map((call) => `${call.method} ${call.path}${call.search}`).join('\n')}`);
  return found;
}

test('newsletters route: send_now claims recurring campaign as one-shot preparation', async () => {
  const newsletter = {
    id: 'newsletter-send-now', status: 'draft', subject: 'Briefing', body_md: 'Hello',
    schedule: { mode: 'recurring', interval_days: 14, next_run_at: '2026-09-01T00:00:00.000Z' },
  };
  const queued = [];
  const calls = installNewsletterRouteFetch({ newsletter });
  const res = await newslettersRoute({
    request: newsletterRequest({ action: 'send_now', id: newsletter.id }),
    env: newsletterEnv({ async send(body) { queued.push(body); } }),
  });
  assert.equal(res.status, 202);
  const payload = await res.json();
  assert.equal(payload.source_id, `${newsletter.id}:${newsletter.schedule.next_run_at}`);
  assert.equal(payload.queued, true);

  const claim = callFor(calls, (call) => call.path.endsWith('/rest/v1/newsletters') && call.method === 'PATCH' && call.body?.status === 'queueing');
  assert.equal(claim.body.preparation_scheduled, false);
  const materialize = callFor(calls, (call) => call.path.endsWith('/rpc/materialize_newsletter_deliveries_fenced'));
  assert.equal(materialize.body.p_source_id, payload.source_id);
  assert.equal(materialize.body.p_metadata.next_schedule, null);
  const save = calls.filter((call) => call.path.endsWith('/rest/v1/newsletters') && call.method === 'PATCH').at(-1);
  assert.equal(save.body.status, 'sending');
  assert.equal(save.body.preparation_scheduled, null);
  assert.deepEqual(queued, [{ version: 1, kind: 'marketing_delivery.drain', sourceType: 'newsletter', sourceId: payload.source_id }]);
});

test('newsletters route: sweep_due marks scheduled recurring preparation', async () => {
  const newsletter = {
    id: 'newsletter-scheduled', status: 'scheduled', subject: 'Recurring', body_md: 'Hello',
    schedule: { mode: 'recurring', interval_days: 7, next_run_at: '2020-01-01T00:00:00.000Z' },
  };
  const queued = [];
  const calls = installNewsletterRouteFetch({ newsletter, scheduled: [newsletter] });
  const res = await newslettersRoute({
    request: newsletterRequest({ action: 'sweep_due' }, { cronSecret: 'cron-secret' }),
    env: { ...newsletterEnv({ async send(body) { queued.push(body); } }), NEWSLETTER_CRON_SECRET: 'cron-secret' },
  });
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.ok, true);
  const claim = callFor(calls, (call) => call.path.endsWith('/rest/v1/newsletters') && call.method === 'PATCH' && call.body?.status === 'queueing');
  assert.equal(claim.body.preparation_scheduled, true);
  const materialize = callFor(calls, (call) => call.path.endsWith('/rpc/materialize_newsletter_deliveries_fenced'));
  assert.equal(materialize.body.p_metadata.next_schedule.mode, 'recurring');
  assert.equal(materialize.body.p_metadata.next_schedule.interval_days, 7);
  assert.equal(queued.length, 1);
});

test('newsletters route: recovery keeps source id and stored next schedule', async () => {
  const nextSchedule = { mode: 'recurring', interval_days: 5, next_run_at: '2026-09-12T12:00:00.000Z' };
  const newsletter = {
    id: 'newsletter-recover', status: 'queueing', subject: 'Recover', body_md: 'Hello',
    preparation_lease_token: '11111111-1111-4111-8111-111111111111',
    preparation_lease_expires_at: '2020-01-01T00:00:00.000Z', preparation_scheduled: true,
    preparation_schedule: { mode: 'recurring', interval_days: 5, next_run_at: '2026-09-01T12:00:00.000Z' },
    preparation_source_id: 'newsletter-recover:original-occurrence', schedule: { mode: 'recurring', interval_days: 5 },
  };
  const recovered = { ...newsletter, preparation_lease_token: '22222222-2222-4222-8222-222222222222' };
  const calls = installNewsletterRouteFetch({
    newsletter,
    queueing: [newsletter],
    recovery: recovered,
    source: { source_type: 'newsletter', source_id: newsletter.preparation_source_id, parent_id: newsletter.id, metadata: { next_schedule: nextSchedule } },
  });
  const res = await newslettersRoute({
    request: newsletterRequest({ action: 'sweep_due' }, { cronSecret: 'cron-secret' }),
    env: { ...newsletterEnv({ async send() {} }), NEWSLETTER_CRON_SECRET: 'cron-secret' },
  });
  assert.equal(res.status, 200);
  const materialize = callFor(calls, (call) => call.path.endsWith('/rpc/materialize_newsletter_deliveries_fenced'));
  assert.equal(materialize.body.p_source_id, newsletter.preparation_source_id);
  assert.deepEqual(materialize.body.p_metadata.next_schedule, nextSchedule);
  const save = calls.filter((call) => call.path.endsWith('/rest/v1/newsletters') && call.method === 'PATCH').at(-1);
  assert.deepEqual(save.body.schedule, nextSchedule);
});

test('newsletters route: source lookup failure is retryable and does not materialize', async () => {
  const newsletter = { id: 'newsletter-source-failure', status: 'draft', subject: 'Failure', body_md: 'Hello' };
  const calls = installNewsletterRouteFetch({ newsletter, sourceError: true });
  const res = await newslettersRoute({
    request: newsletterRequest({ action: 'send_now', id: newsletter.id }),
    env: newsletterEnv({ async send() {} }),
  });
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: 'newsletter_delivery_source_lookup_failed', retryable: true });
  assert.equal(calls.some((call) => call.path.includes('/rpc/materialize_')), false);
  assert.ok(calls.some((call) => call.path.endsWith('/rest/v1/newsletters') && call.body?.status === 'failed'));
});

test('newsletters route: fenced parent update loss is retryable and does not wake queue', async () => {
  const newsletter = { id: 'newsletter-lost-fence', status: 'draft', subject: 'Fence', body_md: 'Hello' };
  const queued = [];
  const calls = installNewsletterRouteFetch({ newsletter, parentSaveLost: true });
  const res = await newslettersRoute({
    request: newsletterRequest({ action: 'send_now', id: newsletter.id }),
    env: newsletterEnv({ async send(body) { queued.push(body); } }),
  });
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: 'newsletter_preparation_lease_lost', retryable: true });
  assert.equal(queued.length, 0);
  assert.ok(calls.some((call) => call.path.endsWith('/rpc/materialize_newsletter_deliveries_fenced')));
});

function installBlogRouteFetch({ posts, ledger, queue }) {
  const calls = [];
  let leaseToken = null;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || 'GET').toUpperCase();
    const path = url.pathname;
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, path, search: url.search, body });
    if (path.includes('/rest/v1/newsletter_settings')) return Response.json([{ auto_send_latest_blog: true }]);
    if (path.includes('/rest/v1/content_entries')) return Response.json(posts);
    if (path.includes('/rest/v1/blog_newsletter_sends')) {
      if (method === 'GET') return Response.json(ledger);
      if (method === 'POST') {
        leaseToken = body.preparation_lease_token;
        return new Response(null, { status: 201 });
      }
      return Response.json([{ slug: body.slug || 'new-post' }]);
    }
    if (path.includes('/rest/v1/newsletter_recipients')) return Response.json([{ email: 'buyer@example.test' }]);
    if (path.includes('/rest/v1/rpc/materialize_blog_newsletter_deliveries_fenced')) return Response.json([{ created: true, total_count: 1 }]);
    if (path.includes('/rest/v1/automation_runs')) return new Response(null, { status: 201 });
    if (path.endsWith('/auth/v1/user')) return Response.json({ id: 'cron', email: 'cron@example.test' });
    if (method === 'PATCH' && path.includes('/rest/v1/blog_newsletter_sends')) return Response.json([{ slug: 'new-post' }]);
    throw new Error(`Unexpected blog route fetch: ${method} ${url}`);
  };
  return { calls, get leaseToken() { return leaseToken; }, queue };
}

test('blog newsletter route: active leases are filtered before the five-post cap', async () => {
  const active = Array.from({ length: 5 }, (_, index) => ({
    slug: `active-${index}`, provider_status: 'queueing', preparation_lease_expires_at: '2099-01-01T00:00:00.000Z',
  }));
  const posts = [...active.map((row) => ({ slug: row.slug, title: row.slug, payload: { excerpt: 'Active' }, published_at: '2020-01-01T00:00:00.000Z' })), {
    slug: 'new-post', title: 'New post', payload: { excerpt: 'Fresh' }, published_at: '2020-01-02T00:00:00.000Z',
  }];
  const queued = [];
  const routeStub = installBlogRouteFetch({ posts, ledger: active, queue: queued });
  const res = await blogNewsletterRoute({
    request: {
      method: 'POST',
      url: 'https://masest.co/api/admin/blog-newsletter',
      headers: { get: (name) => String(name).toLowerCase() === 'x-blog-newsletter-secret' ? 'blog-secret' : null },
      json: async () => ({ action: 'sweep' }),
    },
    env: {
      SUPABASE_URL: 'https://supabase.test', SUPABASE_ANON_KEY: 'anon-key', SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      BLOG_NEWSLETTER_SECRET: 'blog-secret', MARKETING_EMAIL_QUEUE: { async send(body) { queued.push(body); } },
    },
  });
  assert.equal(res.status, 202);
  const payload = await res.json();
  assert.deepEqual(payload.queued.map((item) => item.slug), ['new-post']);
  const claim = routeStub.calls.find((call) => call.method === 'POST' && call.path.endsWith('/rest/v1/blog_newsletter_sends'));
  assert.equal(claim.body.slug, 'new-post');
  assert.equal(routeStub.calls.filter((call) => call.path.includes('/rpc/materialize_blog_newsletter_deliveries_fenced')).length, 1);
  assert.deepEqual(queued, [{ version: 1, kind: 'marketing_delivery.drain', sourceType: 'blog_post' }]);
});
