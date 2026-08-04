import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  qboStripeMappingStatus,
  stripeCurrencyExponent,
  stripePayoutReconciliation,
  summarizeStripeBalanceTransactions,
} from '../functions/_lib/stripe-payouts.js';
import { formatStripeMinor } from '../js/admin/stripe-money.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('QBO Stripe mapping gate is redacted and fail-closed until every account is present', () => {
  const partial = qboStripeMappingStatus({
    QBO_INCOME_ACCOUNT_ID: '79',
    QBO_STRIPE_CLEARING_ACCOUNT_ID: '81',
  });
  assert.equal(partial.posting_ready, false);
  assert.equal(partial.mappings.products_income, 'present');
  assert.equal(partial.mappings.stripe_clearing, 'present');
  assert.equal(partial.mappings.merchant_fees, 'missing');
  assert.ok(partial.missing.includes('QBO_MERCHANT_FEES_ACCOUNT_ID'));
  assert.equal(JSON.stringify(partial).includes('79'), false);
  assert.equal(JSON.stringify(partial).includes('81'), false);

  const completeEnv = Object.fromEntries(partial.required.map((key) => [key, 'configured']));
  assert.equal(qboStripeMappingStatus(completeEnv).posting_ready, true);
});

test('Stripe balance transaction summary uses integer minor units and keeps categories distinct', () => {
  assert.equal(stripeCurrencyExponent('usd'), 2);
  assert.equal(stripeCurrencyExponent('jpy'), 0);
  assert.equal(stripeCurrencyExponent('ugx'), 2, 'Stripe legacy UGX API amounts retain two-decimal representation');
  assert.equal(formatStripeMinor(10000, 'jpy', stripeCurrencyExponent('jpy')), 'JPY 10,000');
  assert.equal(formatStripeMinor(10000, 'usd', stripeCurrencyExponent('usd')), 'USD 100.00');
  const summary = summarizeStripeBalanceTransactions([
    { id: 'txn_charge', amount: 10000, fee: 320, net: 9680, currency: 'usd', reporting_category: 'charge' },
    { id: 'txn_refund', amount: -2000, fee: 0, net: -2000, currency: 'usd', reporting_category: 'refund' },
    { id: 'txn_adjust', amount: 500, fee: 0, net: 500, currency: 'usd', reporting_category: 'adjustment' },
  ], 'usd');
  assert.deepEqual(summary.totals, {
    transaction_count: 3,
    gross_inflow_minor: 10500,
    gross_outflow_minor: -2000,
    fee_minor: 320,
    net_minor: 8180,
  });
  assert.deepEqual(summary.categories.map((row) => row.category), ['adjustment', 'charge', 'refund']);
  assert.equal(summary.multi_currency, false);

  assert.throws(() => summarizeStripeBalanceTransactions([
    { amount: Number.MAX_SAFE_INTEGER, fee: 0, net: Number.MAX_SAFE_INTEGER, currency: 'usd', type: 'charge' },
    { amount: 1, fee: 0, net: 1, currency: 'usd', type: 'charge' },
  ], 'usd'), (error) => error.code === 'stripe_payout_response_invalid');
  assert.throws(() => summarizeStripeBalanceTransactions([
    { amount: null, fee: null, net: null, currency: 'usd', type: 'charge' },
  ], 'usd'), (error) => error.code === 'stripe_payout_response_invalid');
});

