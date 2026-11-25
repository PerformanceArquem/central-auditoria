-- Draft for isolated test database only. Never apply automatically.
begin;
create schema if not exists alert_center_test;
revoke all on schema alert_center_test from public, anon, authenticated;
create table alert_center_test.simulation_runs (
  id uuid primary key default gen_random_uuid(),
  period_key text not null,
  kind text not null check (kind in ('tickets','daily','partial')),
  created_at timestamptz not null default now(),
  snapshot_verified boolean not null check (snapshot_verified),
  simulated boolean not null default true check (simulated)
);
create table alert_center_test.simulated_alerts (
  alert_key text primary key,
  run_id uuid not null references alert_center_test.simulation_runs(id),
  rule text not null,
  recipient_role text not null,
  created_at timestamptz not null default now(),
  simulated boolean not null default true check (simulated)
);
create table alert_center_test.occurrences (
  occurrence_key text primary key,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (last_seen_at >= first_seen_at),
  check (resolved_at is null or resolved_at >= last_seen_at)
);
alter table alert_center_test.simulation_runs enable row level security;
alter table alert_center_test.simulated_alerts enable row level security;
alter table alert_center_test.occurrences enable row level security;
revoke all on all tables in schema alert_center_test from public, anon, authenticated;
commit;
