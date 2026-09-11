import { renderMarketingEmail } from './email-renderers.js';
import { emailEscape } from './email-template.js';
import storyRegistry from '../../data/story-scenes.json' with { type: 'json' };

const SITE = 'https://masest.co';
const STORY_MEDIA = 'https://media.masest.co/site/img/proof/story';
const STORY_EMAIL_IMAGE_SUFFIX = 'aligned-202609.jpg';
const STORY_SCENES = new Map(storyRegistry.scenes.map((scene) => [scene.id, scene]));

const email = (sceneId, value) => {
  const scene = STORY_SCENES.get(sceneId);
  if (!scene) throw new Error(`story_scene_not_found:${sceneId}`);
  return Object.freeze({
    ...value,
    id: scene.id,
    sequence: scene.sequence,
    heading: scene.heading,
    paragraphs: Object.freeze([...value.paragraphs]),
    proof: Object.freeze({
      ...scene.proof,
      before: `${STORY_MEDIA}/${scene.proof.slug}-before-${STORY_EMAIL_IMAGE_SUFFIX}`,
      after: `${STORY_MEDIA}/${scene.proof.slug}-after-${STORY_EMAIL_IMAGE_SUFFIX}`,
    }),
    // Points at the /proof card, not a homepage anchor: the homepage story that once
    // hosted #story-scene-N is being retired, and mail already delivered keeps working
    // only if the destination outlives it. Two scenes map to proof cards that predate
    // them under different slugs, so the anchor is recorded per scene rather than
    // derived from proof.slug.
    evidenceUrl: `${SITE}/proof#${scene.proofAnchor}`,
  });
};

export const SCROLLY_MARKETING_EMAILS = Object.freeze([
  email('industrial-strength', {
    templateName: 'MASEST Proof Series 01 · Industrial strength',
    subject: 'Industrial strength, without the old chemistry',
    previewText: 'See what VertKleen removes—and how cleanly the surface comes back.',
    eyebrow: '01 · Industrial cleaning strength',
    paragraphs: [
      'Industrial cleaning should be judged by what leaves the surface—not how harsh the drum looks. VertKleen targets scale, rust, grease, oxidation, and organic buildup with focused chemistry built for field work.',
      'This commercial-kitchen result moves from baked-on grease to exposed stainless with VertKleen CRHD. Same seam. Same grease line. One aligned view.',
    ],
    evidenceText: 'Open the aligned before-and-after',
    ctaText: 'Match a cleaner to my job',
    ctaUrl: `${SITE}/contact?type=audit`,
  }),
  email('outperform', {
    templateName: 'MASEST Proof Series 02 · Outperform',
    subject: 'Put VertKleen beside the cleaner you use now',
    previewText: 'Same job. Same tools. Compare removal, passes, rinse, and return to service.',
    eyebrow: '02 · More effective',
    paragraphs: [
      'Claims matter less than a controlled side-by-side. Hold surface, soil, dilution, contact time, and tools constant. Compare what remains—and how much work it took to get there.',
      'In this CIP vessel, VertKleen CR removes the residue field and returns the interior to reflective steel. Same vessel geometry. Clear finished-surface proof.',
    ],
    evidenceText: 'Open the aligned before-and-after',
    ctaText: 'Plan a side-by-side trial',
    ctaUrl: `${SITE}/contact?type=sample&product=VertKleen%20CR`,
  }),
  email('hmis-000', {
    templateName: 'MASEST Proof Series 03 · HMIS 0-0-0',
    subject: 'Industrial results. HMIS 0-0-0.',
    previewText: 'Every VertKleen product MASEST offers is HMIS 0-0-0 in its current product documents.',
    eyebrow: '03 · HMIS 0-0-0',
    paragraphs: [
      'Every VertKleen product MASEST offers is rated 0-0-0 for health, flammability, and physical hazard in its current product documents.',
      'HMIS supports product qualification; it does not replace job planning. Read the current label and SDS, then use the PPE and controls required for the task.',
      'At LaBelle, VertKleen CR clears the fermenter wall ring while the vessel curve and port stay registered across both frames.',
    ],
    evidenceText: 'Open the aligned before-and-after',
    ctaText: 'Review product documents',
    ctaUrl: `${SITE}/resources`,
  }),
  email('whole-job-cost', {
    templateName: 'MASEST Proof Series 04 · Whole-job cost',
    subject: 'Price the finished job—not the gallon',
    previewText: 'Count chemical, labor, water, waste, repeat passes, and downtime.',
    eyebrow: '04 · Lower whole-job cost',
    paragraphs: [
      'Shelf price is one line item. Total cost also includes dilution, passes, labor, water, waste, rework, and the time equipment stays out of service.',
      'VertKleen concentrates can lower cost when more soil leaves in fewer passes. Track the full job side by side. Keep the cleaner that produces the better result for less.',
      'Here, VertKleen Descaler clears the concentrated orange calcium line while the glass edge and lower track stay aligned.',
    ],
    evidenceText: 'Open the aligned before-and-after',
    ctaText: 'Compare my whole-job cost',
    ctaUrl: `${SITE}/contact?type=quote`,
  }),
  email('right-formula', {
    templateName: 'MASEST Proof Series 05 · Right formula',
    subject: 'Use the right strength for the soil',
    previewText: 'Focused formulas for minerals, rust, grease, organics, oxidation, and water equipment.',
    eyebrow: '05 · Purpose-built range',
    paragraphs: [
      'Minerals, rust, grease, organics, oxidation, and fouled water equipment are different problems. VertKleen offers focused formulas instead of asking one generic cleaner to do every job.',
      'Crews can standardize on one HMIS 0-0-0 line while still matching chemistry to the soil and surface in front of them.',
      'On this airboat, fixed fasteners and the panel edge anchor the view while VertKleen AlumiBrite restores the brighter aluminum finish.',
    ],
    evidenceText: 'Open the aligned before-and-after',
    ctaText: 'Find my cleaner',
    ctaUrl: `${SITE}/contact?type=audit`,
  }),
  email('prove-it', {
    templateName: 'MASEST Proof Series 06 · Prove it',
    subject: 'Prove the switch on your own job',
    previewText: 'Your surface. Your soil. Your crew. One controlled side-by-side.',
    eyebrow: '06 · Prove the switch',
    paragraphs: [
      'No staged demo should make the decision. Use your surface, soil, crew, tools, and operating limits. MASEST will help scope a matched trial.',
      'Record removal, passes, labor, water, rinse, and downtime. Keep VertKleen only if it wins the finished job.',
      'This pool cartridge stays registered by its cap, bands, and pleat pattern while VertKleen HCR clears the dark mineral fouling.',
    ],
    evidenceText: 'Open the aligned before-and-after',
    ctaText: 'Request a sample or trial',
    ctaUrl: `${SITE}/contact?type=sample&product=VertKleen%20HCR`,
  }),
]);

