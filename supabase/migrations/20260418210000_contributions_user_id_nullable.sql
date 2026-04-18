-- Optional link to auth user; null when owner row has no user_id yet (invite-only).
alter table public.contributions
  add column if not exists user_id uuid references auth.users (id) on delete set null;

alter table public.contributions
  alter column user_id drop not null;

create index if not exists contributions_user_id_idx
  on public.contributions (user_id)
  where user_id is not null;
