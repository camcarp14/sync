-- SYNC's own storage. A new schema so nothing Board Room / ZTS / Runway /
-- Clarify already rely on is touched: this migration only adds.
create schema if not exists sync;

grant usage on schema sync to authenticated, service_role;

-- One row per user holding the whole SYNC document. The app's store is a single
-- plain object replaced immutably on every change, so sharding it into per-row
-- tables would buy nothing but merge conflicts. `rev` is what makes multi-device
-- honest: a client says which revision it was editing, and a stale write is
-- refused rather than silently clobbering a newer one.
create table if not exists sync.state (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  doc        jsonb       not null default '{}'::jsonb,
  rev        bigint      not null default 1,
  device     text        not null default '',
  updated_at timestamptz not null default now()
);

alter table sync.state enable row level security;

drop policy if exists "own sync state select" on sync.state;
drop policy if exists "own sync state insert" on sync.state;
drop policy if exists "own sync state update" on sync.state;
drop policy if exists "own sync state delete" on sync.state;

create policy "own sync state select" on sync.state
  for select using (auth.uid() = user_id);
create policy "own sync state insert" on sync.state
  for insert with check (auth.uid() = user_id);
create policy "own sync state update" on sync.state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own sync state delete" on sync.state
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on sync.state to authenticated;
