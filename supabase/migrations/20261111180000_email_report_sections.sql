-- Granular content controls for existing report recipients.
-- NULL means legacy content, preserving every current recipient and dispatch.
-- Rollout order: deploy migration, then Edge Function, then frontend.
ALTER TABLE public.audit_email_recipients
  ADD COLUMN IF NOT EXISTS report_sections jsonb DEFAULT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='audit_email_recipients_report_sections_check'
      AND conrelid='public.audit_email_recipients'::regclass
  ) THEN
    ALTER TABLE public.audit_email_recipients
      ADD CONSTRAINT audit_email_recipients_report_sections_check CHECK (
        report_sections IS NULL OR (
          jsonb_typeof(report_sections)='object'
          AND (report_sections - 'daily_detail' - 'customers' - 'activities')='{}'::jsonb
          AND (NOT report_sections ? 'daily_detail' OR jsonb_typeof(report_sections->'daily_detail')='boolean')
          AND (NOT report_sections ? 'customers' OR jsonb_typeof(report_sections->'customers')='boolean')
          AND (NOT report_sections ? 'activities' OR jsonb_typeof(report_sections->'activities')='boolean')
        )
      );
  END IF;
END $$;

COMMENT ON COLUMN public.audit_email_recipients.report_sections IS
'Optional content switches for official email, PDF and XLSX. Missing keys and NULL preserve legacy sections. Existing RLS/admin restrictions remain in force.';
