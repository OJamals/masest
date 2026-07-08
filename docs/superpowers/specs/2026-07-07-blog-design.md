# Blog — Design Spec

**Date:** 2026-07-07
**Status:** Approved, ready for implementation plan

## Goal

A single categorized blog for the MASEST/VertKleen site covering three post kinds
in one stream — SEO/content-marketing, technical/educational, and company news.
Authored in the existing admin CMS, rendered to static HTML at build for full
crawlability, and wired into the site's commerce funnel via CTAs and internal links.

## Non-goals (v1, YAGNI)

- No comments, no author accounts/table, no pagination (client filter handles volume
  until it doesn't), no draft-preview UI beyond what the CMS already provides, no raw
  HTML passthrough in post bodies.

## Architecture & data flow

Reuses the site's established CMS → snapshot → static-page pipeline exactly (same
shape as products / proof / industries).

```
Author in admin.html CMS  (new content type: blog_post)
        │  publish
        ▼
content_entries (Supabase, status=published)
        │  npm run publish:content   →  build-content snapshot
        ▼
data/content/blog.json   (key: blog_posts)  ── committed to git
        │  npm run build:blog   (NEW tool: tools/build-blog.mjs)
        ▼
  /blog.html                index (category chips + tag filter, client-side)
  /blog/<slug>.html         one static page per post (markdown → HTML)
  /blog/feed.xml            RSS 2.0
  sitemap.xml               += blog URLs
        │  committed to git
        ▼
cf-build copies tracked files  →  Cloudflare Pages
```

Key constraint: `cf-build.mjs` only copies **git-tracked** files (it does not run
`seo-inject`). So `build-blog` is a manual, committed build step — its generated
pages are checked into git, exactly like the static product pages produced by
`seo-inject`. Markdown is rendered at build time, so crawlers receive full HTML.

## Data model — `blog_post` content type

Each post = one `content_entries` row, `type='blog_post'`, `slug` = URL slug (uses
the entry's own `slug` column, how every content type already keys). Snapshot target:
`data/content/blog.json`, key `blog_posts`. Added to `CONTENT_TYPE_DEFINITIONS` in
`js/content-types.js`; the admin panel renders it generically — no bespoke admin code.

| field | kind | required | notes |
|---|---|---|---|
| `title` | text | yes | H1 + `<title>` |
| `category` | text | yes | one of `marketing` / `technical` / `news`; validated in build |
| `tags` | list | no | freeform chips; powers index filter |
| `author` | text | no | byline |
| `date` | text | yes | ISO `YYYY-MM-DD`; publish + primary sort (desc) |
| `hero` | text | no | image path under `img/blog/` |
| `hero_alt` | text | no | hero alt text |
| `excerpt` | textarea | yes | index card + meta description + OG description |
| `body` | textarea | yes | **markdown** source |
| `sort_order` | number | no | tiebreak; primary sort is `date` desc |

Reading time computed at build from body word count. `content-type` snapshot config:
`snapshot: { file: "blog.json", key: "blog_posts" }` so `build-content` picks it up
automatically.

## Components

### `tools/_md.mjs` — zero-dep markdown renderer
Purpose-built, ~150 lines, no npm dependency (site build is currently zero-extra-dep;
memory convention: stay vanilla). Supports: ATX headings `#`–`####`, bold, italic,
inline code, fenced code blocks, links, images, unordered + ordered lists,
blockquotes, horizontal rules, paragraphs. **HTML-escapes all text before applying
inline markup** — defense against injection from CMS-authored bodies (output is
embedded into static pages). No raw-HTML passthrough. Exported as a pure
`renderMarkdown(src) -> htmlString` function.

### `tools/build-blog.mjs` — page generator
Reads `data/content/blog.json`, then:
1. **Validate** each post: required fields present, `category` ∈ {marketing, technical,
   news}, slug unique, `date` parseable. Fails loud (non-zero exit) on bad data.
2. **Render** body markdown → HTML via `_md`.
3. Write **`/blog/<slug>.html`** from a template matching site nav/footer: hero,
   byline (`author · date · N min read`), rendered body, **related posts** (2–3: same
   category first, then shared tags), **CTA block** (quote / products funnel), plus
   `Article` JSON-LD, canonical, and OG tags.
4. Write **`/blog.html`** index: post cards (hero thumb, category label, title,
   excerpt, date) rendered server-side for all posts; category chips + tag filter are
   client-side (show/hide via data attributes). No-JS users see the full list.
5. Write **`/blog/feed.xml`** — RSS 2.0, newest 20 posts.
6. **Merge** blog URLs into `sitemap.xml` (idempotent, byte-stable — mirrors
   `seo-inject` conventions).

`build-blog` owns blog URLs in the sitemap; `seo-inject` continues to own everything
else. Added to `package.json`: `"build:blog": "node tools/build-blog.mjs"`. Run
manually after `publish:content`; output committed.

### CMS admin
No new admin code — `blog_post` added to `CONTENT_TYPE_DEFINITIONS`; the existing
generic CMS editor renders its fields. Body authored as markdown in the `textarea`.

### Navigation
Add "Blog" to primary nav + footer across pages (parallels how Resources sits).
Clean URL `/blog`.

## Error handling

- `build-blog` validation rejects malformed posts with a clear message and non-zero
  exit — a bad CMS entry fails the build rather than shipping broken pages.
- `_md` never emits unescaped author text; a markdown/HTML injection attempt renders
  as inert text.
- `build-content` snapshot wipe-guard (existing) protects `blog.json` from being
  zeroed by an unreachable DB, same as other content types.

## Testing (Node `--test`, `tests/*.test.mjs`)

- **`_md` renderer:** escaping correctness, every markdown construct, an injection
  attempt (`<script>`, `](javascript:)`) stays inert.
- **`build-blog`:** fixture `blog.json` → correct slug pages exist, `Article` JSON-LD
  is valid JSON with required fields, RSS is well-formed XML, sitemap merged
  idempotently, bad-data input is rejected.
- **index:** all posts rendered into `/blog.html`; filter data attributes present on
  cards and chips.

## Seed data

3 example posts (one per category) committed so the pipeline produces real, verifiable
output and the index/RSS/related-posts logic has content to exercise.

## Open items deferred to plan

- Exact nav insertion point + which page templates carry the link.
- Whether related-posts ranking needs a deterministic tiebreak beyond category+tags
  (use `date` desc, then slug, for byte-stable output).