const nurtureEmail = (value) => Object.freeze({
  ...value,
  paragraphs: Object.freeze([...value.paragraphs]),
  sceneIds: Object.freeze([...value.sceneIds]),
});

export const NURTURE_FLOW_EMAILS = Object.freeze([
  nurtureEmail({
    id: 'strength-hmis',
    flowSlot: 1,
    templateName: 'MASEST Nurture 01 · Strength + HMIS 0-0-0',
    subject: 'Industrial strength. HMIS 0-0-0.',
    previewText: 'Purpose-built VertKleen chemistry, aligned field proof, and current product-document ratings.',
    heading: 'Industrial strength. Better chemistry.',
    eyebrow: 'Proof series · 1 of 3',
    paragraphs: [
      'Industrial cleaning should be judged by what leaves the surface—not how harsh the drum looks. VertKleen targets scale, rust, grease, oxidation, and organic buildup with focused chemistry built for field work.',
      'Every VertKleen product MASEST offers is rated HMIS 0-0-0 in its current product documents. HMIS supports product qualification; read the current label and SDS, then use the PPE and controls required for the task.',
    ],
    sceneIds: ['industrial-strength', 'hmis-000'],
    ctaText: 'Match a cleaner to my job',
    ctaUrl: `${SITE}/contact?type=audit&utm_source=masest&utm_medium=email&utm_campaign=nurture_proof`,
  }),
  nurtureEmail({
    id: 'compare-match',
    flowSlot: 2,
    templateName: 'MASEST Nurture 02 · Compare + match',
    subject: 'Put VertKleen beside your current cleaner',
    previewText: 'Hold the job constant. Compare removal, passes, rinse, and return to service.',
    heading: 'Compare the finished result.',
    eyebrow: 'Proof series · 2 of 3',
    paragraphs: [
      'Claims matter less than a controlled side-by-side. Hold surface, soil, dilution, contact time, and tools constant. Compare what remains—and how much work it took to get there.',
      'Minerals, rust, grease, organics, oxidation, and fouled water equipment are different problems. VertKleen uses focused formulas so crews can match chemistry to the soil and surface instead of forcing one generic cleaner onto every job.',
    ],
    sceneIds: ['outperform', 'right-formula'],
    ctaText: 'Plan a side-by-side trial',
    ctaUrl: `${SITE}/contact?type=sample&utm_source=masest&utm_medium=email&utm_campaign=nurture_proof`,
  }),
  nurtureEmail({
    id: 'cost-trial',
    flowSlot: 3,
    templateName: 'MASEST Nurture 03 · Whole-job proof',
    subject: 'Price the finished job—not the gallon',
    previewText: 'Count chemical, labor, water, waste, repeat passes, and downtime—then prove the switch.',
    heading: 'Prove the better finished-job cost.',
    eyebrow: 'Proof series · 3 of 3',
    paragraphs: [
      'Shelf price is one line item. Total cost also includes dilution, passes, labor, water, waste, rework, and the time equipment stays out of service.',
      'Use your surface, soil, crew, tools, and operating limits. Record removal, passes, labor, water, rinse, and downtime. Keep VertKleen only if it produces the better finished job for less.',
    ],
    sceneIds: ['whole-job-cost', 'prove-it'],
    ctaText: 'Scope my controlled trial',
    ctaUrl: `${SITE}/contact?type=sample&utm_source=masest&utm_medium=email&utm_campaign=nurture_proof`,
  }),
]);

