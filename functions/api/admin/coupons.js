// /api/admin/coupons — Stripe promotion-code management (#97). Staff-only.
//   GET                          → active promotion codes (with coupon detail)
//   POST { code, percent_off|amount_off, … } → create coupon + promotion code
//   POST { id, action:'deactivate' }         → deactivate a promotion code
import Stripe from 'stripe';
import { adminClient, requireStaff, json, readBody } from '../../_lib/supabase.js';
import { staffCanWrite } from '../../_lib/authz.js';
import { recordAudit } from '../../_lib/audit.js';
import { buildCouponParams } from '../../_lib/coupons.js';

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
    const list = await stripe.promotionCodes.list({ limit: 100, expand: ['data.coupon'] });
    return json(200, { coupons: (list.data || []).map(shapePromo) });
  }

  if (request.method === 'POST') {
    if (!staffCanWrite(role)) return json(403, { error: 'forbidden', message: 'Read-only staff cannot make changes.' });
    const sb = adminClient(env);
    const body = await readBody(request);

    if (body.action === 'deactivate') {
      if (!body.id) return json(400, { error: 'promo_id_required' });
      try {
        const promo = await stripe.promotionCodes.update(body.id, { active: false });
        await recordAudit(sb, { user, action: 'coupon.deactivate', targetType: 'coupon', targetId: body.id, detail: { code: promo.code } });
        return json(200, { ok: true, coupon: shapePromo(promo) });
      } catch (err) {
        return json(502, { error: 'stripe_error', detail: err?.message || String(err) });
      }
    }

    const built = buildCouponParams(body);
    if (built.error) return json(400, { error: built.error });
    try {
      const coupon = await stripe.coupons.create(built.coupon);
      const promo = await stripe.promotionCodes.create({ coupon: coupon.id, ...built.promo });
      await recordAudit(sb, { user, action: 'coupon.create', targetType: 'coupon', targetId: promo.id, detail: { code: promo.code, coupon_id: coupon.id } });
      return json(200, { ok: true, coupon: shapePromo({ ...promo, coupon }) });
    } catch (err) {
      return json(502, { error: 'stripe_error', detail: err?.message || String(err) });
    }
  }

  return json(405, { error: 'method_not_allowed' });
}
