import assert from 'node:assert/strict';
import test from 'node:test';
import { emailLayout } from '../functions/_lib/email-template.js';

test('transactional shell uses official MASEST identity + required-email notice', () => {
  const html = emailLayout({
    heading: 'Order confirmed',
    preheader: 'Order 123 is confirmed',
    bodyHtml: '<p>Ready.</p>',
    ctaText: 'View order',
    ctaUrl: 'https://masest.co/dashboard.html#orders',
  });
  assert.match(html, /https:\/\/media\.masest\.co\/site\/img\/masest-logo\.png/);
  assert.match(html, /VertKleen/);
  assert.match(html, /Required service email/);
  assert.match(html, /Order 123 is confirmed/);
  assert.match(html, /View order/);
  assert.doesNotMatch(html, /\{% unsubscribe %\}/);
});

test('marketing shell uses same design + Klaviyo unsubscribe and preference links', () => {
  const html = emailLayout({
    stream: 'marketing',
    heading: 'Field notes',
    bodyHtml: '<p>New guide.</p>',
  });
  assert.match(html, /https:\/\/media\.masest\.co\/site\/img\/masest-logo\.png/);
  assert.match(html, /\{% unsubscribe %\}/);
  assert.match(html, /dashboard\.html#notifications/);
  assert.doesNotMatch(html, /Required service email/);
});

test('email shell blocks unsafe CTA protocols', () => {
  const html = emailLayout({ ctaText: 'Bad', ctaUrl: 'javascript:alert(1)' });
  assert.doesNotMatch(html, />Bad<\/a>/);
});
