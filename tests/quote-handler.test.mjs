import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createQuoteHandler } from '../functions/api/quote.js';

const SUBMISSION_ID = '11111111-1111-4111-8111-111111111111';
const QUOTE_ID = '22222222-2222-4222-8222-222222222222';

function request(overrides = {}) {
  return new Request('https://masest.test/api/quote', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.15' },
    body: JSON.stringify({
      submission_id: SUBMISSION_ID,
      name: 'Buyer',
      email: 'buyer@example.com',
      company: 'Buyer Co',
      product: 'VertKleen HCR',
      ...overrides,
    }),
  });
}

function baseDependencies(overrides = {}) {
  return {
    rateLimit: async () => ({ ok: true }),
    verifyTurnstile: async () => ({ status: 'unconfigured' }),
    adminClient: () => ({}),
    saveIntake: async () => ({ quoteId: QUOTE_ID, duplicate: false }),
    sendEmail: async () => ({ ok: true }),
    subscribeLeadByIndustry: async () => ({ ok: true }),
    ...overrides,
  };
}

async function json(response) {
  return { status: response.status, body: await response.json() };
}

test('public intake acknowledges only a durable record and passes a stable identity fingerprint', async () => {
  let saved;
  const response = await createQuoteHandler(baseDependencies({
    saveIntake: async (_sb, input) => {
      saved = input;
      return { quoteId: QUOTE_ID, duplicate: false };
    },
  }))({ request: request(), env: {} });

  const result = await json(response);
  assert.equal(result.status, 201);
  assert.deepEqual(result.body, {
    ok: true,
    durable: true,
    quote_id: QUOTE_ID,
    duplicate: false,
    lead_score: 38,
  });
  assert.equal(saved.intakeId, SUBMISSION_ID);
  assert.match(saved.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(saved.row.payload.submission_id, undefined);
});

test('CAPTCHA transport rotation cannot change retry identity or lead scoring', async () => {
  const saves = [];
  const handler = createQuoteHandler(baseDependencies({
    saveIntake: async (_sb, input) => {
      saves.push(input);
      return { quoteId: QUOTE_ID, duplicate: saves.length > 1 };
    },
  }));
  const first = await json(await handler({
    request: request({ 'cf-turnstile-response': 'urgent-program-token' }),
    env: {},
  }));
  const second = await json(await handler({
    request: request({ 'cf-turnstile-response': 'rotated-token' }),
    env: {},
  }));

  assert.equal(first.body.lead_score, second.body.lead_score);
  assert.equal(saves[0].fingerprint, saves[1].fingerprint);
});

test('indeterminate persistence is retryable and never sends follow-up side effects', async () => {
  let followUps = 0;
  const response = await createQuoteHandler(baseDependencies({
    saveIntake: async () => ({ error: 'intake_unavailable' }),
    sendEmail: async () => { followUps += 1; },
    subscribeLeadByIndustry: async () => { followUps += 1; },
  }))({ request: request(), env: {} });

  assert.deepEqual(await json(response), {
    status: 503,
    body: { error: 'intake_unavailable', retryable: true },
  });
  assert.equal(followUps, 0);
});

test('an intake identity collision is explicit and does not emit delivery work', async () => {
  let followUps = 0;
  const response = await createQuoteHandler(baseDependencies({
    saveIntake: async () => ({ error: 'idempotency_conflict' }),
    sendEmail: async () => { followUps += 1; },
  }))({ request: request(), env: {} });

  assert.deepEqual(await json(response), {
    status: 409,
    body: { error: 'idempotency_conflict' },
  });
  assert.equal(followUps, 0);
});

test('a lost acknowledgement retries idempotently without duplicating intake emails', async () => {
  let followUps = 0;
  const response = await createQuoteHandler(baseDependencies({
    saveIntake: async () => ({ quoteId: QUOTE_ID, duplicate: true }),
    sendEmail: async () => { followUps += 1; },
    subscribeLeadByIndustry: async () => { followUps += 1; },
  }))({ request: request(), env: {} });

  const result = await json(response);
  assert.equal(result.status, 200);
  assert.equal(result.body.durable, true);
  assert.equal(result.body.duplicate, true);
  assert.equal(followUps, 0);
});

test('post-commit email or nurture failure cannot erase the durable acknowledgement', async () => {
  const response = await createQuoteHandler(baseDependencies({
    sendEmail: async () => { throw new Error('mailer unavailable'); },
    subscribeLeadByIndustry: async () => { throw new Error('nurture unavailable'); },
  }))({ request: request(), env: {} });

  const result = await json(response);
  assert.equal(result.status, 201);
  assert.equal(result.body.durable, true);
  assert.equal(result.body.quote_id, QUOTE_ID);
});

test('the browser requires the durable acknowledgement before showing success', () => {
  const source = readFileSync(new URL('../js/main/engagement.js', import.meta.url), 'utf8');
  assert.match(source, /acknowledgement\?\.ok !== true/);
  assert.match(source, /acknowledgement\?\.durable !== true/);
  assert.match(source, /!acknowledgement\?\.quote_id/);
  assert.match(source, /data\.set\("submission_id", form\.dataset\.submissionId\)/);
});
