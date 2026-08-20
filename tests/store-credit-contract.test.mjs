import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('account credit schema owns an immutable, idempotent, service-only ledger and reservations', () => {
  const sql = read('supabase/schema-store-credits.sql');
  assert.match(sql, /^\s*begin\s*;/im);
  assert.match(sql, /commit\s*;\s*$/i);
  assert.match(sql, /create table if not exists public\.company_store_credit_entries/i);
  assert.match(sql, /create table if not exists public\.company_store_credit_reservations/i);
  assert.match(sql, /user_id\s+uuid\s+references auth\.users\(id\) on delete set null/i);
  assert.doesNotMatch(sql, /user_id\s+uuid\s+not null\s+references auth\.users\(id\) on delete restrict/i);
  assert.match(sql, /company_store_credit_entries_immutable/i);
  assert.match(sql, /for update/i);
  assert.match(sql, /unique\s*\(request_id\)/i);
  assert.match(sql, /unique\s*\(company_id,\s*intent_id\)/i);
  for (const [name, table, column] of [
    ['company_store_credit_reservations_user_idx', 'company_store_credit_reservations', 'user_id'],
    ['company_store_credit_reservations_order_idx', 'company_store_credit_reservations', 'order_id'],
    ['company_store_credit_entries_order_idx', 'company_store_credit_entries', 'order_id'],
    ['company_store_credit_entries_created_by_idx', 'company_store_credit_entries', 'created_by'],
  ]) {
    assert.match(
      sql,
      new RegExp(`create index if not exists ${name}\\s+on public\\.${table} \\(\\s*${column}\\s*\\)`, 'i'),
      `${table}.${column} foreign key must stay indexed`,
    );
  }
  assert.match(sql, /revoke all[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute[\s\S]*to service_role/i);
  assert.match(sql, /create or replace function public\.reserve_company_store_credit/i);
  assert.match(sql, /create or replace function public\.consume_company_store_credit/i);
  assert.match(sql, /create or replace function public\.release_company_store_credit/i);
  assert.match(sql, /create or replace function public\.adjust_company_store_credit/i);
  assert.match(sql, /restore_company_store_credit_on_terminal_order/i);
  assert.match(
    sql,
    /consume_company_store_credit[\s\S]*from public\.companies[\s\S]*for update[\s\S]*from public\.company_store_credit_reservations[\s\S]*for update/i,
  );
  assert.match(sql, /v_reservation\.status not in \('reserved', 'attached'\)/i);
  assert.match(sql, /stripe_session_id = coalesce\(stripe_session_id, p_stripe_session_id\)/i);
  assert.match(sql, /reserve_company_store_credit[\s\S]*p_expires_at timestamptz/i);
  assert.match(sql, /attach_company_store_credit[\s\S]*v_reservation\.expires_at <= now\(\)/i);
  assert.match(sql, /set search_path = public, pg_temp/i);
  assert.doesNotMatch(
    sql,
    /update public\.company_store_credit_reservations[\s\S]{0,180}status = 'released'[\s\S]{0,180}expires_at <= now\(\)/i,
    'elapsed time alone must not free funds before Stripe terminal state is known',
  );
});

test('account credit is wired through checkout, webhook settlement, account, admin, and buyer UI', () => {
  const checkout = read('functions/api/checkout.js');
  const webhook = read('functions/api/stripe-webhook.js');
  const account = read('functions/api/account/me.js');
  const admin = read('functions/api/admin/company-credits.js');
  const checkoutUi = read('js/checkout.js');
  const cart = read('js/cart.js');
  const checkoutHtml = read('checkout.html');
  const companyUi = read('js/admin/companies.js');
  const accountExport = read('functions/api/account/export.js');

  assert.match(checkout, /reserveCompanyStoreCredit/);
  assert.match(checkout, /checkout_intent_id/);
  assert.match(checkout, /storeCreditCheckoutIdempotencyKey/);
  assert.match(webhook, /consumeCompanyStoreCredit/);
  assert.match(webhook, /releaseCompanyStoreCredit/);
  assert.match(account, /store_credit/);
  assert.match(admin, /staffCan\(role, ['"]company\.credit['"]\)/);
  assert.match(admin, /adjustCompanyStoreCredit/);
  assert.match(checkoutUi, /applyStoreCredit/);
  assert.match(cart, /apply_store_credit/);
  assert.match(checkoutHtml, /checkoutStoreCredit/);
  assert.match(companyUi, /account credit/i);
  assert.match(accountExport, /company_store_credit_entries/);
  assert.match(accountExport, /company_store_credit_reservations/);
});
