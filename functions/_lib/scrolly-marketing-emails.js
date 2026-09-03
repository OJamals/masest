import { renderMarketingEmail } from './email-renderers.js';

const SITE = 'https://masest.co';
const STORY_MEDIA = 'https://media.masest.co/site/img/proof/story';

const email = (value) => Object.freeze({
  ...value,
  paragraphs: Object.freeze([...value.paragraphs]),
  proof: Object.freeze({ ...value.proof }),
});

export const SCROLLY_MARKETING_EMAILS = Object.freeze([
  email({
    id: 'industrial-strength',
    sequence: 1,
    templateName: 'MASEST Proof Series 01 · Industrial strength',
    subject: 'Industrial strength, without the old chemistry',
    previewText: 'See what VertKleen removes—and how cleanly the surface comes back.',
    heading: 'Industrial strength. Better chemistry.',
    eyebrow: '01 · Industrial cleaning strength',
    paragraphs: [
      'Industrial cleaning should be judged by what leaves the surface—not how harsh the drum looks. VertKleen targets scale, rust, grease, oxidation, and organic buildup with focused chemistry built for field work.',
      'This commercial-kitchen result moves from baked-on grease to exposed stainless with VertKleen CRHD. Same seam. Same grease line. One aligned view.',
    ],
    proof: {
      label: 'Commercial-kitchen grease · VertKleen CRHD',
      before: `${STORY_MEDIA}/kitchen-grease-before-aligned-202609.webp`,
      after: `${STORY_MEDIA}/kitchen-grease-after-aligned-202609.webp`,
      beforeAlt: 'Commercial-kitchen surface before VertKleen CRHD cleaning',
      afterAlt: 'Same commercial-kitchen surface after VertKleen CRHD cleaning',
    },
    evidenceText: 'Open the aligned before-and-after',
    evidenceUrl: `${SITE}/#story-scene-1`,
    ctaText: 'Match a cleaner to my job',
    ctaUrl: `${SITE}/contact?type=audit`,
  }),
  email({
    id: 'outperform',
    sequence: 2,
    templateName: 'MASEST Proof Series 02 · Outperform',
    subject: 'Put VertKleen beside the cleaner you use now',
    previewText: 'Same job. Same tools. Compare removal, passes, rinse, and return to service.',
    heading: 'Built to outperform traditional cleaners.',
    eyebrow: '02 · More effective',
    paragraphs: [
      'Claims matter less than a controlled side-by-side. Hold surface, soil, dilution, contact time, and tools constant. Compare what remains—and how much work it took to get there.',
      'In this CIP vessel, VertKleen CR removes the residue field and returns the interior to reflective steel. Same vessel geometry. Clear finished-surface proof.',
    ],
    proof: {
      label: 'CIP vessel residue · VertKleen CR',
      before: `${STORY_MEDIA}/cip-vessel-before-aligned-202609.webp`,
      after: `${STORY_MEDIA}/cip-vessel-after-aligned-202609.webp`,
      beforeAlt: 'CIP vessel before VertKleen CR cleaning',
      afterAlt: 'Same CIP vessel after VertKleen CR cleaning',
    },
    evidenceText: 'Open the aligned before-and-after',
    evidenceUrl: `${SITE}/#story-scene-2`,
    ctaText: 'Plan a side-by-side trial',
    ctaUrl: `${SITE}/contact?type=sample&product=VertKleen%20CR`,
  }),
  email({
    id: 'hmis-000',
    sequence: 3,
    templateName: 'MASEST Proof Series 03 · HMIS 0-0-0',
    subject: 'Industrial results. HMIS 0-0-0.',
    previewText: 'Every VertKleen product MASEST offers is HMIS 0-0-0 in its current product documents.',
    heading: 'Industrial results. HMIS 0-0-0.',
    eyebrow: '03 · HMIS 0-0-0',
    paragraphs: [
      'Every VertKleen product MASEST offers is rated 0-0-0 for health, flammability, and physical hazard in its current product documents.',
      'HMIS supports product qualification; it does not replace job planning. Read the current label and SDS, then use the PPE and controls required for the task.',
      'At LaBelle, VertKleen CR clears the fermenter wall ring while the vessel curve and port stay registered across both frames.',
    ],
    proof: {
      label: 'LaBelle fermenter ring · VertKleen CR',
      before: `${STORY_MEDIA}/labelle-fermenter-before-aligned-202609.webp`,
      after: `${STORY_MEDIA}/labelle-fermenter-after-aligned-202609.webp`,
      beforeAlt: 'LaBelle fermenter wall ring before VertKleen CR cleaning',
      afterAlt: 'Same LaBelle fermenter after VertKleen CR cleaning',
    },
    evidenceText: 'Open the aligned before-and-after',
    evidenceUrl: `${SITE}/#story-scene-3`,
    ctaText: 'Review product documents',
    ctaUrl: `${SITE}/resources`,
  }),
  email({
    id: 'whole-job-cost',
    sequence: 4,
    templateName: 'MASEST Proof Series 04 · Whole-job cost',
    subject: 'Price the finished job—not the gallon',
    previewText: 'Count chemical, labor, water, waste, repeat passes, and downtime.',
    heading: 'Less expensive by the finished job.',
    eyebrow: '04 · Lower whole-job cost',
    paragraphs: [
      'Shelf price is one line item. Total cost also includes dilution, passes, labor, water, waste, rework, and the time equipment stays out of service.',
      'VertKleen concentrates can lower cost when more soil leaves in fewer passes. Track the full job side by side. Keep the cleaner that produces the better result for less.',
      'Here, VertKleen Descaler clears the concentrated orange calcium line while the glass edge and lower track stay aligned.',
    ],
    proof: {
      label: 'Shower-track calcium · VertKleen Descaler',
      before: `${STORY_MEDIA}/shower-track-before-aligned-202609.webp`,
      after: `${STORY_MEDIA}/shower-track-after-aligned-202609.webp`,
      beforeAlt: 'Shower track before VertKleen Descaler cleaning',
      afterAlt: 'Same shower track after VertKleen Descaler cleaning',
    },
    evidenceText: 'Open the aligned before-and-after',
    evidenceUrl: `${SITE}/#story-scene-4`,
    ctaText: 'Compare my whole-job cost',
    ctaUrl: `${SITE}/contact?type=quote`,
  }),
  email({
    id: 'right-formula',
    sequence: 5,
    templateName: 'MASEST Proof Series 05 · Right formula',
    subject: 'Use the right strength for the soil',
    previewText: 'Focused formulas for minerals, rust, grease, organics, oxidation, and water equipment.',
    heading: 'The right strength for the soil.',
    eyebrow: '05 · Purpose-built range',
    paragraphs: [
      'Minerals, rust, grease, organics, oxidation, and fouled water equipment are different problems. VertKleen offers focused formulas instead of asking one generic cleaner to do every job.',
      'Crews can standardize on one HMIS 0-0-0 line while still matching chemistry to the soil and surface in front of them.',
      'On this airboat, fixed fasteners and the panel edge anchor the view while VertKleen AlumiBrite restores the brighter aluminum finish.',
    ],
    proof: {
      label: 'Airboat aluminum · VertKleen AlumiBrite',
      before: `${STORY_MEDIA}/airboat-panel-before-aligned-202609.webp`,
      after: `${STORY_MEDIA}/airboat-panel-after-aligned-202609.webp`,
      beforeAlt: 'Airboat aluminum panel before VertKleen AlumiBrite treatment',
      afterAlt: 'Same airboat aluminum panel after VertKleen AlumiBrite treatment',
    },
    evidenceText: 'Open the aligned before-and-after',
    evidenceUrl: `${SITE}/#story-scene-5`,
    ctaText: 'Find my cleaner',
    ctaUrl: `${SITE}/contact?type=audit`,
  }),
  email({
    id: 'prove-it',
    sequence: 6,
    templateName: 'MASEST Proof Series 06 · Prove it',
    subject: 'Prove the switch on your own job',
    previewText: 'Your surface. Your soil. Your crew. One controlled side-by-side.',
    heading: 'Put both cleaners on the same job.',
    eyebrow: '06 · Prove the switch',
    paragraphs: [
      'No staged demo should make the decision. Use your surface, soil, crew, tools, and operating limits. MASEST will help scope a matched trial.',
      'Record removal, passes, labor, water, rinse, and downtime. Keep VertKleen only if it wins the finished job.',
      'This pool cartridge stays registered by its cap, bands, and pleat pattern while VertKleen HCR clears the dark mineral fouling.',
    ],
    proof: {
      label: 'Pool cartridge filter · VertKleen HCR',
      before: `${STORY_MEDIA}/pool-cartridge-before-aligned-202609.webp`,
      after: `${STORY_MEDIA}/pool-cartridge-after-aligned-202609.webp`,
      beforeAlt: 'Pool cartridge filter before VertKleen HCR cleaning',
      afterAlt: 'Same pool cartridge filter after VertKleen HCR cleaning',
    },
    evidenceText: 'Open the aligned before-and-after',
    evidenceUrl: `${SITE}/#story-scene-6`,
    ctaText: 'Request a sample or trial',
    ctaUrl: `${SITE}/contact?type=sample&product=VertKleen%20HCR`,
  }),
]);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function proofPair(proof) {
  return `<div style="margin:24px 0 18px;border:1px solid #dce5e6;border-radius:14px;overflow:hidden;background:#eef3f3">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;table-layout:fixed;border-collapse:collapse">
      <tr>
        <td width="50%" style="width:50%;padding:0 1px 0 0;vertical-align:top">
          <img src="${escapeHtml(proof.before)}" alt="${escapeHtml(proof.beforeAlt)}" width="275" style="display:block;width:100%;height:auto;border:0">
        </td>
        <td width="50%" style="width:50%;padding:0 0 0 1px;vertical-align:top">
          <img src="${escapeHtml(proof.after)}" alt="${escapeHtml(proof.afterAlt)}" width="275" style="display:block;width:100%;height:auto;border:0">
        </td>
      </tr>
      <tr>
        <td style="padding:8px 10px;color:#66737c;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase">Before</td>
        <td style="padding:8px 10px;color:#0e7c86;font-size:11px;font-weight:800;letter-spacing:.08em;text-align:right;text-transform:uppercase">After</td>
      </tr>
    </table>
    <div style="padding:0 10px 10px;color:#4f5e68;font-size:12px;line-height:1.45">${escapeHtml(proof.label)}</div>
  </div>`;
}

