// functions/api/admin/review-reminders.js — secret-guarded post-delivery review nudge.
// Secret-gated automation-only route; no staff session required.
import { adminClient, json, readBody, sendEmail } from '../../_lib/supabase.js';
import { reviewToken, REMINDER_DELAY_DAYS } from '../../_lib/reviews.js';
import { timingSafeEqual } from '../../_lib/secret.js';
import { recordAutomationRun } from '../../_lib/automation-runs.js';

const reviewSecret = (env) => env.REVIEW_TOKEN_SECRET || env.EMAIL_UNSUB_SECRET || '';
const enc = encodeURIComponent;

function reminderHtml(links) {
  const rows = links.map((l) => `<li><a href="${l.url}">Review ${l.name}</a></li>`).join('');
  return `<p>Thanks for your recent order. How did it work out?</p>
<p>A quick rating helps other buyers — it takes under a minute:</p>
<ul>${rows}</ul>
<p style="color:#667">You're receiving this because you purchased from MASEST. This is the only reminder we'll send.</p>`;
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

    let sent = 0;
    const secret = reviewSecret(env);
    for (const o of orders || []) {
      const email = String(o.customer_email || '').toLowerCase();
      const items = Array.isArray(o.order_items) ? o.order_items : [];
      const seen = new Set();
      const links = [];
      for (const it of items) {
        // Reviews key on the base product sku; order_items.sku is the variant sku for a
        // normal checkout. Token + link + dedupe must all use product_sku so the link
        // the buyer clicks matches what /api/reviews verifies.
        const psku = it?.product_sku || it?.sku;
        if (!psku || seen.has(psku)) continue;
        seen.add(psku);
        const tok = await reviewToken({ orderId: o.id, sku: psku, email }, secret);
        links.push({
          name: it.name || psku,
          url: `${appUrl}/review.html?order=${enc(o.id)}&sku=${enc(psku)}&email=${enc(email)}&token=${tok}`,
        });
      }
      // Stamp first so a send failure or suppression never re-queues this order.
      await sb.from('orders').update({ review_reminded_at: new Date().toISOString() }).eq('id', o.id);
      if (!links.length) continue;
      // sendEmail() resolves a boolean (r.ok / false), not a { ok } object — verified
      // against _lib/supabase.js.
      const ok = await sendEmail(env, {
        to: [email], subject: 'How did your MASEST order work out?',
        html: reminderHtml(links), category: 'review_request',
        idempotencyKey: `review-reminder:${o.id}`,
      });
      if (ok) sent += 1;
    }
    run.processed = (orders || []).length;
    return json(200, { ok: true, processed: (orders || []).length, sent });
  });
}
