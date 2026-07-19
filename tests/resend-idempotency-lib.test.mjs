import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../functions/_lib/supabase.js', import.meta.url), 'utf8');

test('sendEmailResult accepts idempotency/reply/text/attachments options and sendEmail preserves boolean compatibility', () => {
  assert.match(src, /export async function sendEmailResult\(env, \{/);
  for (const option of ['idempotencyKey = null', 'replyTo = null', 'text = null', 'attachments = []']) {
    assert.ok(src.includes(option), `missing ${option}`);
  }
  assert.match(src, /export async function sendEmail\(env, options\) \{[\s\S]+sendEmailResult\(env, options\)[\s\S]+\.ok/);
});

test('attachments are sent only when non-empty', () => {
  assert.match(src, /Array\.isArray\(attachments\) && attachments\.length \? \{ attachments \} : \{\}/);
});

test('Idempotency-Key header is stable, collision-safe, and set only when supplied', () => {
  assert.match(src, /async function providerIdempotencyHeader\(value\)/);
  assert.match(src, /crypto\.subtle\.digest\('SHA-256'/);
  assert.match(src, /if \(idempotencyKey\) headers\['Idempotency-Key'\] = await providerIdempotencyHeader\(idempotencyKey\)/);
  assert.match(src, /headers,/); // fetch uses the built headers object
});

test('reply_to falls back to RESEND_REPLY_TO; text + reply_to only when present', () => {
  assert.match(src, /const reply = replyTo \|\| env\.RESEND_REPLY_TO \|\| null/);
  assert.match(src, /\.\.\.\(bodyText \? \{ text: bodyText \} : \{\}\), \.\.\.\(reply \? \{ reply_to: reply \} : \{\}\)/);
});

test('a text/plain body is derived from the HTML when the caller omits one', () => {
  assert.match(src, /const bodyText = text \|\| htmlToText\(html\) \|\| null/);
});
