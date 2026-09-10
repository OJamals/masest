import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { renderContentRedirects } from '../tools/content-redirects.mjs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const config = JSON.parse(read('data/content-redirects.json'));
const pageExists = (pathname) => existsSync(new URL(`${pathname.slice(1)}.html`, root));

/**
 * The five comparison topics that shipped as two live 200s — `/blog/<slug>` and
 * `/comparisons/<slug>`, each self-canonicalizing, so neither deferred to the other.
 * Ruled 2026-09-10: `/comparisons/` is canonical. It carries the buyer's first CTA at
 * 8% of the page against the blog template's 96%, its CTAs are product-scoped, and its
 * body is repo-owned in tools/gen_comparisons.mjs rather than reverting from Supabase.
 */
const DUPLICATE_COMPARISON_SLUGS = [
  'beer-line-cleaner-cost-comparison',
  'cr-hd-vs-simple-green',
  'hcr-vs-rydlyme',
  'lam3-vs-wet-forget',
  'vertkleen-hcr-vs-clr',
];

test('every duplicate comparison topic redirects its blog URL to the canonical page', () => {
  const emitted = renderContentRedirects(config, { exists: pageExists });
  assert.equal(
    emitted,
    `${DUPLICATE_COMPARISON_SLUGS
      .map((slug) => `/blog/${slug} /comparisons/${slug} 301`)
      .join('\n')}\n`,
  );
});

test('a comparison page may not ship without retiring its blog twin', () => {
  const sources = new Set(config.redirects.map(({ from }) => from));
  const comparisonSlugs = readFileSync(new URL('tools/gen_comparisons.mjs', root), 'utf8')
    .matchAll(/^\s*slug:\s*"([a-z0-9-]+)"/gm);
  for (const [, slug] of comparisonSlugs) {
    if (!existsSync(new URL(`blog/${slug}.html`, root))) continue;
    assert.equal(
      sources.has(`/blog/${slug}`),
      true,
      `/comparisons/${slug} and /blog/${slug} both resolve — add the redirect or the two compete for the same query`,
    );
  }
});

test('the redirect map and the CMS removal guard name the same five slugs', () => {
  // publish-blog-ci.mjs refuses to drop these posts from the Supabase payload. That guard
  // and this map have to agree: the redirect is what retires the URL, and the guard is what
  // stops someone "fixing" the duplicate by deleting the post instead — which would strand
  // the redirect's own source and every inbound link the blog version still holds.
  const guard = readFileSync(new URL('tools/publish-blog-ci.mjs', root), 'utf8');
  const block = guard.match(/PROTECTED_COMPARISON_SLUGS\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(block, 'PROTECTED_COMPARISON_SLUGS not found in tools/publish-blog-ci.mjs');
  const protectedSlugs = [...block[1].matchAll(/"([a-z0-9-]+)"/g)].map(([, slug]) => slug).sort();
  assert.deepEqual(protectedSlugs, [...DUPLICATE_COMPARISON_SLUGS].sort());
});

test('redirect sources still resolve to a page, and that is the point', () => {
  // The industries redirects assert the opposite — `existsSync(from.html) === false` —
  // because an industry slug is retired by deleting its page. A blog post cannot be:
  // data/content/blog.json is a downstream snapshot that verify.yml overwrites from
  // Supabase before the build, so a repo-side deletion reverts on deploy.
  //
  // The 301 still wins. Cloudflare Pages applies _redirects "regardless of whether or not
  // an asset matches the incoming request"
  // (https://developers.cloudflare.com/pages/configuration/redirects/), verified live on
  // /industries/schools-universities -> 301 -> /industries/education. Do not "fix" this
  // test by deleting the source pages.
  for (const { from, to } of config.redirects) {
    assert.equal(pageExists(from), true, `${from}: source page is missing`);
    assert.equal(pageExists(to.split('#')[0]), true, `${to}: redirect target is missing`);
  }
});

test('the canonical target owns the topic and the retired source does not fight it', () => {
  for (const { from, to } of config.redirects) {
    const target = read(`${to.split('#')[0].slice(1)}.html`);
    assert.match(
      target,
      new RegExp(`rel="canonical" href="https://masest\\.co${to.split('#')[0]}"`),
      `${to}: canonical page must point at itself`,
    );
    assert.doesNotMatch(
      target,
      new RegExp(`rel="canonical" href="https://masest\\.co${from}"`),
      `${to}: must not defer to the URL being retired`,
    );
  }
});

test('malformed redirects fail the build rather than shipping', () => {
  const cases = [
    [{ from: '/blog/a\n/evil /x 301', to: '/comparisons/a', reason: 'r' }, /whitespace or quoting/],
    [{ from: '/blog/a', to: '/blog/a', reason: 'r' }, /redirects to itself/],
    [{ from: '/blog/a#anchor', to: '/x', reason: 'r' }, /fragments are evaluated by the browser/],
    [{ from: '/blog/a', to: '/x', status: 302, reason: 'r' }, /not a permanent redirect/],
    [{ from: '/blog/a', to: '/x' }, /needs a `reason`/],
    [{ from: '/Blog/A', to: '/x', reason: 'r' }, /invalid path/],
  ];
  for (const [redirect, pattern] of cases) {
    assert.throws(() => renderContentRedirects({ redirects: [redirect] }), pattern);
  }

  assert.throws(
    () => renderContentRedirects({
      redirects: [
        { from: '/blog/a', to: '/x', reason: 'r' },
        { from: '/blog/a', to: '/y', reason: 'r' },
      ],
    }),
    /duplicate redirect source/,
  );
  assert.throws(
    () => renderContentRedirects({
      redirects: [
        { from: '/blog/a', to: '/blog/b', reason: 'r' },
        { from: '/blog/b', to: '/c', reason: 'r' },
      ],
    }),
    /collapse the chain/,
  );
  assert.throws(
    () => renderContentRedirects(
      { redirects: [{ from: '/blog/a', to: '/nope', reason: 'r' }] },
      { exists: () => false },
    ),
    /redirect target \/nope does not exist/,
  );
});

test('a destination fragment survives, so a merged post can land on its own answer', () => {
  // Cloudflare evaluates fragments in the destination even though it never receives one in
  // the request. The consolidation map needs this: a post merged into resources.html should
  // land on its own <h2>, not at the top of a long FAQ page.
  assert.equal(
    renderContentRedirects({
      redirects: [{ from: '/blog/a', to: '/resources#side-by-side', reason: 'r' }],
    }),
    '/blog/a /resources#side-by-side 301\n',
  );
});

test('a redirect never lands the reader on less than it took away', () => {
  // The failure this catches is silent and permanent: 301 /blog/X to a page that says less
  // than /blog/X did, and the difference is simply gone. Three of the five started that way
  // (beer-line -183w, lam3 -90w, hcr-vs-rydlyme -57w) and the bodies were carried across
  // into tools/gen_comparisons.mjs before the redirects shipped.
  const strip = (markup) => markup
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const posts = new Map(
    JSON.parse(read('data/content/blog.json')).blog_posts.map((post) => [post.slug, post]),
  );

  for (const { from, to } of config.redirects) {
    const post = posts.get(from.replace('/blog/', ''));
    if (!post) continue;
    const source = post.body.replace(/\[\[[^\]]*\]\]/g, ' ').split(/\s+/).filter(Boolean).length;
    const target = strip(read(`${to.split('#')[0].slice(1)}.html`).match(/<main[\s\S]*?<\/main>/i)[0]);
    assert.ok(
      target >= source,
      `${to} carries ${target} words against ${from}'s ${source} — carry the body across before redirecting`,
    );
  }
});

