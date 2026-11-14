-- Use Chert for new messaging identities.
alter table public.messaging_identities alter column provider set default 'chert';
