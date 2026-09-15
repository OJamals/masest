// Keeps .env.example honest: every runtime env var that gates a shipped feature must be
// documented, or operators can't activate it. Mirrors tests/qbo-env-docs.test.mjs. When a
// new env-gated feature lands, add its var here so the doc can't silently fall behind.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const env = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
const pages = readFileSync(new URL('../CLOUDFLARE_PAGES.md', import.meta.url), 'utf8');
const architecture = readFileSync(new URL('../docs/ARCHITECTURE.md', import.meta.url), 'utf8');
const acceptance = readFileSync(new URL('../docs/PRODUCTION_ACCEPTANCE.md', import.meta.url), 'utf8');
const roadmap = readFileSync(new URL('../docs/ROADMAP.md', import.meta.url), 'utf8');

test('.env.example documents the Cloudflare email bindings and bridge secrets', () => {
  for (const key of ['EMAIL_REPLY_TO', 'MESSAGE_REPLY_DOMAIN', 'MESSAGE_REPLY_SECRET', 'EMAIL_INGRESS_SECRET', 'EMAIL_UNSUB_SECRET', 'ORDER_NOTIFY_EMAIL']) {
    assert.match(env, new RegExp(`^${key}=`, 'm'), `${key} missing from .env.example`);
  }
  assert.match(env, /EMAIL_SERVICE is a Cloudflare Pages service binding/);
  assert.doesNotMatch(env, /^RESEND_/m);
});

test('.env.example documents least-privilege Amazon SES marketing config', () => {
  for (const key of [
    'AWS_SES_ACCESS_KEY_ID',
    'AWS_SES_SECRET_ACCESS_KEY',
    'AWS_SES_REGION',
    'AWS_SES_FROM_EMAIL',
    'AWS_SES_REPLY_TO',
    'AWS_SES_CONFIGURATION_SET',
    'SES_SNS_TOPIC_ARN',
    'MARKETING_DELIVERY_BATCH_SIZE',
    'MARKETING_DELIVERY_CONCURRENCY',
    'MARKETING_DELIVERY_CONTINUATION_DELAY_SECONDS',
  ]) {
    assert.match(env, new RegExp(`^${key}=`, 'm'), `${key} missing from .env.example`);
  }
  assert.doesNotMatch(env, /^KLAVIYO_/m);
  assert.match(env, /MARKETING_EMAIL_QUEUE is a Cloudflare Pages Queue producer binding/);
});

test('.env.example has no retired Crisp credentials', () => {
  assert.doesNotMatch(env, /CRISP_/);
});

test('.env.example documents the quote intake + sweep vars', () => {
  for (const key of ['SALES_EMAIL', 'QUOTE_CRM_SECRET', 'TURNSTILE_SECRET', 'SITE_URL']) {
    assert.match(env, new RegExp(`^${key}=`, 'm'), `${key} missing from .env.example`);
  }
});

test('.env.example documents the Stripe tax + core commerce vars', () => {
  for (const key of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_TAX_ENABLED', 'STRIPE_SHIPPING_RATE_IDS', 'APP_URL']) {
    assert.match(env, new RegExp(`^${key}=`, 'm'), `${key} missing from .env.example`);
  }
});

test('Cloudflare runbook documents Supabase Auth SMTP separately from app email', () => {
  assert.match(pages, /Supabase Auth Email/);
  assert.match(pages, /Authentication -> Emails -> SMTP Settings/);
  assert.match(pages, /where `send\.masest\.co` is\s+verified for Email Sending/);
  assert.match(pages, /smtp\.mx\.cloudflare\.net/);
  assert.match(pages, /Do not fix this by disabling email confirmation/);
});

test('current architecture, acceptance, and roadmap docs name the canonical email providers', () => {
  for (const document of [architecture, acceptance, roadmap]) {
    assert.doesNotMatch(document, /\bResend\b/);
  }
  assert.match(architecture, /Cloudflare Email Service/);
  assert.match(architecture, /Amazon SES/);
  assert.match(architecture, /Supabase.*marketing consent/);
  assert.match(acceptance, /Cloudflare Email Routing/);
});
