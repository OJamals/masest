import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderNewsletterBody, renderNewsletterEmail, resolveAudience, nextRunAt, dueNewsletters,
} from '../functions/_lib/newsletter.js';
import { unsentPosts } from '../functions/_lib/blog-newsletter.js';
import { loadMarketingAudience } from '../functions/_lib/marketing-subscribers.js';
import { allUserEmails, sendEmailResult } from '../functions/_lib/supabase.js';
import { materializeDeliverySource } from '../functions/_lib/newsletter-delivery.js';

test('renderNewsletterBody: markdown constructs', () => {
  const html = renderNewsletterBody([
    '# Heading',
    '',
    '**bold** *emphasis* ++underline++ `code <tag>`',
    '',
    '[[size:18|Large & safe]] [[color:#0e7c86|Teal]]',
    '',
    '- one',
    '- two',
    '',
    '1. first',
    '2. second',
    '',
    '> quoted',
    '',
    '---',
  ].join('\n'));

  assert.match(html, /<h1[^>]*>Heading<\/h1>/);
  assert.match(html, /<strong>bold<\/strong> <em>emphasis<\/em> <u>underline<\/u>/);
  assert.match(html, /<code>code &lt;tag&gt;<\/code>/);
  assert.match(html, /<span style="font-size:18px">Large &amp; safe<\/span>/);
  assert.match(html, /<span style="color:#0e7c86">Teal<\/span>/);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
  assert.match(html, /<blockquote[^>]*>quoted<\/blockquote>/);
  assert.match(html, /<hr>/);
});

test('renderNewsletterBody: escapes raw HTML and attribute-boundary attacks', () => {
  const html = renderNewsletterBody([
    '<script>alert(1)</script><iframe src="https://evil.test"></iframe>',
    '<object data="/x"></object><svg onload="alert(1)"></svg>',
    '<img src=x onerror="alert(1)" style="background:url(javascript:alert(1))">',
  ].join('\n'));

  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<(?:script|iframe|object|svg|img)\b/i);
  assert.doesNotMatch(html, /style="background/i);
  assert.doesNotMatch(html, /<[^>]+\son[a-z]+\s*=/i);
});

test('renderNewsletterBody: supports controlled links, images, and cards', () => {
  const html = renderNewsletterBody([
    '[external](https://example.test/a?x=1&y=2) [http](http://example.test/a) [root](/products/cr-hd) [mail](mailto:sales@masest.co) [call](tel:+13135550100)',
    '',
    '![Remote & clean](http://cdn.example.test/image.png)',
    '',
    '![Local](/images/product.png)',
    '',
    '[[card:title=CR-HD & More|href=https://masest.co/products/cr-hd|image=/images/cr-hd.png|alt=CR-HD <drum>]]',
  ].join('\n'));

  assert.match(html, /href="https:\/\/example\.test\/a\?x=1&amp;y=2" rel="noopener noreferrer"/);
  assert.match(html, /href="http:\/\/example\.test\/a" rel="noopener noreferrer"/);
  assert.match(html, /href="\/products\/cr-hd">root<\/a>/);
  assert.match(html, /href="mailto:sales@masest\.co">mail<\/a>/);
  assert.match(html, /href="tel:\+13135550100">call<\/a>/);
  assert.match(html, /src="http:\/\/cdn\.example\.test\/image\.png" alt="Remote &amp; clean"/);
  assert.match(html, /src="\/images\/product\.png" alt="Local"/);
  assert.match(html, /class="md-card" href="https:\/\/masest\.co\/products\/cr-hd" rel="noopener noreferrer"/);
  assert.match(html, /data-md-title="CR-HD &amp; More"/);
  assert.match(html, /data-md-alt="CR-HD &lt;drum&gt;"/);
});

