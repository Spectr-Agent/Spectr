-- Onboarding: what Spectr remembers about a person, and where they are in the
-- questions. Keyed by the verified owner. Nothing is written to profiles until
-- the person says yes to "Shall I remember this?".
create table public.profiles (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  profile jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.onboarding_state (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

-- One row per text onboarding has handled, so a webhook delivered twice cannot
-- advance the questions twice. Stores no message text.
create table public.onboarding_turns (
  provider_message_id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.onboarding_state enable row level security;
alter table public.onboarding_turns enable row level security;
