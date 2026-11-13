-- Daily Bot-to-Human activity reporting (manual Portal generation only).
-- This migration records minimal metadata events; it never stores message bodies or phone numbers.
-- Local/Staging source only. Do not apply to a hosted project without separate approval.

BEGIN;

CREATE TABLE IF NOT EXISTS public.kdj_bot_activity_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type text NOT NULL
      CHECK (event_type IN (
        'CUSTOMER_INBOUND',
        'BOT_REPLY',
        'HUMAN_HANDOVER',
        'BOT_RESUMED'
      )),
    event_key text NOT NULL UNIQUE
      CHECK (event_key ~ '^[0-9a-f]{64}$'),
    occurred_at timestamptz NOT NULL,
    source_instance text
      CHECK (source_instance IS NULL OR length(source_instance) BETWEEN 1 AND 120),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kdj_bot_activity_events_occurred_type
    ON public.kdj_bot_activity_events (occurred_at, event_type);

CREATE TABLE IF NOT EXISTS public.kdj_bot_reporting_config (
    id smallint PRIMARY KEY CHECK (id = 1),
    ledger_enabled_at timestamptz
);

INSERT INTO public.kdj_bot_reporting_config (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.kdj_bot_reporting_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.kdj_bot_reporting_config FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.kdj_bot_reporting_config TO service_role;

ALTER TABLE public.kdj_bot_activity_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.kdj_bot_activity_events
    FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.kdj_bot_activity_events
    TO service_role;

CREATE OR REPLACE FUNCTION public.kdj_record_bot_activity_event(
    p_event_type text,
    p_event_key text,
    p_occurred_at timestamptz DEFAULT NULL,
    p_source_instance text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_event_id uuid;
    v_occurred_at timestamptz := COALESCE(p_occurred_at, pg_catalog.now());
BEGIN
    IF p_event_type IS NULL OR p_event_type NOT IN (
        'CUSTOMER_INBOUND', 'BOT_REPLY', 'HUMAN_HANDOVER', 'BOT_RESUMED'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = 'INVALID_BOT_ACTIVITY_EVENT_TYPE';
    END IF;

    IF p_event_key IS NULL OR p_event_key !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = 'INVALID_BOT_ACTIVITY_EVENT_KEY';
    END IF;

    IF v_occurred_at > pg_catalog.now() + interval '5 minutes' THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = 'BOT_ACTIVITY_EVENT_TIME_IN_FUTURE';
    END IF;

    IF p_source_instance IS NOT NULL
       AND length(p_source_instance) NOT BETWEEN 1 AND 120 THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = 'INVALID_BOT_ACTIVITY_SOURCE';
    END IF;

    INSERT INTO public.kdj_bot_activity_events (
        event_type, event_key, occurred_at, source_instance
    )
    VALUES (
        p_event_type, p_event_key, v_occurred_at, p_source_instance
    )
    ON CONFLICT (event_key) DO NOTHING
    RETURNING id INTO v_event_id;

    IF v_event_id IS NOT NULL THEN
        UPDATE public.kdj_bot_reporting_config
        SET ledger_enabled_at = v_occurred_at
        WHERE id = 1 AND ledger_enabled_at IS NULL;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'inserted', v_event_id IS NOT NULL,
        'event_id', v_event_id,
        'event_type', p_event_type
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.kdj_record_bot_activity_event(text, text, timestamptz, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kdj_record_bot_activity_event(text, text, timestamptz, text)
    TO service_role;

CREATE OR REPLACE FUNCTION public.kdj_get_bot_daily_report_stats(
    p_start_at timestamptz,
    p_end_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_result jsonb;
BEGIN
    IF p_start_at IS NULL OR p_end_at IS NULL
       OR p_end_at <= p_start_at
       OR p_end_at - p_start_at > interval '26 hours' THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = 'INVALID_DAILY_REPORT_WINDOW';
    END IF;

    SELECT pg_catalog.jsonb_build_object(
        'coverage_started_at',
          (SELECT ledger_enabled_at
           FROM public.kdj_bot_reporting_config
           WHERE id = 1),
        'bot_events',
          (SELECT COALESCE(pg_catalog.jsonb_object_agg(event_type, event_count), '{}'::jsonb)
           FROM (
             SELECT event_type, pg_catalog.count(*)::integer AS event_count
             FROM public.kdj_bot_activity_events
             WHERE occurred_at >= p_start_at AND occurred_at < p_end_at
             GROUP BY event_type
           ) e),
        'lead_events',
          (SELECT COALESCE(pg_catalog.jsonb_object_agg(action, event_count), '{}'::jsonb)
           FROM (
             SELECT action, pg_catalog.count(*)::integer AS event_count
             FROM public.kdj_lead_qualification_events
             WHERE created_at >= p_start_at AND created_at < p_end_at
             GROUP BY action
           ) l),
        'booking_events',
          (SELECT COALESCE(pg_catalog.jsonb_object_agg(event_type, event_count), '{}'::jsonb)
           FROM (
             SELECT event_type, pg_catalog.count(*)::integer AS event_count
             FROM public.booking_notification_outbox
             WHERE created_at >= p_start_at AND created_at < p_end_at
             GROUP BY event_type
           ) b),
        'booking_notification_current_status',
          (SELECT COALESCE(pg_catalog.jsonb_object_agg(status, event_count), '{}'::jsonb)
           FROM (
             SELECT status, pg_catalog.count(*)::integer AS event_count
             FROM public.booking_notification_outbox
             WHERE created_at >= p_start_at AND created_at < p_end_at
             GROUP BY status
           ) bs),
        'followup_jobs_current_status',
          (SELECT COALESCE(pg_catalog.jsonb_object_agg(status, job_count), '{}'::jsonb)
           FROM (
             SELECT status, pg_catalog.count(*)::integer AS job_count
             FROM public.kdj_followup_jobs
             WHERE created_at >= p_start_at AND created_at < p_end_at
             GROUP BY status
           ) fj),
        'incidents_opened',
          (SELECT pg_catalog.count(*)::integer
           FROM public.kdj_system_incidents
           WHERE created_at >= p_start_at AND created_at < p_end_at),
        'human_sessions_current',
          (SELECT pg_catalog.count(*)::integer
           FROM public.pendaftar
           WHERE chat_handler::text = 'HUMAN'),
        'global_safe_mode',
          (SELECT global_safe_mode
           FROM public.kdj_system_controls
           WHERE id = 1),
        'heartbeats_latest',
          (SELECT COALESCE(pg_catalog.jsonb_agg(
                    pg_catalog.jsonb_build_object(
                      'component', component,
                      'status', status,
                      'observed_at', observed_at
                    ) ORDER BY component
                  ), '[]'::jsonb)
           FROM (
             SELECT DISTINCT ON (component)
                    component, status, observed_at
             FROM public.kdj_system_heartbeats
             ORDER BY component, observed_at DESC
           ) hb)
    )
    INTO v_result;

    RETURN COALESCE(v_result, '{}'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.kdj_get_bot_daily_report_stats(timestamptz, timestamptz)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kdj_get_bot_daily_report_stats(timestamptz, timestamptz)
    TO service_role;

COMMIT;
