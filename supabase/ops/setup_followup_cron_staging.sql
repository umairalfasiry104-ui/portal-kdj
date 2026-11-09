-- Run only after pg_cron is enabled in the Staging Supabase project.
-- Do not run in Production. This schedules evaluation only; no WhatsApp dispatch.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    RAISE EXCEPTION 'pg_cron belum aktif. Aktifkan melalui Supabase Dashboard > Database > Extensions, lalu jalankan ulang script ini.';
  END IF;
END $$;

DO $$
DECLARE v_job_id bigint;
BEGIN
  FOR v_job_id IN SELECT jobid FROM cron.job WHERE jobname='kdj-followup-eligibility-every-minute' LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;
  PERFORM cron.schedule(
    'kdj-followup-eligibility-every-minute',
    '* * * * *',
    'SELECT public.kdj_evaluate_followup_eligibility(100);'
  );
END $$;

SELECT jobid, jobname, schedule, active, database, username
FROM cron.job WHERE jobname='kdj-followup-eligibility-every-minute';