test('Stripe payout preview paginates automatic payouts within hard bounds and redacts provider objects', async () => {
  const urls = [];
  const request = async (_env, path) => {
    urls.push(path);
    if (path.startsWith('/payouts?')) {
      return {
        data: [
          {
            id: 'po_auto', amount: 8180, currency: 'usd', automatic: true, method: 'standard', type: 'bank_account',
            status: 'paid', arrival_date: 1785888000, created: 1785801600, trace_id: { value: 'trace-safe' },
            description: 'must not leak', metadata: { buyer_email: 'private@example.com' },
          },
          {
            id: 'po_manual', amount: 5000, currency: 'usd', automatic: false, method: 'instant', type: 'bank_account',
            status: 'paid', arrival_date: 1785888000, created: 1785801600,
          },
          {
            id: 'po_jpy', amount: 10000, currency: 'jpy', automatic: false, method: 'standard', type: 'bank_account',
            status: 'paid', arrival_date: 1785888000, created: 1785801600,
          },
        ],
        has_more: true,
      };
    }
    if (!path.includes('starting_after=')) {
      return { data: [{ id: 'txn_1', amount: 10000, fee: 320, net: 9680, currency: 'usd', reporting_category: 'charge' }], has_more: true };
    }
    return { data: [{ id: 'txn_2', amount: -1500, fee: 0, net: -1500, currency: 'usd', reporting_category: 'refund' }], has_more: false };
  };
  const result = await stripePayoutReconciliation(
    { STRIPE_SECRET_KEY: 'sk_live_fixture' },
    { limit: 99 },
    { request },
  );
  assert.equal(result.limit, 5);
  assert.equal(result.payouts_has_more, true);
  assert.equal(result.payouts[0].id, 'po_auto');
  assert.equal(result.payouts[0].currency_exponent, 2);
  assert.equal(result.payouts[0].complete, true);
  assert.equal(result.payouts[0].totals.net_minor, 8180);
  assert.equal(result.payouts[0].matches_payout, true);
  assert.equal(result.payouts[0].trace_id, 'trace-safe');
  assert.equal(result.payouts[1].supported, false);
  assert.equal(result.payouts[1].unsupported_reason, 'manual_or_instant_payout');
  assert.equal(result.payouts[2].currency_exponent, 0);
  assert.equal(result.payouts[2].amount_minor, 10000);
  assert.equal(urls.filter((url) => url.startsWith('/balance_transactions?')).length, 2);
  assert.match(urls[0], /limit=5/);
  assert.equal(JSON.stringify(result).includes('private@example.com'), false);
  assert.equal(JSON.stringify(result).includes('must not leak'), false);
});

test('Stripe payout preview marks truncated and multi-currency composition incomplete', async () => {
  let page = 0;
  const result = await stripePayoutReconciliation(
    { STRIPE_SECRET_KEY: 'sk_live_fixture' },
    { limit: 1 },
    {
      request: async (_env, path) => {
        if (path.startsWith('/payouts?')) return { data: [{ id: 'po_1', amount: 100, currency: 'usd', automatic: true, method: 'standard', status: 'pending' }], has_more: false };
        page += 1;
        return {
          data: [{ id: `txn_${page}`, amount: 100, fee: 0, net: 100, currency: page === 1 ? 'eur' : 'usd', reporting_category: 'charge' }],
          has_more: true,
        };
      },
    },
  );
  assert.equal(page, 5);
  assert.equal(result.payouts[0].provider_truncated, true);
  assert.equal(result.payouts[0].multi_currency, true);
  assert.equal(result.payouts[0].complete, false);
  assert.equal(result.payouts[0].unsupported_reason, 'multi_currency');
});

test('Stripe payout preview requires live credentials before provider access', async () => {
  for (const key of ['', 'sk_test_fixture', 'rk_test_fixture', 'not-a-stripe-key']) {
    await assert.rejects(
      stripePayoutReconciliation({ STRIPE_SECRET_KEY: key }, {}, {
        request: async () => assert.fail('provider must not run without live key'),
      }),
      (error) => error.code === 'stripe_live_key_required',
    );
  }
});

test('Stripe payout preview rejects malformed provider collections', async () => {
  await assert.rejects(
    stripePayoutReconciliation({ STRIPE_SECRET_KEY: 'sk_live_fixture' }, {}, {
      request: async () => ({ object: 'list', data: null, has_more: false }),
    }),
    (error) => error.code === 'stripe_payout_response_invalid',
  );

  await assert.rejects(
    stripePayoutReconciliation({ STRIPE_SECRET_KEY: 'sk_live_fixture' }, { limit: 1 }, {
      request: async (_env, path) => path.startsWith('/payouts?')
        ? { data: [{ id: 'po_1', amount: 0, currency: 'usd', automatic: true, method: 'standard' }], has_more: false }
        : { data: [{ id: '', amount: null, fee: null, net: null, currency: 'usd' }], has_more: false },
    }),
    (error) => error.code === 'stripe_payout_response_invalid',
  );
});

test('admin Finance UI wires read-only payout preview and QBO mapping blockers', () => {
  const html = read('admin.html');
  const stripe = read('js/admin/stripe.js');
  const admin = read('js/admin.js');
  assert.match(html, /id="admStripePayouts"/);
  assert.match(html, /id="stripePayoutRefresh"/);
  assert.match(html, /data-capability-scope="company\.credit"/);
  assert.match(stripe, /\/api\/admin\/stripe\?view=payouts&amp;limit=3|\/api\/admin\/stripe\?view=payouts&limit=3/);
  assert.match(stripe, /export async function renderStripePayouts/);
  assert.match(stripe, /export function wireStripePayouts/);
  assert.match(admin, /renderStripePayouts/);
  assert.match(admin, /wireStripePayouts/);
  assert.match(stripe, /formatStripeMinor/);
  assert.doesNotMatch(stripe, /value \/ 100/);
  assert.doesNotMatch(stripe, /method:\s*['"]POST['"]/);
});
