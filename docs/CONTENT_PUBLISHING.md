# Publishing CMS content to the live site

The admin CMS writes content to **Supabase** (`content_entries`). The public
site does **not** read Supabase at runtime; it serves **static snapshots** from
`data/content/*.json`.

Production Cloudflare Pages is configured to run
`npm run build:content && npm run build`. During each production build,
`build:content` reads the published Supabase entries through the REST path,
regenerates the static snapshots, and then `cf-build` copies them into `dist/`.

## Admin publish workflow

1. An owner publishes content in the admin CMS.
2. The Pages Function writes the published entry to Supabase.
3. The Function calls `CONTENT_PUBLISH_HOOK_URL`.
4. Cloudflare Pages rebuilds `main`, regenerates the static content snapshots,
   and deploys the updated site.

Required Cloudflare Pages production secrets:

- `CONTENT_PUBLISH_HOOK_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Manual audited workflow

Use this when you want a local diff and explicit git commit before live content
changes:

```bash
# 1. Regenerate snapshots from the currently published Supabase entries.
#    Use ONE content source:
SUPABASE_DB_URL='postgresql://…pooler…:5432/postgres' npm run publish:content
#    — or the REST path —
SUPABASE_URL='https://…supabase.co' SUPABASE_SERVICE_ROLE_KEY='…' npm run publish:content

# 2. Review the diff.
git diff data/content/

# 3. Publish: commit + push -> Cloudflare Pages deploys.
git add data/content/ && git commit -m 'content: publish CMS updates' && git push
```

If nothing was published in the admin since the last run, the script prints
**“No snapshot changes — Nothing to publish.”** and leaves the tree clean
(regeneration is deterministic: the manifest timestamp is sticky when content
is unchanged, so there is no spurious diff).

## Notes

- `SUPABASE_DB_URL` (or `CONTENT_DB_URL`) uses a direct Postgres/pooler
  connection and needs the `pg` driver (a devDependency — `npm install` pulls
  it in). The REST path needs no extra dependency.
- Only `status = 'published'` entries are exported; drafts never reach the live
  snapshot.
- `npm run build:content` regenerates snapshots via the REST path only;
  `publish:content` is the operator-facing wrapper that also reports the diff
  and supports the pooler.
- Output ordering is canonical (entries by `type`, then `slug`; JSONB-ordered
  keys) so snapshots are byte-stable regardless of which source produced them.

## Site image library

Supabase Storage is the source of truth for public images.
`data/content/site-images.json` is the versioned integrity ledger. It preserves
each stable `/img/...` logical alias plus its dimensions, MIME type, byte size,
SHA-256, and reusable alt text. `npm run build:images` validates that ledger.

The Content asset manager and every shared image picker merge those rows with
the local manifest, preferring the CMS row for each logical alias. “Replace
everywhere” overwrites the same managed Storage object, so its stable public URL
does not change.

The normal `npm run build` rewrites known public-site image references to those
stable CMS Storage URLs. Public image binaries are not duplicated in the
repository or deployment.

Run `npm run verify:cms-images` to fetch every managed object and prove its
response MIME type, byte size, and SHA-256 against the ledger. Add or replace
images through the CMS asset manager; update the ledger in the same reviewed
change when an object intentionally changes.

## Operational boundary

The admin publish path is immediate and deploy-hook driven. If you need the old
commit-gated behavior for a sensitive batch, temporarily remove
`CONTENT_PUBLISH_HOOK_URL` or restore the Pages build command to
`npm run build`, then use the manual audited workflow above.
