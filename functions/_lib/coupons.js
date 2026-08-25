// Pure builder for Stripe coupon + promotion-code params from an admin create request (#97).
// Returns { error } on invalid input, else { coupon, promo } objects for the Stripe SDK.
// Money inputs are dollars (converted to integer minor units here).
function moneyMinor(value) {
  const raw = String(value ?? '').trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match) return null;
  const minor = (Number(match[1]) * 100) + Number((match[2] || '').padEnd(2, '0'));
  return Number.isSafeInteger(minor) ? minor : null;
}

export function normalizePromotionId(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  return /^promo_[A-Za-z0-9]{1,240}$/.test(id) ? id : null;
}

export function promotionListParams(requestUrl) {
  const rawCursor = new URL(requestUrl).searchParams.get('starting_after');
  const cursor = rawCursor ? normalizePromotionId(rawCursor) : null;
  if (rawCursor && !cursor) {
    return { error: 'invalid_cursor' };
  }
  return {
    params: {
      limit: 100,
      expand: ['data.coupon'],
      ...(cursor ? { starting_after: cursor } : {}),
    },
  };
}

function promotionIdentity(value) {
  const id = normalizePromotionId(typeof value === 'string' ? value : value?.id);
  if (!id) return null;
  const rawCode = typeof value === 'object' && value && typeof value.code === 'string'
    ? value.code.trim()
    : '';
  const code = rawCode
    && rawCode.length <= 100
    && !/[\u0000-\u001F\u007F]/.test(rawCode)
    ? rawCode
    : null;
  return { id, code };
}

// Stripe event destinations may include either an expanded Promotion Code object,
// its ID, or only the discount breakdown. Normalize all supported Checkout shapes.
export function checkoutPromotion(session) {
  const direct = Array.isArray(session?.discounts) ? session.discounts : [];
  const breakdown = Array.isArray(session?.total_details?.breakdown?.discounts)
    ? session.total_details.breakdown.discounts
    : [];
  const candidates = [
    ...direct.flatMap((discount) => [discount?.promotion_code, discount?.discount?.promotion_code]),
    ...breakdown.flatMap((entry) => [entry?.promotion_code, entry?.discount?.promotion_code]),
  ];
  for (const candidate of candidates) {
    const promotion = promotionIdentity(candidate);
    if (promotion) return promotion;
  }
  return null;
}

export function storefrontPromotionSetAllowed(promotions = []) {
  if (!Array.isArray(promotions) || promotions.length !== 1) return false;
  const [promotion] = promotions;
  const coupon = promotion?.coupon || {};
  return promotion?.active === true
    && String(promotion?.code || '').trim().toUpperCase() === 'VK5'
    && Number(coupon.percent_off) === 5
    && coupon.amount_off == null
    && coupon.valid === true;
}

export async function storefrontPromotionCodesReady(stripe) {
  if (typeof stripe?.promotionCodes?.list !== 'function') return false;
  try {
    const result = await stripe.promotionCodes.list({
      active: true,
      limit: 100,
      expand: ['data.coupon'],
    });
    return result?.has_more !== true && storefrontPromotionSetAllowed(result?.data || []);
  } catch {
    return false;
  }
}

export function buildCouponParams(body, { nowSeconds = Math.floor(Date.now() / 1000) } = {}) {
  const b = body || {};
  const code = String(b.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9._-]{3,40}$/.test(code)) return { error: 'invalid_code' };

  const currency = String(b.currency || 'usd').toLowerCase();
  if (!/^[a-z]{3}$/.test(currency)) return { error: 'invalid_currency' };
  const coupon = { duration: 'once' };

  const hasPercent = b.percent_off !== undefined && b.percent_off !== null && b.percent_off !== '';
  const hasAmount = b.amount_off !== undefined && b.amount_off !== null && b.amount_off !== '';
  if (hasPercent && hasAmount) return { error: 'ambiguous_discount' };
  if (hasPercent) {
    const percentRaw = String(b.percent_off).trim();
    if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(percentRaw)) return { error: 'invalid_percent' };
    const percent = Number(percentRaw);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return { error: 'invalid_percent' };
    coupon.percent_off = percent;
  } else if (hasAmount) {
    const amountMinor = moneyMinor(b.amount_off);
    if (!amountMinor || amountMinor <= 0) return { error: 'invalid_amount' };
    coupon.amount_off = amountMinor;
    coupon.currency = currency;
  } else {
    return { error: 'discount_required' };
  }

  let maxRedemptions = null;
  if (b.max_redemptions !== undefined && b.max_redemptions !== null && b.max_redemptions !== '') {
    const maxRedemptionsRaw = String(b.max_redemptions).trim();
    if (!/^\d+$/.test(maxRedemptionsRaw)) return { error: 'invalid_max_redemptions' };
    maxRedemptions = Number(maxRedemptionsRaw);
    if (!Number.isSafeInteger(maxRedemptions) || maxRedemptions < 1) return { error: 'invalid_max_redemptions' };
    coupon.max_redemptions = maxRedemptions;
  }

  let expiresAt = null;
  if (b.expires_at) {
    const rawExpiry = String(b.expires_at).trim();
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(rawExpiry);
    if (dateOnly) {
      const parsedDate = new Date(`${rawExpiry}T00:00:00Z`);
      if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== rawExpiry) {
        return { error: 'invalid_expires_at' };
      }
    }
    const expiryValue = dateOnly
      ? `${rawExpiry}T23:59:59Z`
      : rawExpiry;
    const t = Math.floor(new Date(expiryValue).getTime() / 1000);
    if (!Number.isFinite(t) || t <= Number(nowSeconds)) return { error: 'invalid_expires_at' };
    coupon.redeem_by = t;
    expiresAt = t;
  }

  const promo = { code };
  if (maxRedemptions != null) promo.max_redemptions = maxRedemptions;
  if (expiresAt != null) promo.expires_at = expiresAt;
  if (b.minimum_amount !== undefined && b.minimum_amount !== null && b.minimum_amount !== '') {
    const minMinor = moneyMinor(b.minimum_amount);
    if (minMinor == null) return { error: 'invalid_minimum_amount' };
    // 0 = no minimum: omit restrictions. Stripe rejects a minimum_amount of 0.
    if (minMinor > 0) promo.restrictions = { minimum_amount: minMinor, minimum_amount_currency: currency };
  }

  return { coupon, promo };
}
