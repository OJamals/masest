# Publishing CMS content to the live site

The admin CMS writes content to **Supabase** (`content_entries`). The public
site does **not** read Supabase at runtime or at build time — it serves the
committed **static snapshots** in `data/content/*.json`, which Cloudflare Pages
copies as-is. So editing/publishing in the admin updates Supabase but **does not
change the live site** until the snapshots are regenerated and committed.

This is intentional (commit-gated): git stays the source of truth for what is
actually live, every change is reviewable in a diff, and a Supabase outage can
never break a deploy.

## Publish workflow

```bash
# 1. Regenerate snapshots from the currently published Supabase entries.
#    Use ONE content source:
SUPABASE_DB_URL='postgresql://…pooler…:5432/postgres' npm run publish:content
#    — or the REST path —
SUPABASE_URL='https://…supabase.co' SUPABASE_SERVICE_ROLE_KEY='…' npm run publish:content

# 2. Review the diff.
git diff data/content/

# 3. Publish: commit + push → Cloudflare Pages deploys.
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
- `npm run build:content` does the same regeneration via the REST path only and
  is what a future Cloudflare build hook would call; `publish:content` is the
  operator-facing wrapper that also reports the diff and supports the pooler.
- Output ordering is canonical (entries by `type`, then `slug`; JSONB-ordered
  keys) so snapshots are byte-stable regardless of which source produced them.

## Fully automating (optional, not enabled)

To make admin "Publish" reach the site with no manual step, either (a) set a
Cloudflare Pages deploy hook as `CONTENT_PUBLISH_HOOK_URL` **and** change the
Pages build to run `build:content` against Supabase before `cf-build`, or
(b) wire a GitHub Action (triggered by the publish hook) that runs
`publish:content` and commits. Both remove the git review gate; (a) also makes
deploys depend on Supabase being reachable at build time.
