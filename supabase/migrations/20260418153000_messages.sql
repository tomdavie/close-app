-- Building-wide chat messages used in Owners.js.
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  sender_name text not null,
  message_text text not null check (char_length(trim(message_text)) > 0),
  created_at timestamptz not null default now()
);

create index if not exists messages_building_created_idx on public.messages (building_id, created_at);
