-- Candidate only. Not applied. Requires reviewed backend and attachment generator.
-- Explicit opt-in prevents accidental execution from an SQL editor.
begin;
do $$
declare dispatch_job bigint;
begin
 if current_setting('arquem.morning_schedule_approved',true) is distinct from 'true' then
   raise exception 'Morning schedule has not been approved';
 end if;
 select jobid into strict dispatch_job from cron.job where jobname='audit-email-dispatch-9h';
 -- One serial slot per minute. The dispatcher still reserves each key atomically.
 perform cron.alter_job(dispatch_job,schedule=>'57-59 11 * * 1-5');
 -- Additional 09:00-09:59 slots reuse the existing secret-bearing command.
 perform cron.schedule('audit-email-dispatch-morning-continuation','* 12 * * 1-5',command)
 from cron.job where jobid=dispatch_job;
 perform cron.alter_job(jobid,active=>false) from cron.job
 where jobname in ('audit-email-management-8h','audit-email-management-retry');
 perform cron.alter_job(jobid,schedule=>'50,52,54,56,58 10 * * 1-5') from cron.job
 where jobname='audit-report-prepare-8h';
 perform cron.schedule('audit-report-prepare-morning-continuation','*/2 11 * * 1-5',command)
 from cron.job where jobname='audit-report-prepare-8h';
end $$;
commit;
-- Rollback: restore schedules from the private pre-release cron inventory;
-- unschedule audit-email-dispatch-morning-continuation. Never copy secret commands into Git.
