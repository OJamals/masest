import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseImportEmails, onRequest as recipientsRoute } from '../functions/api/admin/recipients.js';
import {
  claimNewsletter,
  onRequest as newslettersRoute,
} from '../functions/api/admin/newsletters.js';
import { claimBlogNewsletter } from '../functions/api/admin/blog-newsletter.js';

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

  assert.deepEqual(await claimBlogNewsletter(sb, 'new-post'), { claimed: true, error: null });
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
  const start = source.indexOf("if (action === 'send_now')");
  const end = source.indexOf("return json(400, { error: 'bad_action' })", start);
  const sendNow = source.slice(start, end);
  assert.match(sendNow, /await claimNewsletter\(sb, body\.id/);
  assert.match(sendNow, /await queueNewsletter\(env, sb, claim\.newsletter\)/);
  assert.match(sendNow, /return json\(202,/);
  assert.match(source, /materializeDeliverySource/);
  assert.match(source, /runSupabaseDeliveryWorker/);
  assert.match(source, /loadMarketingAudience/);
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
  assert.match(source, /runSupabaseDeliveryWorker/);
  assert.match(source, /loadMarketingAudience/);
  assert.match(source, /provider: 'ses'/);
  assert.doesNotMatch(source, /klaviyo/i);
});
