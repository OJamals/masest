import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SCROLLY_MARKETING_EMAILS,
  findScrollyMarketingEmail,
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

test('proof series uses twelve unique aligned R2 images and no Supabase media', () => {
  const urls = SCROLLY_MARKETING_EMAILS.flatMap(({ proof }) => [proof.before, proof.after]);
  assert.equal(new Set(urls).size, 12);
  for (const url of urls) {
    assert.match(url, /^https:\/\/media\.masest\.co\/site\/img\/proof\/story\/.+-aligned-202609\.webp$/);
    assert.doesNotMatch(url, /supabase/i);
  }
});

test('rendered Klaviyo templates are static, accessible, and unsubscribe-safe', () => {
  const rendered = renderAllScrollyMarketingEmails();
  assert.equal(rendered.length, 6);
  for (const campaign of rendered) {
    assert.match(campaign.html, /\{% unsubscribe_link %\}/);
    assert.match(campaign.html, /Advertisement\./);
    assert.match(campaign.html, />Before<\/td>/);
    assert.match(campaign.html, />After<\/td>/);
    assert.match(campaign.html, /Open the aligned before-and-after/);
    assert.match(campaign.html, /#story-scene-[1-6]/);
    assert.equal((campaign.html.match(/img\/proof\/story\//g) || []).length, 2);
    assert.doesNotMatch(campaign.html, /<script\b|type="range"|draggable/i);
    assert.doesNotMatch(campaign.html, /supabase/i);
    assert.match(campaign.text, /Before: https:\/\/media\.masest\.co\//);
    assert.match(campaign.text, /After: https:\/\/media\.masest\.co\//);
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
