-- SudsQueue on Supabase. Run once in the SQL editor (or via the Supabase CLI).
-- Replace the two placeholders in the cron job at the bottom first.

create schema if not exists laundry;

-- The whole dorm database (a SQLite file), one locked row. Only the API (service connection) touches it.
create table if not exists laundry.store (
  id int primary key check (id = 1),
  data bytea not null,
  updated_at timestamptz not null default now()
);

-- Daily copies of the store, the API keeps the last 7.
create table if not exists laundry.backups (
  day date primary key,
  data bytea not null
);

-- Public board + chat. Phones subscribe to changes on this row (Supabase Realtime).
create table if not exists laundry.state (
  id int primary key check (id = 1),
  snapshot jsonb not null,
  chat jsonb not null,
  updated_at timestamptz not null default now()
);

alter table laundry.store enable row level security;
alter table laundry.backups enable row level security;
alter table laundry.state enable row level security;

-- Phones may read the public board, nothing else. No policy = no access for store/backups.
drop policy if exists "board is public" on laundry.state;
create policy "board is public" on laundry.state for select to anon, authenticated using (true);

grant usage on schema laundry to anon, authenticated;
grant select on laundry.state to anon, authenticated;
revoke all on laundry.store, laundry.backups from anon, authenticated;

-- Send row changes to Realtime.
do $$ begin
  alter publication supabase_realtime add table laundry.state;
exception when duplicate_object then null;
end $$;

-- Every minute: ask the app to move time forward (reservations expire, alerts go out).
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('suds-tick') where exists (select 1 from cron.job where jobname = 'suds-tick');
select cron.schedule(
  'suds-tick',
  '* * * * *',
  $$ select net.http_post(
       url := 'https://YOUR-APP.vercel.app/api/tick',
       headers := jsonb_build_object('x-cron-secret', 'YOUR-CRON-SECRET', 'content-type', 'application/json'),
       body := '{}'::jsonb
     ) $$
);