export function findScrollyMarketingEmail(id) {
  return SCROLLY_MARKETING_EMAILS.find((item) => item.id === String(id || '')) || null;
}

export function renderScrollyMarketingEmail(id) {
  const campaign = findScrollyMarketingEmail(id);
  if (!campaign) throw new Error('scrolly_marketing_email_not_found');

  const paragraphs = campaign.paragraphs
    .map((paragraph) => `<p style="margin:0 0 14px">${escapeHtml(paragraph)}</p>`)
    .join('');
  const bodyHtml = `${paragraphs}
    ${proofPair(campaign.proof)}
    <p style="margin:0"><a href="${escapeHtml(campaign.evidenceUrl)}" style="color:#0e7c86;font-weight:800;text-decoration:none">${escapeHtml(campaign.evidenceText)} &rarr;</a></p>`;
  const rendered = renderMarketingEmail({
    kind: 'product',
    campaign: {
      subject: campaign.subject,
      heading: campaign.heading,
      previewText: campaign.previewText,
      eyebrow: campaign.eyebrow,
      bodyHtml,
      ctaText: campaign.ctaText,
      ctaUrl: campaign.ctaUrl,
    },
    recipientContext: {
      reason: 'You received this because you subscribed to VertKleen updates or asked MASEST for product information.',
    },
  });

  return {
    ...rendered,
    id: campaign.id,
    sequence: campaign.sequence,
    templateName: campaign.templateName,
    text: `${rendered.text}\n\nBefore: ${campaign.proof.before}\nAfter: ${campaign.proof.after}\n${campaign.evidenceText}: ${campaign.evidenceUrl}`,
  };
}

export function renderAllScrollyMarketingEmails() {
  return SCROLLY_MARKETING_EMAILS.map(({ id }) => renderScrollyMarketingEmail(id));
}
