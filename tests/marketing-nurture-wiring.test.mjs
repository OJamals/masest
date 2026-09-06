import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('newsletter signup writes canonical local consent', () => {
  const source = read('functions/api/newsletter.js');
  assert.match(source, /from\s+['"]\.\.\/_lib\/marketing-subscribers\.js['"]/);
  assert.match(source, /setMarketingPreference\(/);
  assert.match(source, /source: properties\.source \|\| 'footer_newsletter'/);
  assert.doesNotMatch(source, /klaviyo/i);
});

test('quote nurture is consent-gated and starts only after durable intake', () => {
  const source = read('functions/api/quote.js');
  const effects = read('functions/_lib/integration-effects.js');
  const quoteEmail = read('functions/_lib/quote-intake-effects.js');
  const migration = read('supabase/migrate-durable-support-message-effects-2026-09-05.sql');
  assert.match(source, /save_quote_intake/);
  assert.match(source, /assert_email_effects_ready/);
  assert.doesNotMatch(source, /sendEmail|enrollMarketingNurture/);
  assert.match(effects, /quote_intake_email/);
  assert.match(effects, /quote_nurture_enrollment/);
  assert.match(effects, /deliverQuoteIntakeEmail/);
  assert.match(effects, /enrollMarketingNurture/);
  assert.match(quoteEmail, /category:\s*'lead_internal'/);
  assert.match(quoteEmail, /category:\s*'lead_autoreply'/);
  assert.match(migration, /quotes_intake_email_effect/);
  assert.match(migration, /marketing_email_enabled/);
});

test('newsletter.html is wired to shared signup', () => {
  const html = read('newsletter.html');
  assert.match(html, /<input[^>]*type="email"/);
  assert.match(html, /subscribeNewsletter\(/);
  assert.match(html, /js\/main\.js/);
  assert.match(html, /name="company"/);
  assert.match(html, /rel="canonical" href="https:\/\/masest\.co\/newsletter"/);
});

test('sitemap lists newsletter page', () => {
  assert.match(read('sitemap.xml'), /<loc>https:\/\/masest\.co\/newsletter<\/loc>/);
});
