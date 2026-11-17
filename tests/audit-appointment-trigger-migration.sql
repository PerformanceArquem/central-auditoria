\set ON_ERROR_STOP on
BEGIN;
CREATE TABLE public.audit_direct_appointments (
  appointment_key text PRIMARY KEY,
  ticket_id text NOT NULL,
  collaborator_name text,
  sector text,
  activity text,
  appointment_date date,
  duration_minutes integer NOT NULL,
  source_synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.audit_appointment_changes (
  id bigserial PRIMARY KEY,
  appointment_key text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  operation text NOT NULL,
  before_data jsonb,
  after_data jsonb
);
\i supabase/migrations/20261117133000_audit_appointment_activity_ticket_changes.sql
CREATE TRIGGER audit_track_appointment_change
AFTER INSERT OR UPDATE OR DELETE ON public.audit_direct_appointments
FOR EACH ROW EXECUTE FUNCTION public.audit_track_appointment_change();
INSERT INTO public.audit_direct_appointments
  (appointment_key,ticket_id,collaborator_name,sector,activity,appointment_date,duration_minutes)
VALUES ('test-a','101191','Colaborador Teste','Produção - CPO','Análise','2026-11-16',60);
UPDATE public.audit_direct_appointments SET activity='Correção' WHERE appointment_key='test-a';
UPDATE public.audit_direct_appointments SET ticket_id='101192' WHERE appointment_key='test-a';
UPDATE public.audit_direct_appointments SET source_synced_at=now()+interval '1 second' WHERE appointment_key='test-a';
UPDATE public.audit_direct_appointments SET duration_minutes=120 WHERE appointment_key='test-a';
DELETE FROM public.audit_direct_appointments WHERE appointment_key='test-a';
DO $$
DECLARE
  ops text[];
  activity_before text;
  activity_after text;
  ticket_before text;
  ticket_after text;
  operation_count integer;
BEGIN
  SELECT array_agg(operation ORDER BY id) INTO ops FROM public.audit_appointment_changes;
  IF ops IS DISTINCT FROM ARRAY['INSERT','UPDATE','UPDATE','UPDATE','DELETE']::text[] THEN
    RAISE EXCEPTION 'Unexpected audit event sequence: %', ops;
  END IF;
  SELECT COUNT(*) INTO operation_count FROM public.audit_appointment_changes;
  IF operation_count<>5 THEN RAISE EXCEPTION 'Unexpected number of events: %',operation_count; END IF;
  SELECT before_data->>'activity',after_data->>'activity' INTO activity_before,activity_after
    FROM public.audit_appointment_changes WHERE id=2;
  IF activity_before<>'Análise' OR activity_after<>'Correção' THEN
    RAISE EXCEPTION 'Activity before/after not captured correctly';
  END IF;
  SELECT before_data->>'ticket_id',after_data->>'ticket_id' INTO ticket_before,ticket_after
    FROM public.audit_appointment_changes WHERE id=3;
  IF ticket_before<>'101191' OR ticket_after<>'101192' THEN
    RAISE EXCEPTION 'Ticket change not captured correctly';
  END IF;
  IF (SELECT after_data->>'duration_minutes' FROM public.audit_appointment_changes WHERE id=4)<>'120'
  THEN RAISE EXCEPTION 'Duration change not captured correctly'; END IF;
  IF (SELECT after_data IS NOT NULL FROM public.audit_appointment_changes WHERE id=5)
  THEN RAISE EXCEPTION 'Delete event has unexpected after_data'; END IF;
END $$;
ROLLBACK;
