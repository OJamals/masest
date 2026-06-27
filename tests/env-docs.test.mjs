// Keeps .env.example honest: every runtime env var that gates a shipped feature must be
// documented, or operators can't activate it. Mirrors tests/qbo-env-docs.test.mjs. When a
// new env-gated feature lands, add its var here so the doc can't silently fall behind.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const env = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');

test('.env.example documents the email (Resend) feature toggles', () => {
  for (const key of ['RESEND_API_KEY', 'RESEND_FROM', 'RESEND_WEBHOOK_SECRET', 'RESEND_REPLY_TO', 'EMAIL_UNSUB_SECRET', 'ORDER_NOTIFY_EMAIL']) {
    assert.match(env, new RegExp(`^${key}=`, 'm'), `${key} missing from .env.example`);
  }
});

test('.env.example documents the Crisp outbound + identity vars', () => {
  for (const key of ['CRISP_WEBHOOK_SECRET', 'CRISP_TOKEN_ID', 'CRISP_TOKEN_KEY', 'CRISP_IDENTITY_SECRET', 'MASEST_CRISP_ID']) {
    assert.match(env, new RegExp(`^${key}=`, 'm'), `${key} missing from .env.example`);
  }
});

test('.env.example documents the quote intake + sweep vars', () => {
  for (const key of ['SALES_EMAIL', 'QUOTE_CRM_SECRET', 'TURNSTILE_SECRET', 'SITE_URL']) {
    assert.match(env, new RegExp(`^${key}=`, 'm'), `${key} missing from .env.example`);
  }
});

test('.env.example documents the Stripe tax + core commerce vars', () => {
  for (const key of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_TAX_ENABLED', 'APP_URL']) {
    assert.match(env, new RegExp(`^${key}=`, 'm'), `${key} missing from .env.example`);
  }
});
