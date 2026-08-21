// /api/admin/coupons — Stripe promotion-code management (#97). Staff-only.
//   GET                          → active promotion codes (with coupon detail)
//   POST { code, percent_off|amount_off, … } → create coupon + promotion code
//   POST { id, action:'deactivate' }         → deactivate a promotion code
import Stripe from 'stripe';
import { adminClient, requireStaff, json } from '../../_lib/supabase.js';
import { staffCan } from '../../_lib/authz.js';
import { recordAudit } from '../../_lib/audit.js';
import {
  buildCouponParams,
  normalizePromotionId,
  promotionListParams,
} from '../../_lib/coupons.js';
import { RequestBodyTooLargeError, readBoundedJson } from '../../_lib/request-body.js';

const BODY_LIMIT = 8 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function shapePromo(p) {
  const c = p.coupon || {};
  return {
    id: p.id, code: p.code, active: p.active,
    percent_off: c.percent_off ?? null,
    amount_off: c.amount_off != null ? c.amount_off / 100 : null,
    currency: c.currency || null,
    max_redemptions: p.max_redemptions ?? null,
    times_redeemed: p.times_redeemed ?? 0,
    expires_at: p.expires_at ?? null,
    minimum_amount: p.restrictions?.minimum_amount != null ? p.restrictions.minimum_amount / 100 : null,
  };
}

export async function onRequest({ request, env }) {
  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });

  const secret = env.STRIPE_SECRET_KEY;
  if (!secret) return json(500, { error: 'stripe_not_configured' });
  const stripe = new Stripe(secret, { httpClient: Stripe.createFetchHttpClient() });

  if (request.method === 'GET') {
    const listed = promotionListParams(request.url);
    if (listed.error) return json(400, { error: listed.error });
    try {
      const list = await stripe.promotionCodes.list(listed.params);
      const promotions = list.data || [];
      const nextCursor = list.has_more ? promotions.at(-1)?.id || null : null;
      return json(200, {
        coupons: promotions.map(shapePromo),
        has_more: Boolean(nextCursor),
        next_cursor: nextCursor,
      });
    } catch {
      return json(502, { error: 'stripe_error' });
    }
  }

  if (request.method === 'POST') {
    if (!staffCan(role, 'promotion.write')) {
      return json(403, { error: 'forbidden', message: 'Finance or owner access is required.' });
    }
    let body;
    try {
      body = await readBoundedJson(request, BODY_LIMIT);
    } catch (error) {
      return json(error instanceof RequestBodyTooLargeError ? 413 : 400, {
        error: error instanceof RequestBodyTooLargeError ? 'request_too_large' : 'bad_request',
      });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return json(400, { error: 'bad_request' });
    }
    const sb = adminClient(env);

    if (body.action === 'deactivate') {
      const promotionId = normalizePromotionId(body.id);
      if (!promotionId) return json(400, { error: 'invalid_promo_id' });
      try {
        const promo = await stripe.promotionCodes.update(promotionId, { active: false });
        await recordAudit(sb, { user, action: 'coupon.deactivate', targetType: 'coupon', targetId: promotionId, detail: { code: promo.code } });
        return json(200, { ok: true, coupon: shapePromo(promo) });
      } catch {
        return json(502, { error: 'stripe_error' });
      }
    }

    const built = buildCouponParams(body);
    if (built.error) return json(400, { error: built.error });
    const requestId = String(body.request_id || '').trim().toLowerCase();
    if (!UUID.test(requestId)) return json(400, { error: 'invalid_request_id' });
    try {
      const coupon = await stripe.coupons.create(built.coupon, {
        idempotencyKey: `promotion-coupon:${requestId}`,
      });
      const promo = await stripe.promotionCodes.create({ coupon: coupon.id, ...built.promo }, {
        idempotencyKey: `promotion-code:${requestId}`,
      });
      await recordAudit(sb, {
        user,
        action: 'coupon.create',
        targetType: 'coupon',
        targetId: promo.id,
        detail: { code: promo.code, coupon_id: coupon.id, request_id: requestId },
      });
      return json(200, { ok: true, coupon: shapePromo({ ...promo, coupon }) });
    } catch {
      return json(502, { error: 'stripe_error' });
    }
  }

  return json(405, { error: 'method_not_allowed' });
}
