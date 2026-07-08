import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderNewsletterBody, renderNewsletterEmail, resolveAudience, nextRunAt, dueNewsletters,
} from '../functions/_lib/newsletter.js';

test('renderNewsletterBody: markdown constructs', () => {
  assert.match(renderNewsletterBody('# Hi'), /<h1[^>]*>Hi<\/h1>/);
  assert.match(renderNewsletterBody('**b** *i*'), /<strong>b<\/strong> <em>i<\/em>/);
  assert.match(renderNewsletterBody('- a\n- b'), /<ul><li>a<\/li><li>b<\/li><\/ul>/);
  assert.match(renderNewsletterBody('[x](https://a.co)'), /<a href="https:\/\/a\.co">x<\/a>/);
});

test('renderNewsletterBody: raw HTML passes through (staff-trusted, for alignment/layout)', () => {
  const html = renderNewsletterBody('<div style="text-align:center"><img src="x.png"></div>');
  assert.match(html, /<div style="text-align:center"><img src="x\.png"><\/div>/);
});

test('renderNewsletterEmail: subject + branded shell', () => {
  const { subject, html } = renderNewsletterEmail({ subject: 'Field Notes', body_md: 'Hello **world**' });
  assert.equal(subject, 'Field Notes');
  assert.match(html, /Field Notes/);
  assert.match(html, /<strong>world<\/strong>/);
  assert.match(html, /MASEST/); // emailLayout shell
});

test('resolveAudience: union of selected populations, deduped + lowercased', () => {
  const out = resolveAudience({
    populations: ['users', 'imported'],
    users: ['A@x.com', 'b@x.com'],
    leads: ['lead@x.com'],       // not selected -> excluded
    imported: ['b@x.com', 'c@x.com'],
  });
  assert.deepEqual(out, ['a@x.com', 'b@x.com', 'c@x.com']);
});

test('resolveAudience: drops suppressed + invalid emails', () => {
  const out = resolveAudience({
    populations: ['users'],
    users: ['keep@x.com', 'DROP@x.com', 'notanemail'],
    suppressed: ['drop@x.com'],
  });
  assert.deepEqual(out, ['keep@x.com']);
});

test('nextRunAt: recurring adds interval; once -> null', () => {
  const base = Date.parse('2026-01-01T00:00:00Z');
  assert.equal(nextRunAt({ mode: 'recurring', interval_days: 14 }, base), '2026-01-15T00:00:00.000Z');
  assert.equal(nextRunAt({ mode: 'once', send_at: 'x' }, base), null);
});

test('dueNewsletters: scheduled + next_run_at in the past', () => {
  const now = Date.parse('2026-06-01T00:00:00Z');
  const rows = [
    { id: 1, status: 'scheduled', schedule: { next_run_at: '2026-05-01T00:00:00Z' } },
    { id: 2, status: 'scheduled', schedule: { next_run_at: '2026-07-01T00:00:00Z' } },
    { id: 3, status: 'draft', schedule: { next_run_at: '2026-05-01T00:00:00Z' } },
    { id: 4, status: 'scheduled', schedule: { send_at: '2026-05-15T00:00:00Z' } },
  ];
  assert.deepEqual(dueNewsletters(rows, now).map((n) => n.id), [1, 4]);
});
