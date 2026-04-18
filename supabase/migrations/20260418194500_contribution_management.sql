-- Contribution settings + per-period schedule support.
alter table public.buildings
  add column if not exists contribution_amount numeric,
  add column if not exists contribution_frequency text,
  add column if not exists contribution_next_due_date date;

alter table public.buildings
  alter column contribution_frequency set default 'quarterly';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'buildings_contribution_frequency_check'
  ) then
    alter table public.buildings
      add constraint buildings_contribution_frequency_check
      check (contribution_frequency in ('monthly', 'quarterly', 'annually'));
  end if;
end $$;

alter table public.contributions
  add column if not exists due_date date,
  add column if not exists period_label text;

create index if not exists contributions_building_period_idx
  on public.contributions (building_id, period_label);

create unique index if not exists contributions_building_owner_period_uidx
  on public.contributions (building_id, owner_id, period_label)
  where period_label is not null;
