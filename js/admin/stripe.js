import { api } from '../auth.js?v=20260903b';
import { dateTime, esc } from '../util.js?v=20260903b';
import { formatStripeMinor } from './stripe-money.js?v=20260903b';

const $ = (id) => document.getElementById(id);

export async function renderStripeStatus() {
  const status = $('stripeStatus');
  const detail = $('stripeConfigDetail');
  const webhook = $('stripeWebhookStatus');
  const shippingRates = $('stripeShippingRatesStatus');
  if (!status || !detail || !webhook || !shippingRates) return;
  status.textContent = 'Checking Stripe…';
  status.dataset.state = '';
  try {
    const info = await api('/api/admin/stripe');
    const mode = info.config?.key_mode || 'missing';
    if (!info.config?.ready) {
      status.textContent = mode === 'test' ? 'Test key blocked in production' : 'Configuration incomplete';
      status.dataset.state = 'err';
    } else {
      status.textContent = mode === 'live' ? 'Live payments configured' : 'Test mode configured';
      status.dataset.state = mode === 'live' ? 'ok' : '';
    }
    detail.textContent = `Server key: ${mode}. Signing secret: ${info.config?.webhook_secret || 'missing'}.`;
    shippingRates.textContent = info.shipping_rates?.ready
      ? `${info.shipping_rates.count} published CMS shipping rate(s) active in correct Stripe mode.`
      : `${info.shipping_rates?.count || 0} published CMS shipping rate(s); live-mode mismatch or missing rate.`;
    shippingRates.dataset.state = info.shipping_rates?.ready ? 'ok' : 'err';
    if (info.webhook?.ready) {
      webhook.textContent = 'Webhook endpoint enabled; all required events subscribed.';
      webhook.dataset.state = 'ok';
    } else if (!info.webhook?.registered) {
      webhook.textContent = `Webhook missing: ${info.webhook?.url || '/api/stripe-webhook'}`;
      webhook.dataset.state = 'err';
    } else {
      const missing = info.webhook?.missing_events || [];
      webhook.textContent = missing.length
        ? `Webhook missing events: ${missing.join(', ')}`
        : 'Webhook endpoint disabled or mode mismatch.';
      webhook.dataset.state = 'err';
    }
  } catch (error) {
    status.textContent = error.data?.error || 'Stripe status check failed';
    status.dataset.state = 'err';
    detail.textContent = 'Check Cloudflare production secrets.';
    webhook.textContent = 'Webhook verification unavailable.';
    webhook.dataset.state = 'err';
    shippingRates.textContent = 'CMS shipping-rate verification unavailable.';
    shippingRates.dataset.state = 'err';
  }
}

const QBO_MAPPING_LABELS = Object.freeze({
  products_income: 'Product sales',
  shipping_income: 'Shipping income',
  merchant_fees: 'Stripe fees',
  postage_expense: 'Postage',
  stripe_clearing: 'Stripe clearing',
  bank: 'Bank deposits',
  tax: 'Sales tax',
  discounts: 'Discounts',
  refunds: 'Refunds',
  disputes: 'Disputes',
});

function qboMappingMarkup(mapping = {}) {
  const accounts = Object.entries(QBO_MAPPING_LABELS).map(([key, label]) => ({
    label,
    present: mapping[key] === 'present',
  }));
  const connected = accounts.filter((account) => account.present).length;
  const remaining = accounts.length - connected;
  const progress = `${connected} of ${accounts.length} accounts matched`;
  const next = remaining ? `${remaining} still need an account` : 'Account matching complete';
  const rows = accounts.map((account) => `
    <li data-state="${account.present ? 'present' : 'missing'}">
      <span><i class="ph ${account.present ? 'ph-check-circle' : 'ph-circle'}" aria-hidden="true"></i>${esc(account.label)}</span>
      <small>${account.present ? 'Matched' : 'Not matched'}</small>
    </li>`).join('');
  return `<details class="adm-summary-card adm-payout-setup">
    <summary>
      <span class="adm-summary-icon"><i class="ph ph-bank" aria-hidden="true"></i></span>
      <span class="adm-summary-copy"><b>QuickBooks payout setup</b><small>${esc(progress)}. ${esc(next)}.</small></span>
      <i class="ph ph-caret-down adm-summary-caret" aria-hidden="true"></i>
    </summary>
    <p class="adm-payout-setup-note">This setup is for future QuickBooks bookkeeping. It does not affect Stripe payments or bank deposits.</p>
    <ul class="adm-payout-mapping-list" aria-label="QuickBooks account matching">${rows}</ul>
  </details>`;
}

