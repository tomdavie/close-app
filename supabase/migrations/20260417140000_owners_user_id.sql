-- Links owner rows to Supabase auth users (settings + RLS-friendly lookups).
alter table public.owners
  add column if not exists user_id uuid references auth.users (id) on delete set null;

create index if not exists owners_user_id_idx on public.owners (user_id) where user_id is not null;
