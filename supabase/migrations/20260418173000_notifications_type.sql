alter table public.notifications
  add column if not exists type text not null default 'general';
