-- Optional fields for building settings (safe if columns already exist).
alter table public.buildings
  add column if not exists floor_count integer;

alter table public.buildings
  add column if not exists approx_flat_count integer;
