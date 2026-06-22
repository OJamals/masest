// Security hardening (issues #11, #14, #16).
//   #11 — profiles_self_update RLS gains a WITH CHECK that blocks is_staff / role
//         self-escalation (migration artifact).
//   #14 — rate-limit the authenticated email-sending mutations (team invite, support
//         message) so a single account can't email-bomb / enumerate.
//   #16 — client safeUrl() strips dangerous URL schemes before they reach href/src,
//         closing the javascript:/data: XSS path through admin/user-editable fields.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { safeUrl } from '../js/util.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// ---- #16: safeUrl (pure, executed for real) ----
test('safeUrl passes through http(s), mailto, and relative URLs unchanged', () => {
  assert.equal(safeUrl('https://masest.co/x'), 'https://masest.co/x');
  assert.equal(safeUrl('http://x.com'), 'http://x.com');
  assert.equal(safeUrl('mailto:a@b.com'), 'mailto:a@b.com');
  assert.equal(safeUrl('/dashboard.html#orders'), '/dashboard.html#orders');
  assert.equal(safeUrl('business.html'), 'business.html');
  assert.equal(safeUrl('#overview'), '#overview');
});

test('safeUrl neutralizes script-bearing schemes (case/space-insensitive)', () => {
  assert.equal(safeUrl('javascript:alert(1)'), '#');
  assert.equal(safeUrl('JavaScript:alert(1)'), '#');
  assert.equal(safeUrl('  javascript:alert(1)'), '#');
  assert.equal(safeUrl('data:text/html,<script>alert(1)</script>'), '#');
  assert.equal(safeUrl('vbscript:msgbox(1)'), '#');
});

test('safeUrl coerces empty/nullish to empty string', () => {
  assert.equal(safeUrl(''), '');
  assert.equal(safeUrl(null), '');
  assert.equal(safeUrl(undefined), '');
});

// ---- #16: data-driven href/src sinks route through safeUrl ----
test('dashboard wraps DB-driven tracking_url and notification link through safeUrl', () => {
  const src = read('js/dashboard.js');
  assert.match(src, /safeUrl\(\s*[^)]*tracking_url/, 'tracking_url must pass through safeUrl');
  assert.match(src, /safeUrl\(\s*[^)]*\.link/, 'notification link must pass through safeUrl');
});

test('admin wraps admin-editable image/href values through safeUrl', () => {
  const src = read('js/admin.js');
  assert.match(src, /safeUrl\(/, 'admin renderers must sanitize URLs');
  assert.match(src, /import\s*\{[^}]*safeUrl[^}]*\}\s*from\s*['"]\.\/util\.js['"]/, 'admin.js must import safeUrl');
});

// ---- #14: rate limiting on the email-sending account mutations ----
for (const path of ['functions/api/account/team.js', 'functions/api/account/messages.js']) {
  test(`${path} rate-limits its email-sending mutation`, () => {
    const src = read(path);
    assert.match(src, /import\s*\{[^}]*\}\s*from\s*['"][^'"]*ratelimit\.js['"]/, 'must import the rate limiter');
    assert.match(src, /await\s+rateLimit\(/, 'must call rateLimit before sending');
    assert.match(src, /json\(429,\s*\{\s*error:\s*'rate_limited'/, 'must return 429 when throttled');
  });
}

// ---- #11: RLS hardening migration ----
test('migration hardens profiles_self_update with a WITH CHECK against is_staff escalation', () => {
  const sql = read('supabase/schema-profiles-hardening.sql');
  assert.match(sql, /profiles_self_update/);
  assert.match(sql, /with\s+check/i);
  assert.match(sql, /is_staff/);
});
