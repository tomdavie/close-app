-- Notifications + contributions tables for topbar bell and owner payment history.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  message text not null,
  target_screen text not null default 'home',
  target_id text,
  is_read boolean not null default false,
  event_key text,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);
create unique index if not exists notifications_user_event_key_uidx
  on public.notifications (user_id, event_key)
  where event_key is not null;

create table if not exists public.contributions (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings (id) on delete cascade,
  owner_id uuid not null references public.owners (id) on delete cascade,
  amount numeric not null default 0,
  status text not null default 'recorded',
  paid_date date,
  created_at timestamptz not null default now()
);

create index if not exists contributions_owner_created_idx on public.contributions (owner_id, created_at desc);
