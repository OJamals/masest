import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../js/admin/crm.js', import.meta.url), 'utf8');

test('chat notes get a distinct timeline icon', () => {
  assert.match(src, /type === 'note:chat'\) return 'ph-chat-circle'/);
});
