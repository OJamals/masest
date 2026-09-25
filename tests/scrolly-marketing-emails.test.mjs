import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  NURTURE_FLOW_EMAILS,
  SCROLLY_MARKETING_EMAILS,
  findScrollyMarketingEmail,
  renderAllNurtureFlowEmails,
  renderAllScrollyMarketingEmails,
  renderScrollyMarketingEmail,
} from '../functions/_lib/scrolly-marketing-emails.js';

test('proof series follows the six landing-page scenes in order', () => {
  assert.deepEqual(
    SCROLLY_MARKETING_EMAILS.map(({ id, sequence, heading }) => ({ id, sequence, heading })),
    [
      { id: 'industrial-strength', sequence: 1, heading: 'Industrial strength. Better chemistry.' },
      { id: 'outperform', sequence: 2, heading: 'Built to outperform traditional cleaners.' },
      { id: 'hmis-000', sequence: 3, heading: 'Industrial results. HMIS 0-0-0.' },
      { id: 'whole-job-cost', sequence: 4, heading: 'Less expensive by the finished job.' },
      { id: 'right-formula', sequence: 5, heading: 'The right strength for the soil.' },
      { id: 'prove-it', sequence: 6, heading: 'Put both cleaners on the same job.' },
    ],
  );
  assert.equal(findScrollyMarketingEmail('missing'), null);
});

test('proof series uses twelve unique email-compatible R2 images and no Supabase media', () => {
  const urls = SCROLLY_MARKETING_EMAILS.flatMap(({ proof }) => [proof.before, proof.after]);
  assert.equal(new Set(urls).size, 12);
  for (const url of urls) {
    assert.match(url, /^https:\/\/media\.masest\.co\/site\/img\/proof\/story\/.+-aligned-202609\.jpg$/);
    assert.doesNotMatch(url, /supabase/i);
  }
});

test('one canonical registry keeps homepage scenes and email proof data aligned', async () => {
  const registry = JSON.parse(await readFile(new URL('../data/story-scenes.json', import.meta.url), 'utf8'));
  const homepage = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const emailSource = await readFile(new URL('../functions/_lib/scrolly-marketing-emails.js', import.meta.url), 'utf8');

  assert.equal(registry.version, 1);
  assert.equal(registry.scenes.length, 6);
  assert.match(emailSource, /story-scenes\.json/);
  assert.doesNotMatch(emailSource, /-aligned-202609\.(?:webp|jpg)/);

  for (const scene of registry.scenes) {
    const start = homepage.indexOf(`id="${scene.anchor}"`);
    const next = homepage.indexOf(`id="story-scene-${scene.sequence + 1}"`, start);
    const section = homepage.slice(start, next < 0 ? homepage.length : next);
    const campaign = findScrollyMarketingEmail(scene.id);
    const webBefore = `/site/img/proof/story/${scene.proof.slug}-before-aligned-202609.webp`;
    const webAfter = `/site/img/proof/story/${scene.proof.slug}-after-aligned-202609.webp`;

    assert.ok(start >= 0, `${scene.id} missing homepage anchor`);
    assert.ok(section.includes(scene.heading), `${scene.id} heading drifted`);
    assert.ok(section.includes(`data-product-name="${scene.productName}"`), `${scene.id} product drifted`);
    assert.ok(section.includes(webBefore), `${scene.id} before image drifted`);
    assert.ok(section.includes(webAfter), `${scene.id} after image drifted`);
    assert.equal(campaign.sequence, scene.sequence);
    assert.equal(campaign.heading, scene.heading);
    assert.equal(campaign.proof.label, scene.proof.label);
    assert.match(campaign.proof.before, new RegExp(`${scene.proof.slug}-before-aligned-202609\\.jpg$`));
    assert.match(campaign.proof.after, new RegExp(`${scene.proof.slug}-after-aligned-202609\\.jpg$`));
  }
});

test('every email proof URL has a real JPEG source asset', async () => {
  const registry = JSON.parse(await readFile(new URL('../data/story-scenes.json', import.meta.url), 'utf8'));
  for (const scene of registry.scenes) {
    for (const side of ['before', 'after']) {
      const asset = new URL(`../img/proof/story/${scene.proof.slug}-${side}-aligned-202609.jpg`, import.meta.url);
      const bytes = await readFile(asset);
      assert.deepEqual([...bytes.subarray(0, 3)], [0xff, 0xd8, 0xff], `${scene.id} ${side} is not JPEG`);
    }
  }
});

