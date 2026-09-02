-- Least-privilege export path for GitHub Actions content snapshots.
-- Publishable API keys map unauthenticated requests to the `anon` role.

alter table public.content_entries enable row level security;

drop policy if exists content_entries_published_snapshot_read on public.content_entries;
create policy content_entries_published_snapshot_read
  on public.content_entries
  for select
  to anon
  using (status = 'published'::public.content_status);

grant usage on schema public to anon;
revoke all privileges on table public.content_entries from anon;
grant select (type, slug, title, status, locale, payload, seo)
  on table public.content_entries to anon;
