-- SYNC ships on a public static host, so its Supabase key is public by design
-- and RLS is the only real boundary. For the personal Board Room tables that is
-- enough: they are keyed on auth.uid(). But the Clarify / ZTS business tables
-- are org-wide with `auth.role() = 'authenticated'` policies, meaning ANY signed
-- -in account can read them. SYNC therefore never touches those tables directly
-- — it goes through sync.pentagon(), which checks ownership first. This narrows
-- access relative to the raw policies; it does not widen anything.
create table if not exists sync.allowed_emails (
  email      text primary key,
  note       text not null default '',
  created_at timestamptz not null default now()
);

-- RLS on with no policies: unreachable from the client under any key. Only
-- SECURITY DEFINER functions and service_role can see it.
alter table sync.allowed_emails enable row level security;

insert into sync.allowed_emails (email, note)
values ('cam.carp14@gmail.com', 'owner')
on conflict (email) do nothing;

-- Self-bootstrapping so a mis-seeded allowlist can never lock the real owner
-- out: whoever already owns Board Room rows in this project is the owner. A
-- stranger who signs up with the public key owns none, so they fail every arm.
create or replace function sync.is_owner()
returns boolean
language sql
stable
security definer
set search_path = sync, boardroom, public, pg_temp
as $$
  select auth.uid() is not null and (
    exists (select 1 from sync.allowed_emails a
             where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
    or exists (select 1 from boardroom.personal_events e where e.user_id = auth.uid())
    or exists (select 1 from boardroom.app_settings s where s.user_id = auth.uid())
  );
$$;

revoke all on function sync.is_owner() from public, anon;
grant execute on function sync.is_owner() to authenticated;
