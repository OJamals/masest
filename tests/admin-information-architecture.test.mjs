import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const html = read('admin.html');
const admin = read('js/admin.js');

function panel(name, nextName) {
  const start = html.indexOf(`data-panel="${name}"`);
  assert.notEqual(start, -1, `${name} panel should exist`);
  const end = nextName ? html.indexOf(`data-panel="${nextName}"`, start) : html.length;
  return html.slice(start, end);
}

test('admin navigation groups daily, commerce, customer, publishing, and system work', () => {
  for (const tab of ['analytics', 'finance', 'integrations']) {
    assert.match(html, new RegExp(`data-tab="${tab}"`), `${tab} should be a first-class admin tab`);
    assert.match(html, new RegExp(`data-panel="${tab}"`), `${tab} should have a matching panel`);
  }
  for (const group of ['Today', 'Commerce', 'Customers', 'Publishing', 'Business system']) {
    assert.match(html, new RegExp(`>${group}<`));
  }
});

test('overview contains action work only, with reports, analytics, and QBO in dedicated workspaces', () => {
  const overview = panel('overview', 'analytics');
  const analytics = panel('analytics', 'finance');
  const finance = panel('finance', 'integrations');
  const integrations = panel('integrations', 'orders');

  assert.match(overview, /id="admOpsSummary"/);
  assert.match(overview, /id="admRequestQueue"/);
  for (const id of ['admQbo', 'admReports', 'admSeo', 'admTraffic']) {
    assert.doesNotMatch(overview, new RegExp(`id="${id}"`), `${id} should not remain on Overview`);
  }
  assert.match(analytics, /id="admSeo"/);
  assert.match(analytics, /id="admTraffic"/);
  assert.match(finance, /id="admReports"/);
  assert.match(integrations, /id="admQbo"/);
});

test('admin tab renderer preserves historical deep links in the new information architecture', () => {
  assert.match(admin, /focusQuickBooks\) tab = 'integrations'/);
  assert.match(admin, /tab === 'traffic' \|\| tab === 'seo'\) tab = 'analytics'/);
  assert.match(admin, /tab === 'reports' \|\| tab === 'exports'\) tab = 'finance'/);
  assert.match(admin, /tab === 'offers'\) tab = 'newsletter'/);
  assert.match(admin, /state\.tab === 'overview'\) renderStats\(state\.stats\)/);
  assert.match(admin, /state\.tab === 'finance'\) wireReports\(\)/);
  assert.match(admin, /analytics: 'analytics'/);
  assert.match(admin, /integrations: 'integrations'/);
  assert.match(admin, /import\('\.\/admin\/traffic\.js\?v=\d{8}[a-z]'\)/);
  assert.match(admin, /import\('\.\/admin\/seo\.js\?v=\d{8}[a-z]'\)/);
  assert.match(admin, /import\('\.\/admin\/qbo\.js\?v=\d{8}[a-z]'\)/);
});