function proofPair(proof) {
  return `<div style="margin:24px 0 18px;border-radius:14px;overflow:hidden;background:#eef3f3">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;table-layout:fixed;border-collapse:collapse">
      <tr>
        <td width="50%" style="width:50%;padding:0;vertical-align:top">
          <img src="${emailEscape(proof.before)}" alt="${emailEscape(proof.beforeAlt)}" width="275" style="display:block;width:100%;height:auto;border:0">
        </td>
        <td width="50%" style="width:50%;padding:0;vertical-align:top">
          <img src="${emailEscape(proof.after)}" alt="${emailEscape(proof.afterAlt)}" width="275" style="display:block;width:100%;height:auto;border:0">
        </td>
      </tr>
      <tr>
        <td style="padding:8px 10px;color:#66737c;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase">Before</td>
        <td style="padding:8px 10px;color:#0e7c86;font-size:11px;font-weight:800;letter-spacing:.08em;text-align:right;text-transform:uppercase">After</td>
      </tr>
    </table>
    <div style="padding:0 10px 10px;color:#4f5e68;font-size:12px;line-height:1.45">${emailEscape(proof.label)}</div>
  </div>`;
}

export function findScrollyMarketingEmail(id) {
  return SCROLLY_MARKETING_EMAILS.find((item) => item.id === String(id || '')) || null;
}

export function renderScrollyMarketingEmail(id) {
  const campaign = findScrollyMarketingEmail(id);
  if (!campaign) throw new Error('scrolly_marketing_email_not_found');

  const paragraphs = campaign.paragraphs
    .map((paragraph) => `<p style="margin:0 0 14px">${emailEscape(paragraph)}</p>`)
    .join('');
  const bodyHtml = `${paragraphs}
    ${proofPair(campaign.proof)}
    <p style="margin:0"><a href="${emailEscape(campaign.evidenceUrl)}" style="color:#0e7c86;font-weight:800;text-decoration:none">${emailEscape(campaign.evidenceText)} &rarr;</a></p>`;
  const bodyText = [
    ...campaign.paragraphs,
    '',
    campaign.proof.label,
    `Before: ${campaign.proof.before}`,
    `After: ${campaign.proof.after}`,
    `${campaign.evidenceText}: ${campaign.evidenceUrl}`,
  ].join('\n');
  const rendered = renderMarketingEmail({
    kind: 'product',
    campaign: {
      subject: campaign.subject,
      heading: campaign.heading,
      previewText: campaign.previewText,
      eyebrow: campaign.eyebrow,
      bodyHtml,
      bodyText,
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
  };
}

export function renderAllScrollyMarketingEmails() {
  return SCROLLY_MARKETING_EMAILS.map(({ id }) => renderScrollyMarketingEmail(id));
}

export function renderNurtureFlowEmail(id) {
  const campaign = NURTURE_FLOW_EMAILS.find((item) => item.id === String(id || ''));
  if (!campaign) throw new Error('nurture_flow_email_not_found');

  const scenes = campaign.sceneIds.map((sceneId) => findScrollyMarketingEmail(sceneId));
  const paragraphs = campaign.paragraphs
    .map((paragraph) => `<p style="margin:0 0 14px">${emailEscape(paragraph)}</p>`)
    .join('');
  const proofs = scenes.map((scene) => `${proofPair(scene.proof)}
    <p style="margin:0 0 20px"><a href="${emailEscape(scene.evidenceUrl)}" style="color:#0e7c86;font-weight:800;text-decoration:none">${emailEscape(scene.evidenceText)} &rarr;</a></p>`).join('');
  const bodyHtml = `<p style="margin:0 0 14px">Hi there,</p>${paragraphs}${proofs}`;
  const bodyText = [
    'Hi there,',
    '',
    ...campaign.paragraphs,
    '',
    ...scenes.flatMap((scene) => [
      scene.proof.label,
      `Before: ${scene.proof.before}`,
      `After: ${scene.proof.after}`,
      `${scene.evidenceText}: ${scene.evidenceUrl}`,
      '',
    ]),
  ].join('\n').trim();
  const rendered = renderMarketingEmail({
    kind: 'product',
    campaign: {
      subject: campaign.subject,
      heading: campaign.heading,
      previewText: campaign.previewText,
      eyebrow: campaign.eyebrow,
      bodyHtml,
      bodyText,
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
    flowSlot: campaign.flowSlot,
    sceneIds: campaign.sceneIds,
    templateName: campaign.templateName,
  };
}

export function renderAllNurtureFlowEmails() {
  return NURTURE_FLOW_EMAILS.map(({ id }) => renderNurtureFlowEmail(id));
}
