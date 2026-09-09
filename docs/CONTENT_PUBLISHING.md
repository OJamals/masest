# Publishing CMS content to the live site

The admin CMS writes content to **Supabase** (`content_entries`). The public
site does **not** read Supabase at runtime; it serves **static snapshots** from
`data/content/*.json`.

Production is built by `OJamals/masest` in `.github/workflows/verify.yml`.
Before the full verification gate, the workflow runs `npm run build:content`
against Supabase. It then uploads the verified `dist/` directly to the existing
Cloudflare Pages project `masest-commerce`.

## Admin publish workflow

1. An owner publishes content in the admin CMS.
2. The Pages Function writes the published entry to Supabase.
3. For general content, the Function sends the `site-content-published`
   repository event to `OJamals/masest`; the `Verify` workflow refreshes all
   published snapshots, verifies them, and deploys.
4. For blog content, the Function sends `content-published`; the blog workflow
   commits the generated blog files, then dispatches `Verify`. Newsletter email
   runs only after that deployment succeeds.

Required Cloudflare Pages production secrets:

- `GITHUB_DISPATCH_TOKEN`
- `GITHUB_DISPATCH_REPO=OJamals/masest`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Required `OJamals/masest` Actions secrets are listed in
[`CLOUDFLARE_PAGES.md`](../CLOUDFLARE_PAGES.md#deployment-pipeline).

## Manual audited workflow

Use this when you want a local diff and explicit git commit before live content
changes:

```bash
# 1. Regenerate snapshots from the currently published Supabase entries.
#    Use ONE content source:
SUPABASE_DB_URL='postgresql://…pooler…:5432/postgres' npm run publish:content
#    — or the REST path —
SUPABASE_URL='https://…supabase.co' SUPABASE_PUBLISHABLE_KEY='sb_publishable_…' npm run publish:content

# 2. Review the diff.
git diff data/content/

# 3. Publish: commit + push -> OJamals Verify builds and deploys.
git add data/content/ && git commit -m 'content: publish CMS updates' && git push
```

If nothing was published in the admin since the last run, the script prints
**“No snapshot changes — Nothing to publish.”** and leaves the tree clean
(regeneration is deterministic: the manifest timestamp is sticky when content
is unchanged, so there is no spurious diff).

## Notes

- `SUPABASE_DB_URL` (or `CONTENT_DB_URL`) uses a direct Postgres/pooler
  connection and needs the `pg` driver (a devDependency — `npm install` pulls
  it in). The REST path needs no extra dependency. Its publishable key can read
  only published rows and the seven snapshot fields allowed by RLS + column
  grants; it cannot write content or read draft/internal fields. Legacy
  `SUPABASE_ANON_KEY` remains accepted for local transition only.
- Only `status = 'published'` entries are exported; drafts never reach the live
  snapshot.
- `npm run build:content` regenerates snapshots via the REST path only;
  `publish:content` is the operator-facing wrapper that also reports the diff
  and supports the pooler.
- Output ordering is canonical (entries by `type`, then `slug`; JSONB-ordered
  keys) so snapshots are byte-stable regardless of which source produced them.

## Site image library

Cloudflare R2 is the source of truth for public content images. The bucket is
`masest-site-images`, Pages Functions access it through the `CONTENT_IMAGES`
binding, and public bytes use `https://media.masest.co`.
`data/content/site-images.json` is the versioned integrity ledger. It preserves
each stable `/img/...` logical alias plus its dimensions, MIME type, byte size,
SHA-256, and reusable alt text. `npm run build:images` validates that ledger.

The Content asset manager and every shared image picker merge those rows with
the local manifest, preferring the CMS row for each logical alias. New uploads
are optimized, written to R2 under `cms/...`, registered in Supabase metadata,
and then attached through the preview-first “Replace everywhere” workflow.

The normal `npm run build` rewrites known public-site image references to those
stable R2 URLs. Existing Supabase `content-assets` URLs are canonicalized to the
same R2 object key during compilation. Public image binaries are not duplicated
in the repository or Pages deployment.

For the one-time copy, first create the bucket and `media.masest.co` custom
domain, then bind the bucket to both Pages production and preview. Inventory is
read-only unless `--execute` is present:

```bash
npm run migrate:content-images
npm run migrate:content-images -- --execute
CMS_MEDIA_BASE=https://media.masest.co/site npm run verify:cms-images
```

The migration preserves every `content-assets` object key, downloads each source
object once, uploads immutable R2 bytes, and verifies public MIME type, byte size,
SHA-256, and cache policy. The Supabase copy remains intact for rollback; do not
delete it during cutover.

Run `npm run verify:cms-images` to fetch every managed object and prove its
response MIME type, byte size, and SHA-256 against the ledger. Add or replace
images through the CMS asset manager; update the ledger in the same reviewed
change when an object intentionally changes.

`verify:cms-images` is a deliberate live, full-byte integrity audit. It downloads
the total `byte_size` declared by the ledger and must not run in routine local or
CI loops. Use `npm run build:images` for offline ledger validation. Browser QA
also replaces both R2 and legacy Supabase managed images with local placeholders
unless `MASEST_LIVE_MEDIA=1` is set outside CI. Reserve live bytes for reviewed
image changes and release proof.

## Operational boundary

The admin publish path is GitHub-dispatch driven and always passes through the
same verification gate as a normal `main` push. Removing
`GITHUB_DISPATCH_TOKEN` pauses immediate publication; scheduled GitHub workflows
remain the recovery path. Cloudflare-native Git builds must remain disabled.
