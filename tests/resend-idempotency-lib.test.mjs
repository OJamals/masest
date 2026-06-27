import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../functions/_lib/supabase.js', import.meta.url), 'utf8');

test('sendEmail accepts idempotency/reply/text/attachments options', () => {
  assert.match(src, /export async function sendEmail\(env, \{ to, bcc = \[\], subject, html, text = null, category = null, idempotencyKey = null, replyTo = null, attachments = \[\] \}\)/);
});

test('attachments are sent only when non-empty', () => {
  assert.match(src, /Array\.isArray\(attachments\) && attachments\.length \? \{ attachments \} : \{\}/);
});

test('Idempotency-Key header is set only when a key is supplied (deduped 24h)', () => {
  assert.match(src, /if \(idempotencyKey\) headers\['Idempotency-Key'\] = String\(idempotencyKey\)\.slice\(0, 256\)/);
  assert.match(src, /headers,/); // fetch uses the built headers object
});

test('reply_to falls back to RESEND_REPLY_TO; text + reply_to only when present', () => {
  assert.match(src, /const reply = replyTo \|\| env\.RESEND_REPLY_TO \|\| null/);
  assert.match(src, /\.\.\.\(text \? \{ text \} : \{\}\), \.\.\.\(reply \? \{ reply_to: reply \} : \{\}\)/);
});
