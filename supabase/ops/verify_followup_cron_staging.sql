SELECT jobid, jobname, schedule, active, database, username
FROM cron.job WHERE jobname='kdj-followup-eligibility-every-minute';

SELECT jobid, status, return_message, start_time, end_time
FROM cron.job_run_details
WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname='kdj-followup-eligibility-every-minute')
ORDER BY start_time DESC LIMIT 20;

SELECT sequence_status, count(*)
FROM public.kdj_followup_profiles GROUP BY sequence_status ORDER BY sequence_status;

SELECT status, count(*)
FROM public.kdj_followup_jobs GROUP BY status ORDER BY status;
