import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderNewsletterBody, renderNewsletterEmail, resolveAudience, nextRunAt, dueNewsletters,
} from '../functions/_lib/newsletter.js';
import { klaviyoListProfiles } from '../functions/_lib/klaviyo.js';
import { allUserEmails, sendEmailResult } from '../functions/_lib/supabase.js';

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
  const { subject, html } = renderNewsletterEmail({ subject: 'Field Notes', body_md: body });
  assert.equal(subject, 'Field Notes');
  assert.match(html, /Field Notes/);
  assert.ok(html.includes(renderedBody));
  assert.doesNotMatch(html, /<script\b/i);
  assert.match(html, /MASEST/); // emailLayout shell
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

test('sendEmailResult exposes suppression and retryable Resend/network failures', async () => {
  const base = {
    to: ['person@example.test'],
    subject: 'Subject',
    html: '<p>Body</p>',
    category: 'newsletter',
    idempotencyKey: 'newsletter:campaign-1:person@example.test',
    suppressionLoader: async () => new Map(),
  };
  let idempotencyKey = null;
  const rateLimited = await sendEmailResult(
    { RESEND_API_KEY: 'test-key' },
    {
      ...base,
      fetchImpl: async (_url, init) => {
        idempotencyKey = init.headers['Idempotency-Key'];
        return Response.json({ message: 'rate limited' }, { status: 429 });
      },
    },
  );
  assert.equal(idempotencyKey, base.idempotencyKey);
  assert.equal(rateLimited.status, 429);
  assert.equal(rateLimited.retryable, true);

  const oversizedPrefix = `blog-newsletter:${'post-'.repeat(55)}`;
  const oversizedHeaders = [];
  for (const suffix of ['first@example.test', 'second@example.test', 'first@example.test']) {
    await sendEmailResult(
      { RESEND_API_KEY: 'test-key' },
      {
        ...base,
        idempotencyKey: `${oversizedPrefix}:${suffix}`,
        fetchImpl: async (_url, init) => {
          oversizedHeaders.push(init.headers['Idempotency-Key']);
          return Response.json({ id: 'email-id' });
        },
      },
    );
  }
  assert.ok(oversizedHeaders.every((key) => key.length <= 256));
  assert.notEqual(oversizedHeaders[0], oversizedHeaders[1]);
  assert.equal(oversizedHeaders[0], oversizedHeaders[2]);

  const network = await sendEmailResult(
    { RESEND_API_KEY: 'test-key' },
    { ...base, fetchImpl: async () => { throw new Error('network_down'); } },
  );
  assert.equal(network.network, true);
  assert.equal(network.retryable, true);

  const suppressed = await sendEmailResult(
    { RESEND_API_KEY: 'test-key' },
    {
      ...base,
      suppressionLoader: async () => new Map([
        ['person@example.test', new Set(['marketing'])],
      ]),
      fetchImpl: async () => {
        assert.fail('suppressed delivery must not call Resend');
      },
    },
  );
  assert.equal(suppressed.suppressed, true);
});

test('strict audience reads distinguish source failure from an empty audience', async () => {
  await assert.rejects(
    klaviyoListProfiles({}, 'list-1', { strict: true }),
    /klaviyo_profiles_not_configured/,
  );
  await assert.rejects(
    klaviyoListProfiles(
      { KLAVIYO_PRIVATE_KEY: 'test-key' },
      'list-1',
      { strict: true, fetchImpl: async () => { throw new Error('network_down'); } },
    ),
    /klaviyo_profiles_network_failure/,
  );
  assert.deepEqual(
    await klaviyoListProfiles(
      { KLAVIYO_PRIVATE_KEY: 'test-key' },
      'list-1',
      {
        strict: true,
        fetchImpl: async () => Response.json({ data: [], links: { next: null } }),
      },
    ),
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
