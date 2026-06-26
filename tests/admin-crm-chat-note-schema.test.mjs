import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL('../supabase/schema-crm-chat-note.sql', import.meta.url), 'utf8');

test('extends crm_notes.kind CHECK to allow chat, idempotently', () => {
  assert.match(sql, /drop constraint if exists crm_notes_kind_check/);
  assert.match(sql, /crm_notes_kind_chk[\s\S]*check \(kind in \('note','call','email','meeting','chat'\)\)/);
  assert.match(sql, /exception when duplicate_object then null/);
});
