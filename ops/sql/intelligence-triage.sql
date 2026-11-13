create table if not exists public.audit_triage_snapshots (
 id uuid primary key default gen_random_uuid(),reference_date date not null,
 created_at timestamptz not null default now(),sha256 text not null,report jsonb not null,attachment_preview jsonb
);
create table if not exists public.audit_triage_dispatches (
 dispatch_key text primary key,reference_date date not null,email text not null,
 snapshot_id uuid not null references public.audit_triage_snapshots(id),
 status text not null check(status in ('processing','sent','uncertain')),
 attachment_validation jsonb not null,provider_result jsonb,gmail_id text,provider_id text,error text,
 created_at timestamptz not null default now(),sent_at timestamptz,
 unique(reference_date,email)
);
alter table public.audit_triage_snapshots enable row level security;
alter table public.audit_triage_dispatches enable row level security;
revoke all on public.audit_triage_snapshots,public.audit_triage_dispatches from anon,authenticated;
grant all on public.audit_triage_snapshots,public.audit_triage_dispatches to service_role;

