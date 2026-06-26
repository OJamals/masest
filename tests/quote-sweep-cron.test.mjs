import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL('../supabase/quote-sweep-cron.example.sql', import.meta.url), 'utf8');
const endpoint = readFileSync(new URL('../functions/api/admin/quotes.js', import.meta.url), 'utf8');

test('cron template enables extensions + schedules quote-sweep idempotently', () => {
  assert.match(sql, /create extension if not exists pg_cron/);
  assert.match(sql, /create extension if not exists pg_net/);
  assert.match(sql, /cron\.unschedule\('quote-sweep'\)/);
  assert.match(sql, /cron\.schedule\(\s*'quote-sweep',\s*'\*\/15 \* \* \* \*'/);
});

test('cron posts exactly the contract the quotes endpoint verifies (no drift)', () => {
  // what the cron sends
  assert.match(sql, /url := 'https:\/\/masest\.co\/api\/admin\/quotes'/);
  assert.match(sql, /'x-quote-crm-secret', '<QUOTE_CRM_SECRET>'/);
  assert.match(sql, /'action', 'sweep_due', 'batch', 10/);
  // what the endpoint expects
  assert.match(endpoint, /body\.action === 'sweep_due'/);
  assert.match(endpoint, /x-quote-crm-secret/);
  assert.match(endpoint, /env\.QUOTE_CRM_SECRET/);
  assert.match(endpoint, /sweepDueQuotes\(/);
});
