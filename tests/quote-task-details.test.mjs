import assert from 'node:assert/strict';
import test from 'node:test';

import { createQuoteHandler } from '../functions/api/quote.js';
import { QUOTE_TASK_DETAILS } from '../js/quote-task-details.js';

function quoteRequest(body) {
  return new Request('https://masest.test/api/quote', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.20' },
    body: JSON.stringify({
      name: 'Buyer',
      email: 'buyer@example.com',
      submission_id: '11111111-1111-4111-8111-111111111111',
      ...body,
    }),
  });
}

test('quote task economics and operating boundaries are normalized, persisted, and emailed safely', async () => {
  const inserts = [];
  const emails = [];
  const handler = createQuoteHandler({
    rateLimit: async () => ({ ok: true }),
    verifyTurnstile: async () => ({ status: 'unconfigured' }),
    adminClient: () => ({}),
    saveIntake: async (_sb, { row }) => {
      inserts.push(row);
      return { quoteId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', duplicate: false };
    },
    sendEmail: async (_env, message) => {
      emails.push(message);
      return { ok: true };
    },
    subscribeLeadByIndustry: async () => {},
  });

  const response = await handler({
    request: quoteRequest({
      type: 'audit',
      company: 'Facility Co',
      message: 'Scope one completed cleaning task.',
      current_chemical: '  Existing alkaline cleaner  ',
      current_dilution: '  1:20  ',
      labor_per_task: '  3 operators × 2 hours  ',
      water_per_task: '  450 gallons  ',
      downtime_per_task: '  6 hours  ',
      disposal_per_task: `  ${'d'.repeat(300)}  `,
      asset_life: '  Current seal replacement interval: 18 months  ',
      wastewater_route: '  On-site pretreatment, then permitted sanitary sewer  ',
      reopening_criteria: '  <img src=x onerror=alert(1)> Visual inspection and supervisor release  ',
      utm_source: 'industry-page',
    }),
    env: { SALES_EMAIL: 'sales@example.com' },
  });

  assert.equal(response.status, 201);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].payload.current_chemical, 'Existing alkaline cleaner');
  assert.equal(inserts[0].payload.current_dilution, '1:20');
  assert.equal(inserts[0].payload.labor_per_task, '3 operators × 2 hours');
  assert.equal(inserts[0].payload.water_per_task, '450 gallons');
  assert.equal(inserts[0].payload.downtime_per_task, '6 hours');
  assert.equal(inserts[0].payload.disposal_per_task.length, 240);
  assert.equal(
    inserts[0].payload.asset_life,
    'Current seal replacement interval: 18 months',
  );
  assert.equal(
    inserts[0].payload.wastewater_route,
    'On-site pretreatment, then permitted sanitary sewer',
  );
  assert.equal(
    inserts[0].payload.reopening_criteria,
    '<img src=x onerror=alert(1)> Visual inspection and supervisor release',
  );
  assert.equal(inserts[0].payload.utm_source, 'industry-page', 'existing attribution must survive');
  assert.equal(inserts[0].current_chemical, undefined, 'task details belong in the existing payload');

  assert.equal(emails.length, 2);
  const internalHtml = emails[0].html;
  for (const label of [
    'Current chemical',
    'Current dilution',
    'Labor per completed task',
    'Water per completed task',
    'Downtime per completed task',
    'Disposal per completed task',
    'Asset life context',
    'Wastewater route',
    'Reopening / return-to-service criteria',
  ]) {
    assert.match(internalHtml, new RegExp(label));
  }
  assert.doesNotMatch(internalHtml, /<img src=x/);
  assert.match(internalHtml, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('legacy quote payloads remain unchanged and blank task details are removed', async () => {
  let inserted;
  const handler = createQuoteHandler({
    rateLimit: async () => ({ ok: true }),
    verifyTurnstile: async () => ({ status: 'unconfigured' }),
    adminClient: () => ({}),
    saveIntake: async (_sb, { row }) => {
      inserted = row;
      return { quoteId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', duplicate: false };
    },
    sendEmail: async () => ({ ok: true }),
    subscribeLeadByIndustry: async () => {},
  });

  const response = await handler({
    request: quoteRequest({
      type: 'quote',
      product: 'VertKleen CR',
      industry: 'Data Centers',
      message: 'Existing request',
      current_chemical: '   ',
      wastewater_route: '',
    }),
    env: {},
  });

  assert.equal(response.status, 201);
  assert.equal(inserted.payload.product, 'VertKleen CR');
  assert.equal(inserted.payload.industry, 'Data Centers');
  assert.equal(inserted.payload.message, 'Existing request');
  assert.equal(Object.hasOwn(inserted.payload, 'current_chemical'), false);
  assert.equal(Object.hasOwn(inserted.payload, 'wastewater_route'), false);
});

test('every task-detail field is independently bounded at the API boundary', async () => {
  const limits = Object.fromEntries(
    QUOTE_TASK_DETAILS.map(({ name, limit }) => [name, limit]),
  );
  let inserted;
  const handler = createQuoteHandler({
    rateLimit: async () => ({ ok: true }),
    verifyTurnstile: async () => ({ status: 'unconfigured' }),
    adminClient: () => ({}),
    saveIntake: async (_sb, { row }) => {
      inserted = row;
      return { quoteId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', duplicate: false };
    },
    sendEmail: async () => ({ ok: true }),
    subscribeLeadByIndustry: async () => {},
  });
  const overlong = Object.fromEntries(
    Object.entries(limits).map(([key, limit]) => [key, key + 'x'.repeat(limit + 50)]),
  );

  const response = await handler({
    request: quoteRequest({ type: 'audit', message: 'Boundary test', ...overlong }),
    env: {},
  });

  assert.equal(response.status, 201);
  for (const [key, limit] of Object.entries(limits)) {
    assert.equal(inserted.payload[key].length, limit, `${key} limit`);
    assert.match(inserted.payload[key], new RegExp(`^${key}`), `${key} value`);
  }
});
