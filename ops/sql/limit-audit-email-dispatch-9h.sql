-- Applied on Supabase dvaaicqajlppuigeyejr on 2026-11-13.
-- UTC 12:00-12:56 = Brasilia 09:00-09:56, weekdays.
-- Keep 15 serial slots because dispatcher handles one recipient per invocation.
-- Preserve command, Secrets, management retry and noon partial schedules.
do $$
declare dispatch_job bigint;
begin
  select jobid into strict dispatch_job from cron.job
  where jobname = 'audit-email-dispatch-9h' and active;
  perform cron.alter_job(dispatch_job, schedule => '0-56/4 12 * * 1-5');
end $$;
