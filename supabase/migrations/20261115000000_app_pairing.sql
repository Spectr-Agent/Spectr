-- iPhone app: pairing a Mac with a short code, and linking a phone number by calling.
-- Owner: Jared. Server-only tables (the API connects as the database owner); RLS is on
-- with no policies so the anon and authenticated roles cannot read them.

create table public.device_pairings (
  id text primary key,
  code text not null,
  poll_secret_hash text not null,
  mac_name text not null,
  owner_id uuid references auth.users(id),
  device_id text references public.devices(id),
  -- The Mac's device token, sealed with a server secret, until the Mac collects it once.
  token_ciphertext text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  approved_at timestamptz,
  delivered_at timestamptz
);

-- A code is unique among codes still waiting for approval.
create unique index device_pairings_open_code
  on public.device_pairings (code)
  where approved_at is null;

alter table public.device_pairings enable row level security;

create table public.phone_link_requests (
  phone text primary key,
  owner_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index phone_link_requests_owner on public.phone_link_requests (owner_id);

alter table public.phone_link_requests enable row level security;
