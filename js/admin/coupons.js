// Admin promo-codes card (#97, #36 per-tab split): Stripe promotion-code
// management. Lives inside the Products tab; shared primitives ($, api, message,
// admSkeleton, admEmpty) are injected. esc/money/dateTime/confirmDialog from util.
import { esc, money, dateTime as date, confirmDialog } from '../util.js?v=20260830e';

const COUPON_ERROR_COPY = Object.freeze({
  ambiguous_discount: 'Enter either a percent discount or a fixed-dollar discount.',
  bad_request: 'Check the promotion details and try again.',
  discount_required: 'Enter either a percent discount or a fixed-dollar discount.',
  forbidden: 'Finance or owner access is required.',
  invalid_amount: 'Enter a fixed discount of at least $0.01 with no more than two decimals.',
  invalid_code: 'Use 3–40 letters, numbers, periods, underscores, or hyphens.',
  invalid_currency: 'Use a three-letter currency code.',
  invalid_expires_at: 'Choose an expiration date that has not passed.',
  invalid_max_redemptions: 'Enter a whole-number redemption limit of at least 1.',
  invalid_minimum_amount: 'Enter a minimum order with no more than two decimals.',
  invalid_percent: 'Enter a percent from 0.01 to 100 with no more than two decimals.',
  invalid_promo_id: 'This promo code is no longer available. Refresh and retry.',
  invalid_request_id: 'Could not prepare a safe retry. Refresh and try again.',
  request_too_large: 'Promotion details are too large.',
  stripe_error: 'Stripe could not save this code. Retry.',
  unauthenticated: 'Sign in again, then retry.',
});

const EMPTY_PROMOTION_PREVIEW = 'Enter a promo code and discount to preview the customer offer.';

export function buildPromotionDraft({
  code = '',
  discountType = 'percent',
  discountValue = '',
  minimumAmount = '',
  maxRedemptions = '',
  expiresAt = '',
} = {}) {
  const value = String(discountValue).trim();
  const fixedAmount = discountType === 'amount';
  return {
    code: String(code).trim(),
    percent_off: fixedAmount ? '' : value,
    amount_off: fixedAmount ? value : '',
    minimum_amount: String(minimumAmount).trim(),
    max_redemptions: String(maxRedemptions).trim(),
    expires_at: String(expiresAt).trim(),
  };
}

function usd(value) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    : `$${value}`;
}

export function promotionPreview(draft = {}) {
  const code = String(draft.code || '').trim().toUpperCase();
  const percent = String(draft.percent_off || '').trim();
  const amount = String(draft.amount_off || '').trim();
  if (!code || (!percent && !amount)) return EMPTY_PROMOTION_PREVIEW;

  let preview = `${code} gives ${percent ? `${percent}%` : usd(amount)} off`;
  const minimum = Number(draft.minimum_amount);
  if (draft.minimum_amount && Number.isFinite(minimum) && minimum > 0) {
    preview += ` on orders of ${usd(minimum)} or more`;
  }
  preview += '.';
  if (draft.max_redemptions) preview += ` Limited to ${draft.max_redemptions} uses.`;
  if (draft.expires_at) {
    const expiry = new Date(`${draft.expires_at}T00:00:00Z`);
    if (Number.isFinite(expiry.getTime())) {
      preview += ` Expires ${expiry.toLocaleDateString('en-US', {
        timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric',
      })}.`;
    }
  }
  return preview;
}

