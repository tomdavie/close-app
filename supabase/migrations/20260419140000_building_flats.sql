-- Flats tracked during organising (neighbour canvas); status is only not_yet | signed_up.
create table if not exists public.building_flats (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings (id) on delete cascade,
  flat_label text not null default '',
  resident_name text,
  status text not null default 'not_yet',
  created_at timestamptz not null default now()
);

alter table public.building_flats drop constraint if exists building_flats_status_check;
alter table public.building_flats
  add constraint building_flats_status_check check (status in ('not_yet', 'signed_up'));

create index if not exists building_flats_building_idx on public.building_flats (building_id, created_at);

alter table public.building_flats enable row level security;

drop policy if exists "building_flats_select_members" on public.building_flats;
create policy "building_flats_select_members"
  on public.building_flats for select
  to authenticated
  using (
    exists (
      select 1 from public.owners o
      where o.building_id = building_flats.building_id
        and o.user_id = auth.uid()
        and (o.status is null or lower(o.status) <> 'removed')
    )
  );

drop policy if exists "building_flats_admin_insert" on public.building_flats;
create policy "building_flats_admin_insert"
  on public.building_flats for insert
  to authenticated
  with check (
    exists (
      select 1 from public.owners o
      where o.building_id = building_flats.building_id
        and o.user_id = auth.uid()
        and lower(coalesce(o.role, '')) = 'admin'
    )
    and status in ('not_yet', 'signed_up')
  );

drop policy if exists "building_flats_admin_update" on public.building_flats;
create policy "building_flats_admin_update"
  on public.building_flats for update
  to authenticated
  using (
    exists (
      select 1 from public.owners o
      where o.building_id = building_flats.building_id
        and o.user_id = auth.uid()
        and lower(coalesce(o.role, '')) = 'admin'
    )
  )
  with check (status in ('not_yet', 'signed_up'));

drop policy if exists "building_flats_admin_delete" on public.building_flats;
create policy "building_flats_admin_delete"
  on public.building_flats for delete
  to authenticated
  using (
    exists (
      select 1 from public.owners o
      where o.building_id = building_flats.building_id
        and o.user_id = auth.uid()
        and lower(coalesce(o.role, '')) = 'admin'
    )
  );

-- Anonymous interest tap: one row per tap, not_yet only, building must be organising.
drop policy if exists "building_flats_anon_interest_insert" on public.building_flats;
create policy "building_flats_anon_interest_insert"
  on public.building_flats for insert
  to anon, authenticated
  with check (
    status = 'not_yet'
    and exists (
      select 1 from public.buildings b
      where b.id = building_flats.building_id
        and lower(coalesce(b.status, '')) = 'organising'
    )
  );
