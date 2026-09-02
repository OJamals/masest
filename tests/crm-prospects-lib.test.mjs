import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isMissingProspectSchema,
  PROSPECT_PRIORITIES,
  PROSPECT_STATUSES,
  prospectListParams,
  prospectPatch,
} from '../functions/_lib/crm-prospects.js';

test('prospect list query is bounded and allow-listed', () => {
  assert.deepEqual(PROSPECT_STATUSES, ['new', 'researching', 'qualified', 'converted', 'archived']);
  assert.deepEqual(PROSPECT_PRIORITIES, ['unassigned', 'low', 'normal', 'high']);
  assert.deepEqual(
    prospectListParams(new URL('https://example.test/api?q=%20Acme%20&status=qualified&priority=high&limit=999&offset=4').searchParams),
    { q: 'Acme', status: 'qualified', priority: 'high', limit: 50, offset: 4 },
  );
  assert.deepEqual(prospectListParams(new URL('https://example.test/api?status=bad').searchParams), { error: 'invalid_status' });
  assert.deepEqual(prospectListParams(new URL('https://example.test/api?priority=bad').searchParams), { error: 'invalid_priority' });
  assert.deepEqual(prospectListParams(new URL('https://example.test/api?q=A').searchParams), { error: 'query_too_short' });
});

test('prospect patch accepts workflow fields but never consent shortcuts', () => {
  const now = new Date('2026-09-02T12:00:00.000Z');
  const result = prospectPatch({ status: 'qualified', priority: 'high' }, {
    status: 'new',
    linked_company_id: null,
  }, now);
  assert.deepEqual(result, {
    patch: { status: 'qualified', priority: 'high', updated_at: now.toISOString() },
  });
  assert.equal('marketing_consent' in result.patch, false);
  assert.equal('outreach_status' in result.patch, false);
  assert.deepEqual(
    prospectPatch({ status: 'qualified', marketing_consent: 'opted_in' }, {}, now),
    { error: 'unsupported_field' },
  );
});

test('conversion requires an explicit Company link', () => {
  assert.deepEqual(
    prospectPatch({ status: 'converted' }, { status: 'qualified', linked_company_id: null }, new Date()),
    { error: 'linked_company_required' },
  );
  const linked = prospectPatch(
    { status: 'converted', linked_company_id: '86b5e767-8b8f-42fd-8fcb-8f6c0f176b15' },
    { status: 'qualified', linked_company_id: null },
    new Date('2026-09-02T12:00:00.000Z'),
  );
  assert.equal(linked.patch.status, 'converted');
  assert.equal(linked.patch.linked_company_id, '86b5e767-8b8f-42fd-8fcb-8f6c0f176b15');
});

test('patch rejects invalid workflow values and empty updates', () => {
  assert.deepEqual(prospectPatch({ status: 'won' }, {}, new Date()), { error: 'invalid_status' });
  assert.deepEqual(prospectPatch({ priority: 'urgent' }, {}, new Date()), { error: 'invalid_priority' });
  assert.deepEqual(prospectPatch({ linked_company_id: 'not-a-uuid' }, {}, new Date()), { error: 'invalid_company_id' });
  assert.deepEqual(prospectPatch({ retention_review_at: '2026-02-31' }, {}, new Date()), { error: 'invalid_retention_date' });
  assert.deepEqual(prospectPatch({ marketing_consent: 'opted_in' }, {}, new Date()), { error: 'unsupported_field' });
});

test('missing-schema detection covers every Prospect table without swallowing unrelated DB errors', () => {
  assert.equal(isMissingProspectSchema({
    message: 'relation "public.prospect_source_records" does not exist',
  }), true);
  assert.equal(isMissingProspectSchema({
    message: "Could not find the table 'public.prospect_import_batches' in the schema cache",
  }), true);
  assert.equal(isMissingProspectSchema({
    message: 'update violates foreign key relation for companies',
  }), false);
});