test('every carried body renders, rather than shipping raw markdown', () => {
  for (const { to } of config.redirects) {
    const markup = read(`${to.split('#')[0].slice(1)}.html`);
    const main = markup.match(/<main[\s\S]*?<\/main>/i)[0];
    assert.doesNotMatch(main, /\[\[/, `${to}: an unrendered [[binding]] reached the page`);
    assert.doesNotMatch(main, /^## /m, `${to}: raw markdown heading reached the page`);
    // blog.css owns every prose rule the rendered markdown needs; components.css carries
    // only `.blog-body img`. Without it the body renders as unstyled running text.
    assert.match(markup, /css\/blog\.css\?v=/, `${to}: prose body needs blog.css`);
  }
});

test('a canonical page carries at least the structured data of the page it retired', () => {
  // The retired /blog/ twins emit BlogPosting + Organization. Making these pages canonical
  // while emitting only WebPage would have made the page canonical and its schema poorer in
  // the same change. Article, not BlogPosting: a product comparison on a /comparisons route
  // is not a blog post.
  for (const { to } of config.redirects) {
    const markup = read(`${to.split('#')[0].slice(1)}.html`);
    const blocks = [...markup.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    assert.ok(blocks.length, `${to}: no JSON-LD at all`);
    const graph = blocks.flatMap(([, json]) => JSON.parse(json)['@graph'] ?? []);
    const article = graph.find((node) => node['@type'] === 'Article');
    assert.ok(article, `${to}: canonical page must emit Article`);

    assert.equal(article.url, `https://masest.co${to.split('#')[0]}`);
    assert.equal(article.mainEntityOfPage, article.url);
    assert.ok(article.author?.name, `${to}: Article needs an author entity`);
    assert.equal(article.author['@type'], 'Organization',
      `${to}: the originating posts are bylined "MASEST Team" — do not publish a company as a Person`);
    assert.match(article.datePublished, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(article.dateModified, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(article.dateModified >= article.datePublished, `${to}: modified before published`);
    assert.ok(
      existsSync(new URL(article.image.replace('https://masest.co/', ''), root)),
      `${to}: Article image ${article.image} does not resolve to a file`,
    );

    // Two rungs, not three. There is no /comparisons index, and the previous trail pointed
    // positions 2 and 3 at the same leaf URL — a malformed trail Google may discard.
    const crumbs = graph.find((node) => node['@type'] === 'BreadcrumbList');
    assert.ok(crumbs, `${to}: no BreadcrumbList`);
    const urls = crumbs.itemListElement.map((item) => item.item);
    assert.equal(new Set(urls).size, urls.length, `${to}: breadcrumb repeats a URL`);
  }
});
