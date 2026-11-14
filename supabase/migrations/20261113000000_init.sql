-- Owner-scoped RLS policies will be added in the next PR.

create table public.devices (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('mac', 'iphone')),
  name text,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.messaging_identities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  provider text not null default 'sendblue',
  handle text not null,
  created_at timestamptz not null default now(),
  unique (provider, handle)
);

create table public.tasks (
  id text primary key,
  owner_id uuid not null references auth.users(id),
  device_id text not null references public.devices(id),
  state text not null check (
    state in (
      'accepted',
      'running',
      'waitingForUser',
      'succeeded',
      'failed',
      'cancelled'
    )
  ),
  revision int not null default 1 check (revision > 0),
  instruction text not null,
  last_observed_slide int,
  question text,
  provider_message_id text unique,
  reply_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.commands (
  id text primary key,
  task_id text not null references public.tasks(id) on delete cascade,
  revision int not null,
  action jsonb not null,
  status text not null default 'pending' check (
    status in ('pending', 'claimed', 'completed', 'superseded')
  ),
  issued_at timestamptz default now()
);

create table public.events (
  task_id text not null references public.tasks(id) on delete cascade,
  seq int not null,
  type text not null,
  data jsonb not null default '{}',
  at timestamptz default now(),
  primary key (task_id, seq)
);

create table public.results (
  command_id text primary key references public.commands(id) on delete cascade,
  task_id text not null references public.tasks(id),
  revision int not null,
  outcome text check (outcome in ('succeeded', 'failed', 'rejected')),
  observed_slide int,
  error jsonb,
  observed_at timestamptz not null
);

alter table public.devices enable row level security;
alter table public.messaging_identities enable row level security;
alter table public.tasks enable row level security;
alter table public.commands enable row level security;
alter table public.events enable row level security;
alter table public.results enable row level security;
