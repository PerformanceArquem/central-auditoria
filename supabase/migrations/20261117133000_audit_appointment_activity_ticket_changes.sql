-- Extend appointment change audit to track ticket and activity changes.
-- Deploy only after validating in a staging Supabase database.
-- Existing trigger audit_track_appointment_change already invokes this function.
-- No historical records are rewritten; coverage starts after migration.
create or replace function public.audit_track_appointment_change()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if TG_OP = 'UPDATE'
     and row(OLD.ticket_id, OLD.appointment_date, OLD.duration_minutes,
             OLD.collaborator_name, OLD.sector, OLD.activity)
         is not distinct from
         row(NEW.ticket_id, NEW.appointment_date, NEW.duration_minutes,
             NEW.collaborator_name, NEW.sector, NEW.activity)
  then
    return NEW;
  end if;

  insert into public.audit_appointment_changes
    (appointment_key, operation, before_data, after_data)
  values (
    case when TG_OP='DELETE' then OLD.appointment_key else NEW.appointment_key end,
    TG_OP,
    case when TG_OP='INSERT' then null else jsonb_build_object(
      'ticket_id', OLD.ticket_id,
      'appointment_date', OLD.appointment_date,
      'duration_minutes', OLD.duration_minutes,
      'collaborator_name', OLD.collaborator_name,
      'sector', OLD.sector,
      'activity', OLD.activity
    ) end,
    case when TG_OP='DELETE' then null else jsonb_build_object(
      'ticket_id', NEW.ticket_id,
      'appointment_date', NEW.appointment_date,
      'duration_minutes', NEW.duration_minutes,
      'collaborator_name', NEW.collaborator_name,
      'sector', NEW.sector,
      'activity', NEW.activity
    ) end
  );

  if TG_OP='DELETE' then return OLD; end if;
  return NEW;
end
$function$;
