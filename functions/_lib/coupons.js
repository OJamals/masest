// Pure builder for Stripe coupon + promotion-code params from an admin create request (#97).
// Returns { error } on invalid input, else { coupon, promo } objects for the Stripe SDK.
// Money inputs are dollars (converted to integer minor units here).
export function buildCouponParams(body) {
  const b = body || {};
  const code = String(b.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9._-]{3,40}$/.test(code)) return { error: 'invalid_code' };

  const currency = String(b.currency || 'usd').toLowerCase();
  const coupon = { duration: 'once' };

  const hasPercent = b.percent_off !== undefined && b.percent_off !== null && b.percent_off !== '';
  const hasAmount = b.amount_off !== undefined && b.amount_off !== null && b.amount_off !== '';
  if (hasPercent) {
    const percent = Number(b.percent_off);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return { error: 'invalid_percent' };
    coupon.percent_off = percent;
  } else if (hasAmount) {
    const amount = Number(b.amount_off);
    if (!Number.isFinite(amount) || amount <= 0) return { error: 'invalid_amount' };
    coupon.amount_off = Math.round(amount * 100);
    coupon.currency = currency;
  } else {
    return { error: 'discount_required' };
  }

  let maxRedemptions = null;
  if (b.max_redemptions !== undefined && b.max_redemptions !== null && b.max_redemptions !== '') {
    maxRedemptions = Number(b.max_redemptions);
    if (!Number.isInteger(maxRedemptions) || maxRedemptions < 1) return { error: 'invalid_max_redemptions' };
    coupon.max_redemptions = maxRedemptions;
  }

  let expiresAt = null;
  if (b.expires_at) {
    const t = Math.floor(new Date(b.expires_at).getTime() / 1000);
    if (!Number.isFinite(t)) return { error: 'invalid_expires_at' };
    coupon.redeem_by = t;
    expiresAt = t;
  }

  const promo = { code };
  if (maxRedemptions != null) promo.max_redemptions = maxRedemptions;
  if (expiresAt != null) promo.expires_at = expiresAt;
  if (b.minimum_amount !== undefined && b.minimum_amount !== null && b.minimum_amount !== '') {
    const min = Number(b.minimum_amount);
    if (!Number.isFinite(min) || min < 0) return { error: 'invalid_minimum_amount' };
    promo.restrictions = { minimum_amount: Math.round(min * 100), minimum_amount_currency: currency };
  }

  return { coupon, promo };
}