test('renderNewsletterBody: rejects unsafe, malformed, and quote-breaking URLs', () => {
  const payloads = [
    '[x](javascript:alert)',
    '[x](data:text/html,alert)',
    '[x](//evil.test/path)',
    '[x](javascript&#58;alert)',
    '[x](https://example.test/"onmouseover="alert)',
    '[x](https://[::1)',
    '[x](https://example.test/%ZZ)',
    '[x](https://example.test/%0aevil)',
    `[x](https://example.test/\uD800)`,
    `[x](java\tscript:alert)`,
    `[x](https://example.test/\u0000evil)`,
    '[x](relative/path)',
    '[x](mailto:)',
    '[x](mailto://)',
    '[x](tel:)',
    '![x](javascript:alert)',
    '![x](data:image/svg+xml,evil)',
    '![x](mailto:sales@masest.co)',
    '![x](//evil.test/x.png)',
    '![x" onerror="alert](/safe.png)',
    '[[card:title=x|href=javascript:alert|image=/safe.png]]',
    '[[card:title=x|href=/safe|image=data:image/svg+xml,evil]]',
    '[[card:title=x|href=/safe|style=color:red]]',
  ];

  for (const payload of payloads) {
    const html = renderNewsletterBody(payload);
    if (payload.includes('href=/safe|image=data:')) {
      assert.deepEqual([...html.matchAll(/\b(?:href|src)="([^"]*)"/g)].map((match) => match[1]), ['/safe'], payload);
      assert.match(html, /class="md-card" href="\/safe"/);
      assert.match(html, /data-md-image=""/);
      assert.match(html, /background:#eef5f6/);
      assert.doesNotMatch(html, /data:image|<img\b/i);
    } else if (payload.includes('onerror') && payload.includes('/safe.png')) {
      assert.match(html, /<img src="\/safe\.png" alt="x&quot; onerror=&quot;alert"/);
      assert.doesNotMatch(html, /"\s+onerror=/i);
    } else {
      assert.deepEqual([...html.matchAll(/\b(?:href|src)="([^"]*)"/g)].map((match) => match[1]), [], payload);
      assert.doesNotMatch(html, /<a\b|<img\b/, payload);
    }
  }
});

test('renderNewsletterBody: handles empty, malformed, Unicode, and ampersands', () => {
  assert.equal(renderNewsletterBody(), '');
  assert.equal(renderNewsletterBody(null), '');
  assert.equal(renderNewsletterBody('\r\n\r\n'), '');
  assert.match(renderNewsletterBody('Crème 😀 & <raw>'), /Crème 😀 &amp; &lt;raw&gt;/);
  assert.doesNotMatch(renderNewsletterBody('[[size:99|huge]] [[color:red|red]]'), /<span\b/);
});

test('renderNewsletterEmail: subject + branded shell uses identical safe body output', () => {
  const body = 'Hello **world** <script>alert(1)</script> [read](/products)';
  const renderedBody = renderNewsletterBody(body);
  const { subject, html, text } = renderNewsletterEmail({ subject: 'Field Notes', body_md: body });
  assert.equal(subject, 'Field Notes');
  assert.match(html, /Field Notes/);
  assert.ok(html.includes(renderedBody));
  assert.doesNotMatch(html, /<script\b/i);
  assert.match(html, /MASEST/);
  assert.match(html, /\{\{web_view_url\}\}/);
  assert.match(html, /\{\{unsubscribe_url\}\}/);
  assert.match(html, /1361 Grand Cayman Dr/);
  assert.match(text, /Hello world/);
});

test('resolveAudience: union of selected populations, deduped + lowercased', () => {
  const out = resolveAudience({
    populations: ['users', 'imported'],
    users: ['A@x.com', 'b@x.com'],
    leads: ['lead@x.com'],       // not selected -> excluded
    imported: ['b@x.com', 'c@x.com'],
  });
  assert.deepEqual(out, ['a@x.com', 'b@x.com', 'c@x.com']);
});

test('resolveAudience: drops suppressed + invalid emails', () => {
  const out = resolveAudience({
    populations: ['users'],
    users: ['keep@x.com', 'DROP@x.com', 'notanemail'],
    suppressed: ['drop@x.com'],
  });
  assert.deepEqual(out, ['keep@x.com']);
});

test('nextRunAt: recurring adds interval; once -> null', () => {
  const base = Date.parse('2026-01-01T00:00:00Z');
  assert.equal(nextRunAt({ mode: 'recurring', interval_days: 14 }, base), '2026-01-15T00:00:00.000Z');
  assert.equal(nextRunAt({ mode: 'once', send_at: 'x' }, base), null);
});

test('dueNewsletters: scheduled + next_run_at in the past', () => {
  const now = Date.parse('2026-06-01T00:00:00Z');
  const rows = [
    { id: 1, status: 'scheduled', schedule: { next_run_at: '2026-05-01T00:00:00Z' } },
    { id: 2, status: 'scheduled', schedule: { next_run_at: '2026-07-01T00:00:00Z' } },
    { id: 3, status: 'draft', schedule: { next_run_at: '2026-05-01T00:00:00Z' } },
    { id: 4, status: 'scheduled', schedule: { send_at: '2026-05-15T00:00:00Z' } },
  ];
  assert.deepEqual(dueNewsletters(rows, now).map((n) => n.id), [1, 4]);
});

test('unsentPosts: failed preparation is retryable while active and completed ledger rows stay excluded', () => {
  const posts = [{ slug: 'failed' }, { slug: 'active' }, { slug: 'sent' }, { slug: 'legacy' }];
  assert.deepEqual(
    unsentPosts(posts, [
      { slug: 'failed', provider_status: 'failed_to_queue' },
      { slug: 'active', provider_status: 'queueing', preparation_lease_expires_at: '2099-01-01T00:00:00Z' },
      { slug: 'sent', provider_status: 'complete' },
      { slug: 'legacy' },
    ]).map((post) => post.slug),
    ['failed'],
  );
});

test('sendEmailResult routes marketing through the durable queue only', async () => {
  let calls = 0;
  const result = await sendEmailResult({}, {
    to: ['person@example.test'],
    subject: 'Subject',
    html: '<p>Body</p><a href="{{unsubscribe_url}}">Unsubscribe</a>',
    category: 'newsletter',
    idempotencyKey: 'newsletter:campaign-1:person@example.test',
    suppressionLoader: async () => new Map(),
    fetchImpl: async () => { calls += 1; return Response.json({ ok: true }); },
  });
  assert.equal(calls, 0);
  assert.deepEqual(result, {
    ok: false,
    retryable: false,
    error: 'marketing_queue_required',
  });
});

test('materializeDeliverySource fences campaigns and omits lease fields for legacy sources', async () => {
  const calls = [];
  const sb = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: [{ created: true, total_count: 1 }], error: null };
    },
  };
  const leaseToken = '11111111-1111-4111-8111-111111111111';

  const campaign = await materializeDeliverySource(sb, {
    sourceType: 'newsletter',
    sourceId: 'campaign:occurrence',
    parentId: 'campaign-id',
    subject: 'Briefing',
    html: '<p>Hello</p>',
    category: 'newsletter',
    emails: ['buyer@example.test'],
    leaseToken,
  });
  assert.deepEqual(campaign, { created: true, total: 1, error: null });
  assert.equal(calls[0].name, 'materialize_newsletter_deliveries_fenced');
  assert.equal(calls[0].args.p_lease_token, leaseToken);

  const legacy = await materializeDeliverySource(sb, {
    sourceType: 'order',
    sourceId: 'order-1',
    parentId: 'order-1',
    subject: 'Order update',
    html: '<p>Ready</p>',
    category: 'order',
    emails: ['buyer@example.test'],
    leaseToken: 'unexpected-non-uuid-token',
  });
  assert.deepEqual(legacy, { created: true, total: 1, error: null });
  assert.equal(calls[1].name, 'materialize_newsletter_deliveries');
  assert.equal(Object.hasOwn(calls[1].args, 'p_lease_token'), false);

  const rejected = await materializeDeliverySource(sb, {
    sourceType: 'blog_post',
    sourceId: 'post-1',
    subject: 'Post',
    html: '<p>Post</p>',
    category: 'newsletter',
    leaseToken: '11111111-1111-1111-1111-111111111111',
  });
  assert.equal(rejected.error?.message, 'campaign_preparation_lease_required');
  assert.equal(calls.length, 2);
});

test('strict audience reads distinguish source failure from an empty audience', async () => {
  const audienceDb = (result) => ({
    from: () => ({
      select: () => ({
        eq: () => ({ range: async () => result }),
      }),
    }),
  });
  await assert.rejects(
    loadMarketingAudience(audienceDb({ data: null, error: new Error('db_down') })),
    /marketing_audience_unavailable/,
  );
  assert.deepEqual(
    await loadMarketingAudience(audienceDb({ data: [], error: null })),
    [],
  );

  const failingDirectory = {
    auth: { admin: { listUsers: async () => { throw new Error('directory_down'); } } },
  };
  await assert.rejects(
    allUserEmails(failingDirectory, { strict: true }),
    /directory_down/,
  );
  const rejectedDirectory = {
    auth: {
      admin: {
        listUsers: async () => ({ data: null, error: new Error('directory_rejected') }),
      },
    },
  };
  await assert.rejects(
    allUserEmails(rejectedDirectory, { strict: true }),
    /directory_rejected/,
  );
});
