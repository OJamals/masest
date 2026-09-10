import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildOutreachDraft,
  buildOutreachTransition,
} from '../functions/_lib/crm-prospect-outreach.js';

const now = new Date('2026-09-09T12:00:00.000Z');

test('outreach draft validation keeps one-to-one email bounded and source-grounded', () => {
  const result = buildOutreachDraft({
    organization_id: '6fd360e3-2475-48c9-a8f1-f2e180f3f6f1',
    contact_id: '2153285c-f929-4189-a4f9-2afc3a5de58f',
    recipient_email: ' Buyer@Example.Test ',
    subject: '  Facility cleaning question  ',
    body_text: '  Hi Ada,\n\nCould we compare cleaning needs?  ',
    compliance_basis: 'Public business contact; relevant facilities role.',
    source_url: 'https://example.test/team',
  }, 'staff-1');
  assert.deepEqual(result.draft, {
    organization_id: '6fd360e3-2475-48c9-a8f1-f2e180f3f6f1',
    contact_id: '2153285c-f929-4189-a4f9-2afc3a5de58f',
    recipient_email: 'buyer@example.test',
    subject: 'Facility cleaning question',
    body_text: 'Hi Ada,\n\nCould we compare cleaning needs?',
    compliance_basis: 'Public business contact; relevant facilities role.',
    source_url: 'https://example.test/team',
    status: 'draft',
    created_by: 'staff-1',
  });
});

test('outreach draft rejects unsupported fields and unsafe URLs', () => {
  assert.equal(buildOutreachDraft({ recipient_email: 'a@example.test', surprise: true }).error, 'unsupported_field');
  assert.equal(buildOutreachDraft({
    organization_id: '6fd360e3-2475-48c9-a8f1-f2e180f3f6f1',
    recipient_email: 'a@example.test', subject: 'Hello', body_text: 'Message',
    compliance_basis: 'Relevant public business role.', source_url: 'javascript:alert(1)',
  }, 'staff-1').error, 'invalid_source_url');
});

test('outreach transitions require approval evidence and preserve explicit state', () => {
  const draft = { status: 'draft', compliance_basis: '', source_url: '' };
  assert.equal(buildOutreachTransition({ action: 'approve' }, draft, 'staff-1', now).error, 'approval_evidence_required');

  const approved = buildOutreachTransition({ action: 'approve' }, {
    status: 'draft', compliance_basis: 'Public company page and relevant facilities role.', source_url: 'https://example.test/team',
  }, 'staff-1', now);
  assert.deepEqual(approved.patch, {
    status: 'approved', approved_by: 'staff-1', approved_at: now.toISOString(), updated_at: now.toISOString(),
  });
  assert.equal(buildOutreachTransition({ action: 'replied' }, { status: 'approved' }, 'staff-1', now).error, 'invalid_transition');
  assert.equal(buildOutreachTransition({ action: 'sent' }, { status: 'approved' }, 'staff-1', now).patch.sent_at, now.toISOString());
  assert.equal(buildOutreachTransition({ action: 'opted_out' }, { status: 'sent' }, 'staff-1', now).patch.status, 'opted_out');
});
