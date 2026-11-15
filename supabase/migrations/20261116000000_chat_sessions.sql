-- Chat sessions: tasks that continue an earlier conversation share its session_id.
-- A task that starts a new chat is its own session.
alter table public.tasks add column session_id text;
update public.tasks set session_id = id where session_id is null;
create index tasks_owner_session on public.tasks (owner_id, session_id, created_at);
