import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { applyQuoteFilters, quoteFilters } from '../functions/api/admin/quotes.js';
import { createQuoteLeadLifecycle } from '../functions/_lib/quote-leads.js';

const NOW = new Date('2026-08-17T12:00:00.000Z');

function params(values) {
  return new URLSearchParams(values);
}

test('admin status, priority, owner, due, and search filters are validated centrally', () => {
  assert.deepEqual(quoteFilters(params({
    status: 'contacted',
    priority: 'urgent',
    owner: ' Ada ',
    due: 'overdue',
    search: ' Boiler,(west) ',
  }), NOW), {
    status: 'contacted',
    priority: 'urgent',
    owner: 'Ada',
    due: 'overdue',
    search: 'Boiler  west',
    now: NOW.toISOString(),
  });
  assert.deepEqual(quoteFilters(params({ status: 'deleted' }), NOW), { error: 'invalid_status_filter' });
  assert.deepEqual(quoteFilters(params({ priority: 'critical' }), NOW), { error: 'invalid_priority_filter' });
  assert.deepEqual(quoteFilters(params({ due: 'yesterday' }), NOW), { error: 'invalid_due_filter' });
});

class MemoryQuery {
  constructor(rows) {
    this.current = rows;
    this.calls = [];
  }

  keep(name, predicate, ...args) {
    this.calls.push([name, ...args]);
    this.current = this.current.filter(predicate);
    return this;
  }

  eq(column, value) { return this.keep('eq', (row) => row[column] === value, column, value); }
  ilike(column, pattern) {
    const needle = pattern.slice(1, -1).replace(/\\([%_\\])/g, '$1').toLowerCase();
    return this.keep('ilike', (row) => String(row[column] || '').toLowerCase().includes(needle), column, pattern);
  }
  not(column, operator, values) {
    const rejected = values.slice(1, -1).split(',');
    return this.keep('not', (row) => operator !== 'in' || !rejected.includes(row[column]), column, operator, values);
  }
  lte(column, value) { return this.keep('lte', (row) => row[column] && row[column] <= value, column, value); }
  gt(column, value) { return this.keep('gt', (row) => row[column] && row[column] > value, column, value); }
  is(column, value) { return this.keep('is', (row) => row[column] === value, column, value); }
  or(expression) {
    const match = expression.match(/\.ilike\.%(.*?)%(?:,|$)/);
    const needle = String(match?.[1] || '').replace(/\\([%_\\])/g, '$1').toLowerCase();
    const columns = expression.split(',').map((part) => part.split('.')[0]);
    return this.keep('or', (row) => columns.some((column) => String(row[column] || '').toLowerCase().includes(needle)), expression);
  }
  range(offset, end) { this.calls.push(['range', offset, end]); return this.current.slice(offset, end + 1); }
}

test('server filters run before range, so a match formerly on page two is not lost', () => {
  const rows = Array.from({ length: 140 }, (_, index) => ({
    id: `quote-${index}`,
    status: 'new',
    priority: 'normal',
    assigned_to: 'Other',
    due_at: null,
    company: `Company ${index}`,
  }));
  rows[120] = {
    id: 'page-two-target',
    status: 'contacted',
    priority: 'urgent',
    assigned_to: 'Ada Lovelace',
    due_at: '2026-08-18T12:00:00.000Z',
    company: 'Target Boiler West',
  };
  const query = new MemoryQuery(rows);
  const filters = quoteFilters(params({
    status: 'contacted',
    priority: 'urgent',
    owner: 'Ada',
    due: 'upcoming',
    search: 'Target Boiler',
  }), NOW);

  const page = applyQuoteFilters(query, filters).range(0, 99);
  assert.deepEqual(page.map(({ id }) => id), ['page-two-target']);
  assert.equal(query.calls.at(-1)[0], 'range');
  assert.deepEqual(query.calls.slice(0, 5).map(([name]) => name), ['eq', 'eq', 'ilike', 'not', 'gt']);
  assert.equal(query.calls[5][0], 'or');
});

test('list, Board summary, count, and export share the same server-filter seam', () => {
  const source = readFileSync(new URL('../functions/api/admin/quotes.js', import.meta.url), 'utf8');
  assert.match(source, /const pipelineQuery = applyQuoteFilters/);
  assert.match(source, /const exportQuery = applyQuoteFilters/);
  assert.match(source, /let listQuery = applyQuoteFilters/);
  assert.match(source, /const newCount = await applyQuoteFilters/);
  assert.match(source, /const urgentCount = await applyQuoteFilters/);
  assert.ok(source.indexOf('let listQuery = applyQuoteFilters') < source.indexOf('.range(offset, offset + limit - 1)'));
});

test('Platform staff terminal moves reject a live offer and CAS against a concurrent send', async () => {
  let writes = 0;
  const live = {
    id: 'quote-1',
    source: 'requisition',
    status: 'contacted',
    pipeline_stage: 'proposal',
    payload: { offer_status: 'sent', offer_expires_at: '2026-08-18T12:00:00.000Z' },
  };
  const liveLifecycle = createQuoteLeadLifecycle({
    now: () => NOW,
    store: {
      lifecycleQuote: async () => live,
      updateQuoteIfCurrent: async () => { writes += 1; return live; },
    },
  });
  assert.deepEqual(await liveLifecycle.update({ id: 'quote-1', changes: { status: 'closed' } }), {
    ok: false,
    error: 'live_offer_requires_resolution',
    status: 409,
  });
  assert.equal(writes, 0);

  const inactive = {
    ...live,
    status: 'closed',
    pipeline_stage: 'lost',
    payload: { ...live.payload, offer_status: 'declined' },
  };
  const racedLifecycle = createQuoteLeadLifecycle({
    now: () => NOW,
    store: {
      lifecycleQuote: async () => inactive,
      currentStage: async () => 'lost',
      updateQuoteIfCurrent: async () => null,
    },
  });
  assert.deepEqual(await racedLifecycle.update({
    id: 'quote-1',
    changes: { pipeline_stage: 'won' },
  }), { ok: false, error: 'quote_changed', status: 409 });
});
