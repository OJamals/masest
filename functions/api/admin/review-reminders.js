// functions/api/admin/review-reminders.js — secret-guarded post-delivery review nudge.
// Secret-gated automation-only route; no staff session required.
import { adminClient, json, readBody } from '../../_lib/supabase.js';
import { renderMarketingEmail } from '../../_lib/email-renderers.js';
import { materializeDeliverySource } from '../../_lib/newsletter-delivery.js';
import { enqueueMarketingDelivery } from '../../_lib/marketing-delivery-queue.js';
import { reviewToken, REMINDER_DELAY_DAYS } from '../../_lib/reviews.js';
import { timingSafeEqual } from '../../_lib/secret.js';
import { recordAutomationRun } from '../../_lib/automation-runs.js';
import { productIsPublished } from '../../_lib/product-publication.generated.js';

const reviewSecret = (env) => env.REVIEW_TOKEN_SECRET || env.EMAIL_UNSUB_SECRET || '';
const enc = encodeURIComponent;

export function reviewableItems(items) {
  const seen = new Set();
  const result = [];
  for (const item of Array.isArray(items) ? items : []) {
    const sku = String(item?.product_sku || item?.sku || '').trim().toLowerCase();
    if (!sku || seen.has(sku) || !productIsPublished(sku)) continue;
    seen.add(sku);
    result.push({ sku, name: item.name || sku });
  }
  return result;
}

export async function onRequestPost({ request, env }) {
  const body = await readBody(request);
  if (body.action !== 'sweep_due') return json(400, { error: 'bad_action' });
  if (!env.REVIEW_CRM_SECRET || !timingSafeEqual(request.headers.get('x-review-crm-secret'), env.REVIEW_CRM_SECRET)) {
    return json(401, { error: 'unauthorized' });
  }
  const batch = Math.min(100, Math.max(1, Number(body.batch) || 25));
  const appUrl = env.APP_URL || 'https://masest.co';
  const cutoffIso = new Date(Date.now() - REMINDER_DELAY_DAYS * 86400000).toISOString();

  const sb = adminClient(env);
  return recordAutomationRun(sb, 'review_reminders', async (run) => {
    // Delivered ≥10d ago, or fulfilled ≥10d ago with no delivery tracking, not yet
    // reminded, has an email. Mirrors isReminderDue()'s two eligibility branches.
    const { data: orders, error } = await sb.from('orders')
      .select('id,customer_email,tracking_status,status,shipped_at,updated_at,review_reminded_at,order_items(sku,product_sku,name)')
      .is('review_reminded_at', null)
      .not('customer_email', 'is', null)
      .or(`and(tracking_status.eq.delivered,shipped_at.lte.${cutoffIso}),and(status.eq.fulfilled,updated_at.lte.${cutoffIso})`)
      .limit(batch);
    if (error) return json(500, { error: 'load_failed' });

    let queued = 0;
    const secret = reviewSecret(env);
    for (const o of orders || []) {
      const email = String(o.customer_email || '').toLowerCase();
      const links = [];
      for (const item of reviewableItems(o.order_items)) {
        // Reviews key on the base product sku; order_items.sku is the variant sku for a
        // normal checkout. Token + link + dedupe must all use product_sku so the link
        // the buyer clicks matches what /api/reviews verifies.
        const tok = await reviewToken({ orderId: o.id, sku: item.sku, email }, secret);
        links.push({
          name: item.name,
          url: `${appUrl}/review.html?order=${enc(o.id)}&sku=${enc(item.sku)}&email=${enc(email)}&token=${tok}`,
        });
      }
      if (!links.length) {
        await sb.from('orders').update({ review_reminded_at: new Date().toISOString() }).eq('id', o.id);
        continue;
      }
      const subject = 'How did your MASEST order work out?';
      const rendered = renderMarketingEmail({
        kind: 'lead_nurture',
        campaign: {
          subject,
          heading: 'How did your order work out?',
          previewText: 'Share a quick VertKleen product review.',
          eyebrow: 'One-minute review',
          bodyHtml: '<p style="margin:0">Thanks for your recent order. A quick rating helps other buyers choose the right chemistry.</p>',
          ctaText: links.length === 1 ? `Review ${links[0].name}` : undefined,
          ctaUrl: links.length === 1 ? links[0].url : undefined,
        },
        modules: links.length > 1 ? [{
          type: 'links',
          heading: 'Review your products',
          items: links.map((link) => ({
            title: `Review ${link.name}`,
            href: link.url,
            body: 'Share your field experience.',
          })),
        }] : [],
        recipientContext: {
          reason: 'You received this one-time review request because you purchased from MASEST.',
        },
      });
      const delivery = await materializeDeliverySource(sb, {
        sourceType: 'review',
        sourceId: o.id,
        parentId: o.id,
        category: 'review_request',
        subject: rendered.subject,
        html: rendered.html,
        metadata: { order_id: o.id, review_links: links },
        emails: [email],
      });
      if (delivery.error || delivery.total !== 1) continue;
      await sb.from('orders').update({ review_reminded_at: new Date().toISOString() }).eq('id', o.id);
      queued += 1;
    }
    const wake = queued
      ? await enqueueMarketingDelivery(env, { sourceType: 'review' })
      : { ok: true, queued: false };
    run.processed = (orders || []).length;
    return json(wake.ok ? 200 : 503, {
      ok: wake.ok,
      processed: (orders || []).length,
      queued,
      ...(wake.ok ? {} : { error: wake.error, retryable: wake.retryable }),
    });
  });
}
