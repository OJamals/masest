import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../functions/api/admin/crm/outreach-drafts.js', import.meta.url), 'utf8');

test('outreach draft API is staff-only, capability-gated, bounded, and audited', () => {
  assert.match(src, /requireStaff\(request, env\)/);
  assert.match(src, /staffCan\(role, 'prospect\.write'\)/);
  assert.match(src, /readBoundedJson\(request, OUTREACH_REQUEST_MAX_BYTES\)/);
  assert.match(src, /recordAudit\(/);
  assert.match(src, /buildOutreachDraft\(/);
  assert.match(src, /buildOutreachTransition\(/);
});

test('outreach API validates organization-contact ownership and blocks opt-outs', () => {
  assert.match(src, /from\('prospect_organizations'\)/);
  assert.match(src, /from\('prospect_contacts'\)[\s\S]*organization_id/);
  assert.match(src, /marketing_consent.*opted_out|outreach_status.*blocked/s);
  assert.match(src, /outreach_blocked/);
  assert.match(src, /recipient_verification_required/);
  assert.match(src, /recipient_mismatch/);
});

test('outreach API persists drafts only and has no email delivery side effect', () => {
  assert.match(src, /from\('prospect_outreach_drafts'\)/);
  assert.doesNotMatch(src, /sendEmail|send_email|queueMarketingEmail|EmailMessage|klaviyo|ses/i);
});