export function createCouponsCard({ $, api, message, admSkeleton, admEmpty, admListPager }) {
  let couponsWired = false;
  let couponCreateIdentity = null;
  let couponRows = [];
  let couponCursor = null;
  let couponsLoading = false;

  function couponDiscount(c) {
    if (c.percent_off != null) return `${esc(c.percent_off)}% off`;
    if (c.amount_off != null) return `${esc(money(c.amount_off, c.currency))} off`;
    return '';
  }

  function couponListHtml() {
    if (!couponRows.length) {
      return admEmpty('ph-ticket', 'No promo codes yet', 'Create a promo code to offer discounts at checkout.');
    }
    return `<div class="adm-table-wrap"><table class="adm"><caption class="sr-only">Promotion codes</caption><thead><tr><th>Code</th><th>Discount</th><th>Minimum order</th><th class="num">Redemptions</th><th>Expires</th><th></th></tr></thead><tbody>${couponRows.map((c) =>
      `<tr><td><b>${esc(c.code)}</b>${c.active ? '' : ' <span class="badge">inactive</span>'}</td><td>${couponDiscount(c)}</td><td>${c.minimum_amount != null ? esc(money(c.minimum_amount, c.currency)) : '—'}</td><td class="num">${esc(c.times_redeemed)}${c.max_redemptions ? `/${esc(c.max_redemptions)}` : ''}</td><td>${c.expires_at ? esc(date(c.expires_at * 1000)) : '—'}</td><td>${c.active ? `<button class="btn btn-ghost btn-sm" data-coupon-off="${esc(c.id)}" type="button">Deactivate</button>` : ''}</td></tr>`).join('')}</tbody></table></div>${admListPager('data-load-more-coupons', couponRows.length, null, Boolean(couponCursor))}`;
  }

  function readPromotionDraft() {
    return buildPromotionDraft({
      code: $('cpCode').value,
      discountType: $('cpForm').elements.discount_type.value,
      discountValue: $('cpDiscount').value,
      minimumAmount: $('cpMin').value,
      maxRedemptions: $('cpMax').value,
      expiresAt: $('cpExpires').value,
    });
  }

  function updatePromotionPreview() {
    const fixedAmount = $('cpForm').elements.discount_type.value === 'amount';
    const discount = $('cpDiscount');
    discount.placeholder = fixedAmount ? '25.00…' : '10…';
    if (fixedAmount) discount.removeAttribute('max');
    else discount.max = '100';
    $('cpDiscountHelp').textContent = fixedAmount
      ? 'Enter 25.00 for $25 off.'
      : 'Enter 10 for 10% off.';
    $('cpPreview').textContent = promotionPreview(readPromotionDraft());
  }

  async function renderCoupons({ append = false } = {}) {
    const box = $('cpList');
    if (!box || couponsLoading || (append && !couponCursor)) return;
    couponsLoading = true;
    if (!append) {
      couponRows = [];
      couponCursor = null;
      box.innerHTML = admSkeleton();
    } else {
      const button = box.querySelector('[data-load-more-coupons]');
      if (button) { button.disabled = true; button.textContent = 'Loading…'; }
    }
    try {
      const url = append
        ? `/api/admin/coupons?starting_after=${encodeURIComponent(couponCursor)}`
        : '/api/admin/coupons';
      const r = await api(url);
      const incoming = Array.isArray(r.coupons) ? r.coupons : [];
      couponRows = append
        ? [...new Map([...couponRows, ...incoming].map((coupon) => [coupon.id, coupon])).values()]
        : incoming;
      couponCursor = r.has_more && typeof r.next_cursor === 'string' ? r.next_cursor : null;
      box.innerHTML = couponListHtml();
      if (append) message('cpStatus', 'More promo codes loaded.', 'ok');
    } catch {
      if (append && couponRows.length) {
        box.innerHTML = couponListHtml();
        message('cpStatus', 'Could not load more promo codes. Retry.', 'err');
      } else {
        box.innerHTML = '<p class="adm-status" data-state="err">Could not load promo codes.</p>';
      }
    } finally {
      couponsLoading = false;
    }
  }

  function wireCoupons() {
    renderCoupons();
    if (couponsWired || !$('cpForm')) return;
    couponsWired = true;
    $('cpExpires').min = new Date().toISOString().slice(0, 10);
    $('cpForm').addEventListener('input', updatePromotionPreview);
    $('cpForm').addEventListener('change', updatePromotionPreview);
    updatePromotionPreview();
    $('cpForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const body = readPromotionDraft();
      if (!body.code) { message('cpStatus', 'Enter a code.', 'err'); $('cpCode').focus(); return; }
      if (Boolean(body.percent_off) === Boolean(body.amount_off)) {
        message('cpStatus', 'Enter either a percent discount or a fixed-dollar discount.', 'err');
        $('cpDiscount').focus();
        return;
      }
      const fingerprint = JSON.stringify(body);
      if (couponCreateIdentity?.fingerprint !== fingerprint) {
        couponCreateIdentity = { fingerprint, requestId: crypto.randomUUID() };
      }
      body.request_id = couponCreateIdentity.requestId;
      message('cpStatus', 'Creating…');
      $('cpCreate').disabled = true;
      try {
        await api('/api/admin/coupons', { method: 'POST', body });
        couponCreateIdentity = null;
        message('cpStatus', 'Code created.', 'ok');
        $('cpForm').reset();
        updatePromotionPreview();
        renderCoupons();
      } catch (err) {
        const copy = COUPON_ERROR_COPY[err.data?.error];
        message('cpStatus', copy || 'Could not create the code. Retry.', 'err');
      } finally {
        $('cpCreate').disabled = false;
      }
    });
    $('cpList').addEventListener('click', async (e) => {
      const more = e.target.closest('[data-load-more-coupons]');
      if (more) { await renderCoupons({ append: true }); return; }
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