function payoutMarkup(payout) {
  const currency = String(payout.currency || 'usd').toUpperCase();
  const exponent = payout.currency_exponent;
  const totals = payout.totals || {};
  const state = payout.complete && payout.matches_payout === true ? 'published' : 'changes_requested';
  const outcome = !payout.supported
    ? `Unsupported preview: ${String(payout.unsupported_reason || 'provider payout type').replaceAll('_', ' ')}`
    : payout.provider_truncated
      ? 'Incomplete: provider transaction page limit reached'
      : payout.matches_payout === false
        ? 'Review: transaction net does not match payout'
        : payout.complete ? 'Complete payout composition' : 'Incomplete payout composition';
  const categories = (payout.categories || []).map((category) => `
    <tr><td>${esc(String(category.category || 'uncategorized').replaceAll('_', ' '))}</td><td class="num">${Number(category.transaction_count) || 0}</td><td class="num">${esc(formatStripeMinor(category.amount_minor, currency, exponent))}</td><td class="num">${esc(formatStripeMinor(category.fee_minor, currency, exponent))}</td><td class="num">${esc(formatStripeMinor(category.net_minor, currency, exponent))}</td></tr>`).join('');
  return `<article class="adm-card adm-workspace-card">
    <div class="adm-panel-header"><div><h3>${esc(payout.id)}</h3><p class="muted">${esc(dateTime(payout.arrival_at || payout.created_at))} · ${esc(payout.type || 'bank')} / ${esc(payout.method || 'unknown')}</p></div><span class="status-pill" data-s="${state}">${esc(payout.status || 'unknown')}</span></div>
    <p class="adm-status" data-state="${payout.complete ? 'ok' : 'err'}">${esc(outcome)}</p>
    <div class="adm-report-grid">
      <div class="dash-row"><span>Payout</span><b>${esc(formatStripeMinor(payout.amount_minor, currency, exponent))}</b></div>
      <div class="dash-row"><span>Gross inflow</span><b>${esc(formatStripeMinor(totals.gross_inflow_minor, currency, exponent))}</b></div>
      <div class="dash-row"><span>Gross outflow</span><b>${esc(formatStripeMinor(totals.gross_outflow_minor, currency, exponent))}</b></div>
      <div class="dash-row"><span>Stripe fees</span><b>${esc(formatStripeMinor(totals.fee_minor, currency, exponent))}</b></div>
      <div class="dash-row"><span>Net</span><b>${esc(formatStripeMinor(totals.net_minor, currency, exponent))}</b></div>
    </div>
    ${categories ? `<div class="adm-table-wrap"><table class="adm-mini-table"><thead><tr><th>Category</th><th class="num">Count</th><th class="num">Amount</th><th class="num">Fee</th><th class="num">Net</th></tr></thead><tbody>${categories}</tbody></table></div>` : '<p class="muted">No supported transaction composition available.</p>'}
  </article>`;
}

export async function renderStripePayouts() {
  const status = $('stripePayoutStatus');
  const list = $('stripePayoutList');
  const mappings = $('stripePayoutMappings');
  const refresh = $('stripePayoutRefresh');
  if (!status || !list || !mappings) return;
  status.textContent = 'Loading recent live Stripe payouts…';
  status.dataset.state = '';
  if (refresh) refresh.disabled = true;
  try {
    const result = await api('/api/admin/stripe?view=payouts&limit=3');
    mappings.innerHTML = qboMappingMarkup(result.qbo_mapping?.mappings);
    const payouts = Array.isArray(result.payouts) ? result.payouts : [];
    list.innerHTML = payouts.length
      ? payouts.map(payoutMarkup).join('')
      : '<div class="empty-state"><div class="empty-title">No Stripe bank deposits yet</div><div class="empty-body">Stripe will list deposits here after it sends money to your bank.</div></div>';
    status.textContent = payouts.length
      ? `${payouts.length} ${payouts.length === 1 ? 'payout' : 'payouts'} ready to review${result.payouts_has_more ? '. Older payouts are available in Stripe.' : '.'}`
      : 'No payouts found.';
    status.dataset.state = payouts.length > 0 && payouts.every((payout) => payout.complete && payout.matches_payout === true) ? 'ok' : '';
  } catch (error) {
    status.textContent = error.data?.error === 'stripe_live_key_required'
      ? 'Connect a live Stripe account to view payouts.'
      : 'Stripe payout history is not available right now. Try again.';
    status.dataset.state = 'err';
    mappings.textContent = 'QuickBooks setup could not be checked.';
    list.innerHTML = '';
  } finally {
    if (refresh) refresh.disabled = false;
  }
}

export function wireStripePayouts() {
  const refresh = $('stripePayoutRefresh');
  if (!refresh || refresh.dataset.wired === '1') return;
  refresh.dataset.wired = '1';
  refresh.addEventListener('click', () => void renderStripePayouts());
}
