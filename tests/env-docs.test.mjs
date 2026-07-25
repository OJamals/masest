// Keeps .env.example honest: every runtime env var that gates a shipped feature must be
// documented, or operators can't activate it. Mirrors tests/qbo-env-docs.test.mjs. When a
// new env-gated feature lands, add its var here so the doc can't silently fall behind.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const env = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
const pages = readFileSync(new URL('../CLOUDFLARE_PAGES.md', import.meta.url), 'utf8');

test('.env.example documents the email (Resend) feature toggles', () => {
  for (const key of ['RESEND_API_KEY', 'RESEND_FROM', 'RESEND_WEBHOOK_SECRET', 'RESEND_REPLY_TO', 'RESEND_INBOUND_DOMAIN', 'MESSAGE_REPLY_SECRET', 'EMAIL_UNSUB_SECRET', 'ORDER_NOTIFY_EMAIL']) {
    assert.match(env, new RegExp(`^${key}=`, 'm'), `${key} missing from .env.example`);
  }
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
  assert.match(pages, /verified\s+`masest\.co`\s+domain/);
  assert.match(pages, /Do not fix this by disabling email confirmation/);
});
