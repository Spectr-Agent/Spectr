alter table public.devices add column token_hash text unique;
alter table public.tasks
  add column reply_provider text,
  add column reply_handle text,
  add column agent_messages jsonb not null default '[]',
  add column pending_tool_results jsonb not null default '[]',
  add column step_count int not null default 0,
  add column last_step_response jsonb,
  add column screen_width int,
  add column screen_height int,
  add column summary text,
  add column final_screenshot bytea,
  add column final_screenshot_type text,
  add column result_sent_at timestamptz;
update public.tasks set state = 'failed', summary = 'Expired before the agent loop existed.', updated_at = now()
  where state in ('accepted','running','waitingForUser');
create unique index tasks_one_active_per_device on public.tasks (device_id)
  where state in ('accepted','running','waitingForUser');
create table public.inbound_messages (
  provider_message_id text primary key,
  task_id text not null references public.tasks(id) on delete cascade,
  kind text not null check (kind in ('task','correction','answer','stop')),
  text text not null,
  consumed_at timestamptz,
  reply_sent_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.inbound_messages enable row level security;
