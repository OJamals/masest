import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { relative } from 'node:path';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const publicExtensions = new Set(['.css', '.html', '.js', '.json', '.xml']);
const publicRoots = [
  new URL('../', import.meta.url),
  new URL('../ar/', import.meta.url),
  new URL('../blog/', import.meta.url),
  new URL('../css/', import.meta.url),
  new URL('../data/content/', import.meta.url),
  new URL('../de/', import.meta.url),
  new URL('../es/', import.meta.url),
  new URL('../fr/', import.meta.url),
  new URL('../industries/', import.meta.url),
  new URL('../js/', import.meta.url),
  new URL('../pt/', import.meta.url),
];
const disclosurePatterns = [
  /\bAI[-\s]generated\b/i,
  /\bAI[-\s](?:created|produced)\b/i,
  /\b(?:created|generated|made|produced)\s+(?:by|with)\s+AI\b/i,
  /\bcomputer[-\s]generated\b/i,
  /\bdigitally\s+reconstructed\b/i,
  /\breconstructed\s+from\b/i,
  /\bsource\s+photo\b/i,
  /\bsynthetic\s+(?:image|imagery|photo|visual)\b/i,
];
const excludedTopLevelDirectories = new Set([
  '.git', '.github', '.wrangler', 'artifacts', 'audit', 'audits', 'cloudflare',
  'dist', 'docs', 'factory', 'functions', 'img', 'node_modules', 'prototypes',
  'supabase', 'test-results', 'tests', 'tmp', 'tools',
]);

function extension(pathname) {
  const index = pathname.lastIndexOf('.');
  return index === -1 ? '' : pathname.slice(index);
}

function collectFiles(directory, { topLevelOnly = false } = {}) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      if (entry.isDirectory()) {
        if (topLevelOnly || excludedTopLevelDirectories.has(entry.name)) return [];
        return collectFiles(url);
      }
      return publicExtensions.has(extension(entry.name)) ? [url] : [];
    });
}

test('published website copy contains no AI or reconstruction disclosures', () => {
  const files = [
    ...collectFiles(publicRoots[0], { topLevelOnly: true }),
    ...publicRoots.slice(1)
      .filter((directory) => existsSync(directory))
      .flatMap((directory) => collectFiles(directory)),
  ];

  assert.ok(files.length > 100, 'expected full public website and blog surface');
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const path = relative(root.pathname, file.pathname);
    for (const pattern of disclosurePatterns) {
      assert.doesNotMatch(content, pattern, `${path}: prohibited image disclosure`);
    }
  }
});
