import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmailViewHandler } from '../functions/api/email/view.js';
import { emailViewToken } from '../functions/_lib/email.js';

const env = { EMAIL_UNSUB_SECRET: 'view-secret' };

async function requestFor(overrides = {}) {
  const values = {
    email: 'reader@example.com',
    source_type: 'newsletter',
    source_id: 'campaign-1',
    ...overrides,
  };
  const token = overrides.token ?? await emailViewToken(
    values.email, values.source_type, values.source_id, env.EMAIL_UNSUB_SECRET,
  );
  const params = new URLSearchParams({ ...values, token });
  return new Request(`https://masest.co/api/email/view?${params}`);
}

test('email view rejects invalid token before loading content', async () => {
  let reads = 0;
  const handler = createEmailViewHandler({
    getSource: async () => { reads += 1; return { source: null, error: null }; },
  });
  const response = await handler({ request: await requestFor({ token: 'bad' }), env });
  assert.equal(response.status, 400);
  assert.equal(reads, 0);
});

test('email view serves personalized source HTML with no-store and CSP', async () => {
  const handler = createEmailViewHandler({
    getSource: async (_env, sourceType, sourceId) => ({
      source: {
        source_type: sourceType,
        source_id: sourceId,
        html: '<a href="{{unsubscribe_url}}">Unsubscribe</a><!--WEB_VIEW_START--><a href="{{web_view_url}}">Online</a><!--WEB_VIEW_END-->',
      },
      error: null,
    }),
  });
  const response = await handler({ request: await requestFor(), env });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const html = await response.text();
  assert.match(html, /reader%40example\.com/);
  assert.match(html, /\/api\/email\/view\?/);
  assert.doesNotMatch(html, /\{\{|WEB_VIEW/);
});

test('email view distinguishes unavailable and missing sources', async () => {
  const unavailable = createEmailViewHandler({
    getSource: async () => ({ source: null, error: new Error('down') }),
  });
  assert.equal((await unavailable({ request: await requestFor(), env })).status, 503);
  const missing = createEmailViewHandler({
    getSource: async () => ({ source: null, error: null }),
  });
  assert.equal((await missing({ request: await requestFor(), env })).status, 404);
});
