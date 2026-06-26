import assert from 'node:assert/strict';
import test from 'node:test';
import { SUBJECT_TYPES, validSubject } from '../functions/_lib/crm.js';

test('contact is a first-class CRM subject', () => {
  assert.ok(SUBJECT_TYPES.includes('contact'));
  assert.equal(validSubject('contact', '5'), true);
  assert.equal(validSubject('contact', ''), false);
  // unknown stays rejected
  assert.equal(validSubject('user', 'x'), false);
});
