-- One row per room. Only the server (service role) reads/writes it; clients get realtime "changed" pings via broadcast.
create table if not exists public.katan_rooms (
  id text primary key,
  state jsonb not null,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.katan_rooms enable row level security;
