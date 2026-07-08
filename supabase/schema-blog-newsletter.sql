-- Blog newsletter send ledger. One row per blog post that has been emailed to the
-- newsletter list — the dedup guard so a re-publish/edit never re-blasts subscribers.
-- Apply via the pooled service-role connection. Idempotent.
create table if not exists public.blog_newsletter_sends (
  slug text primary key,
  sent_at timestamptz not null default now(),
  recipient_count int not null default 0
);

grant select, insert, update on public.blog_newsletter_sends to service_role;

-- Backlog guard: mark the posts that existed BEFORE this feature as already sent, so
-- turning the newsletter on does not blast historical posts. Only genuinely new posts
-- published after this ship will email. Safe to re-run.
insert into public.blog_newsletter_sends (slug, recipient_count)
values
  ('hmis-000-explained', 0),
  ('descaling-without-acid', 0),
  ('vertkleen-launch', 0)
on conflict (slug) do nothing;
