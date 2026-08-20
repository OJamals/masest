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
