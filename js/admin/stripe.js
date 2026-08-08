import { api } from '../auth.js?v=20260808a';
import { dateTime, esc } from '../util.js?v=20260808a';
import { formatStripeMinor } from './stripe-money.js?v=20260808a';

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

function mappingLabel(value) {
  return String(value || '').replace(/^QBO_/, '').replace(/_ACCOUNT_ID$/, '').replaceAll('_', ' ').toLowerCase();
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
    const missing = Array.isArray(result.qbo_mapping?.missing) ? result.qbo_mapping.missing : [];
    const ready = result.qbo_mapping?.posting_ready === true;
    mappings.innerHTML = ready
      ? '<p class="adm-status" data-state="ok">All required QBO account mappings are present. Posting remains disabled pending accountant-reviewed journal design.</p>'
      : `<p class="adm-status" data-state="err">QBO posting blocked: ${missing.length} account mapping(s) missing.</p><ul>${missing.map((key) => `<li>${esc(mappingLabel(key))} <code>${esc(key)}</code></li>`).join('')}</ul>`;
    const payouts = Array.isArray(result.payouts) ? result.payouts : [];
    list.innerHTML = payouts.length
      ? payouts.map(payoutMarkup).join('')
      : '<div class="empty-state"><div class="empty-title">No recent payouts</div><div class="empty-body">Stripe returned no payouts for this account.</div></div>';
    status.textContent = `${payouts.length} recent payout(s) loaded${result.payouts_has_more ? '; older payouts not shown' : ''}. Read-only preview; no QuickBooks writes.`;
    status.dataset.state = payouts.every((payout) => payout.complete && payout.matches_payout === true) ? 'ok' : '';
  } catch (error) {
    status.textContent = error.data?.error === 'stripe_live_key_required'
      ? 'Live Stripe key required for payout reconciliation.'
      : 'Stripe payout preview unavailable. Retry.';
    status.dataset.state = 'err';
    mappings.textContent = 'QBO mapping readiness unavailable.';
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
