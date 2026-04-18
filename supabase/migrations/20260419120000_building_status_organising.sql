-- Building lifecycle: organising (onboarding) vs live (full app).
alter table public.buildings
  add column if not exists status text not null default 'live';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'buildings_status_check'
  ) then
    alter table public.buildings
      add constraint buildings_status_check
      check (status in ('organising', 'live'));
  end if;
end $$;

-- Anonymous neighbours can register interest from a share link (no account).
create table if not exists public.organising_interest_signals (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings (id) on delete cascade,
  flat_number text,
  created_at timestamptz not null default now()
);

create index if not exists organising_interest_building_idx
  on public.organising_interest_signals (building_id, created_at desc);

alter table public.organising_interest_signals enable row level security;

drop policy if exists "organising_interest_insert_anon" on public.organising_interest_signals;
create policy "organising_interest_insert_anon"
  on public.organising_interest_signals for insert
  to anon, authenticated
  with check (true);

drop policy if exists "organising_interest_select_admins" on public.organising_interest_signals;
create policy "organising_interest_select_admins"
  on public.organising_interest_signals for select
  to authenticated
  using (
    exists (
      select 1 from public.owners o
      where o.building_id = organising_interest_signals.building_id
        and o.user_id = auth.uid()
        and lower(coalesce(o.role, '')) = 'admin'
    )
  );
