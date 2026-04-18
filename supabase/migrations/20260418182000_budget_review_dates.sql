alter table public.buildings
  add column if not exists budget_set_date timestamptz;

alter table public.buildings
  add column if not exists budget_review_date timestamptz;
