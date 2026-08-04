import { api } from '../auth.js?v=20260730a';

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
