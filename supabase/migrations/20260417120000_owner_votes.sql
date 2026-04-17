-- Run in Supabase SQL editor or via CLI. Tracks one ballot per owner per vote.
create table if not exists public.owner_votes (
  id uuid primary key default gen_random_uuid(),
  vote_id uuid not null references public.votes (id) on delete cascade,
  owner_id uuid not null references public.owners (id) on delete cascade,
  building_id uuid not null references public.buildings (id) on delete cascade,
  choice text not null check (choice in ('yes', 'no')),
  created_at timestamptz not null default now(),
  unique (vote_id, owner_id)
);

create index if not exists owner_votes_vote_id_idx on public.owner_votes (vote_id);
create index if not exists owner_votes_owner_id_idx on public.owner_votes (owner_id);
create index if not exists owner_votes_building_id_idx on public.owner_votes (building_id);