test('rendered SES templates are static, accessible, and unsubscribe-safe', () => {
  const rendered = renderAllScrollyMarketingEmails();
  assert.equal(rendered.length, 6);
  for (const campaign of rendered) {
    assert.match(campaign.html, /\{\{unsubscribe_url\}\}/);
    assert.match(campaign.html, /Advertisement\./);
    assert.match(campaign.html, />Before<\/td>/);
    assert.match(campaign.html, />After<\/td>/);
    assert.match(campaign.html, /Open the aligned before-and-after/);
    // Evidence now lands on the /proof card, not a homepage anchor: the story that hosted
    // #story-scene-N is being retired, and mail already delivered has to keep working.
    assert.match(campaign.html, /https:\/\/masest\.co\/proof#[a-z0-9-]+/);
    assert.doesNotMatch(campaign.html, /#story-scene-/);
    assert.equal((campaign.html.match(/img\/proof\/story\//g) || []).length, 2);
    assert.doesNotMatch(campaign.html, /<script\b|type="range"|draggable/i);
    assert.doesNotMatch(campaign.html, /supabase/i);
    assert.match(campaign.text, /Before: https:\/\/media\.masest\.co\//);
    assert.match(campaign.text, /After: https:\/\/media\.masest\.co\//);
  }
});

test('plain-text proof evidence stays readable and before the legal footer', () => {
  const rendered = [
    ...renderAllScrollyMarketingEmails(),
    ...renderAllNurtureFlowEmails(),
  ];

  for (const campaign of rendered) {
    const lastEvidence = campaign.text.lastIndexOf('Open the aligned before-and-after:');
    const browserLink = campaign.text.indexOf('View in browser:');
    const legalFooter = campaign.text.indexOf('Advertisement.');

    assert.ok(lastEvidence >= 0, `${campaign.id} missing proof evidence`);
    assert.ok(lastEvidence < browserLink, `${campaign.id} proof follows browser/footer links`);
    assert.ok(browserLink < legalFooter, `${campaign.id} legal footer order changed`);
    assert.doesNotMatch(campaign.text, /&(?:rarr|nbsp|amp|lt|gt|quot);/i);
    assert.doesNotMatch(campaign.text, /^\s{4,}\S/m);
  }
});

test('HMIS email keeps qualification language and task controls', () => {
  const campaign = renderScrollyMarketingEmail('hmis-000');
  assert.match(campaign.html, /Every VertKleen product MASEST offers is rated 0-0-0/);
  assert.match(campaign.html, /Read the current label and SDS/);
  assert.match(campaign.html, /PPE and controls required for the task/);
});

test('campaign prose stays concise for email reading', () => {
  for (const campaign of SCROLLY_MARKETING_EMAILS) {
    assert.ok(campaign.subject.length <= 60, `${campaign.id} subject too long`);
    assert.ok(campaign.previewText.length <= 120, `${campaign.id} preview too long`);
    for (const paragraph of campaign.paragraphs) {
      assert.ok(paragraph.length <= 240, `${campaign.id} paragraph too long: ${paragraph.length}`);
    }
  }
});

test('unknown proof-series id fails closed', () => {
  assert.throws(() => renderScrollyMarketingEmail('missing'), /scrolly_marketing_email_not_found/);
});

test('three nurture emails cover all six proof scenes without changing flow cadence', () => {
  assert.deepEqual(
    NURTURE_FLOW_EMAILS.map(({ id, flowSlot, sceneIds }) => ({ id, flowSlot, sceneIds })),
    [
      { id: 'strength-hmis', flowSlot: 1, sceneIds: ['industrial-strength', 'hmis-000'] },
      { id: 'compare-match', flowSlot: 2, sceneIds: ['outperform', 'right-formula'] },
      { id: 'cost-trial', flowSlot: 3, sceneIds: ['whole-job-cost', 'prove-it'] },
    ],
  );
  assert.deepEqual(
    NURTURE_FLOW_EMAILS.flatMap(({ sceneIds }) => sceneIds).sort(),
    SCROLLY_MARKETING_EMAILS.map(({ id }) => id).sort(),
  );
});

test('queue-ready nurture templates use every aligned R2 pair with no accent lines', () => {
  const rendered = renderAllNurtureFlowEmails();
  assert.equal(rendered.length, 3);
  assert.equal(new Set(rendered.flatMap(({ sceneIds }) => sceneIds)).size, 6);
  for (const campaign of rendered) {
    assert.equal((campaign.html.match(/img\/proof\/story\//g) || []).length, 4);
    assert.match(campaign.html, /Hi there,/);
    assert.match(campaign.html, /\{\{unsubscribe_url\}\}/);
    assert.doesNotMatch(campaign.html, /<hr\b|border(?:-top|-right|-bottom|-left)?:[1-9]|padding:0 1px/i);
    assert.doesNotMatch(campaign.html, /safety of water|without the hazard profile|minus the hazard profile/i);
  }
});
