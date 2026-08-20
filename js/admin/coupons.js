// Admin promo-codes card (#97, #36 per-tab split): Stripe promotion-code
// management. Lives inside the Products tab; shared primitives ($, api, message,
// admSkeleton, admEmpty) are injected. esc/money/dateTime/confirmDialog from util.
import { esc, money, dateTime as date, confirmDialog } from '../util.js?v=20260820a';

export function createCouponsCard({ $, api, message, admSkeleton, admEmpty }) {
  let couponsWired = false;
  let couponCreateIdentity = null;

  function couponDiscount(c) {
    if (c.percent_off != null) return `${esc(c.percent_off)}% off`;
    if (c.amount_off != null) return `${esc(money(c.amount_off, c.currency))} off`;
    return '';
  }

  async function renderCoupons() {
    const box = $('cpList');
    if (!box) return;
    box.innerHTML = admSkeleton();
    try {
      const r = await api('/api/admin/coupons');
      const list = r.coupons || [];
      box.innerHTML = list.length
        ? `<div class="adm-table-wrap"><table class="adm"><thead><tr><th>Code</th><th>Discount</th><th>Min</th><th class="num">Uses</th><th>Expires</th><th></th></tr></thead><tbody>${list.map((c) =>
            `<tr><td><b>${esc(c.code)}</b>${c.active ? '' : ' <span class="badge">inactive</span>'}</td><td>${couponDiscount(c)}</td><td>${c.minimum_amount != null ? esc(money(c.minimum_amount, c.currency)) : '—'}</td><td class="num">${esc(c.times_redeemed)}${c.max_redemptions ? `/${esc(c.max_redemptions)}` : ''}</td><td>${c.expires_at ? esc(date(c.expires_at * 1000)) : '—'}</td><td>${c.active ? `<button class="btn btn-ghost btn-sm" data-coupon-off="${esc(c.id)}" type="button">Deactivate</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
        : admEmpty('ph-ticket', 'No promo codes yet', 'Create a promo code to offer discounts at checkout.');
    } catch { box.innerHTML = '<p class="adm-status" data-state="err">Could not load promo codes.</p>'; }
  }

  function wireCoupons() {
    renderCoupons();
    if (couponsWired || !$('cpCreate')) return;
    couponsWired = true;
    $('cpExpires').min = new Date().toISOString().slice(0, 10);
    $('cpCreate').addEventListener('click', async () => {
      const body = {
        code: $('cpCode').value.trim(),
        percent_off: $('cpPercent').value.trim(),
        amount_off: $('cpAmount').value.trim(),
        minimum_amount: $('cpMin').value.trim(),
        max_redemptions: $('cpMax').value.trim(),
        expires_at: $('cpExpires').value,
      };
      if (!body.code) { message('cpStatus', 'Enter a code.', 'err'); return; }
      if (Boolean(body.percent_off) === Boolean(body.amount_off)) {
        message('cpStatus', 'Enter either a percent discount or a fixed-dollar discount.', 'err');
        return;
      }
      const fingerprint = JSON.stringify(body);
      if (couponCreateIdentity?.fingerprint !== fingerprint) {
        couponCreateIdentity = { fingerprint, requestId: crypto.randomUUID() };
      }
      body.request_id = couponCreateIdentity.requestId;
      message('cpStatus', 'Creating…');
      try {
        await api('/api/admin/coupons', { method: 'POST', body });
        couponCreateIdentity = null;
        message('cpStatus', 'Code created.', 'ok');
        ['cpCode', 'cpPercent', 'cpAmount', 'cpMin', 'cpMax', 'cpExpires'].forEach((id) => { $(id).value = ''; });
        renderCoupons();
      } catch (err) {
        const copy = {
          ambiguous_discount: 'Enter either a percent discount or a fixed-dollar discount.',
          invalid_expires_at: 'Choose an expiration date that has not passed.',
          invalid_amount: 'Enter a fixed discount of at least $0.01 with no more than two decimals.',
          invalid_minimum_amount: 'Enter a minimum order with no more than two decimals.',
        }[err.data?.error];
        message('cpStatus', copy || err.data?.error || 'Could not create the code. Retry.', 'err');
      }
    });
    $('cpList').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-coupon-off]');
      if (!btn) return;
      if (!(await confirmDialog('Deactivate this promo code? It can no longer be redeemed.', { confirmText: 'Deactivate', danger: true }))) return;
      btn.disabled = true;
      try {
        await api('/api/admin/coupons', { method: 'POST', body: { id: btn.dataset.couponOff, action: 'deactivate' } });
        renderCoupons();
      } catch { message('cpStatus', 'Could not deactivate. Retry.', 'err'); btn.disabled = false; }
    });
  }

  return { renderCoupons, wireCoupons };
}
