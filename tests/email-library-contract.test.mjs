import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../functions/_lib/supabase.js', import.meta.url), 'utf8');

test('sendEmailResult preserves the shared caller interface', () => {
  assert.match(src, /export async function sendEmailResult\(env, \{/);
  for (const option of ['idempotencyKey = null', 'replyTo = null', 'text = null', 'emailHeaders = {}', 'attachments = []']) {
    assert.ok(src.includes(option), `missing ${option}`);
  }
  assert.match(src, /export async function sendEmail\(env, options\) \{[\s\S]+sendEmailResult\(env, options\)[\s\S]+\.ok/);
});

test('private service payload carries stable identity, thread headers, and optional parts', () => {
  assert.match(src, /emailIdempotencyKey\(idempotencyKey \|\| `ephemeral\/\$\{crypto\.randomUUID\(\)\}`\)/);
  assert.match(src, /'https:\/\/email\.service\/v1\/send'/);
  assert.match(src, /replyTo \|\| env\.EMAIL_REPLY_TO \|\| null/);
  assert.match(src, /Object\.keys\(messageHeaders\)\.length \? \{ headers: messageHeaders \} : \{\}/);
  assert.match(src, /Array\.isArray\(attachments\) && attachments\.length \? \{ attachments \} : \{\}/);
  assert.match(src, /const bodyText = text \|\| htmlToText\(html\) \|\| null/);
});

test('marketing cannot leak through the transactional Cloudflare stream', () => {
  assert.match(src, /const policy = categoryPolicy\(category\)/);
  assert.match(src, /email_category_required/);
  assert.match(src, /policy\.stream === 'marketing'/);
  assert.match(src, /marketing_queue_required/);
  assert.doesNotMatch(src, /sendSesMarketingEmail|marketingSender|sesSigner|webViewUrl/);
  assert.match(src, /stream: 'transactional'/);
});
