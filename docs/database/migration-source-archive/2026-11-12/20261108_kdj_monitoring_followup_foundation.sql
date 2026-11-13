-- KDJ Phase 6/7 foundation: system monitoring, incident ledger, FU consent and schedule.
-- No WhatsApp FU delivery is enabled by this migration. The compliance gate defaults CLOSED.

BEGIN;

CREATE TABLE IF NOT EXISTS public.kdj_system_heartbeats (
    component text NOT NULL,
    instance_id text NOT NULL,
    status text NOT NULL CHECK (status IN ('OK', 'DEGRADED', 'DOWN', 'STARTING', 'UNKNOWN')),
    observed_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
    latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (component, instance_id)
);

CREATE TABLE IF NOT EXISTS public.kdj_system_incidents (
    id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    fingerprint text NOT NULL,
    severity text NOT NULL CHECK (severity IN ('P0', 'P1', 'P2', 'P3')),
    module text NOT NULL,
    title text NOT NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    correlation_id text,
    affected_entity text,
    status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
    owner_admin_id uuid,
    occurrence_count integer NOT NULL DEFAULT 1 CHECK (occurrence_count >= 1),
    first_seen_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
    last_seen_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
    acknowledged_at timestamptz,
    resolved_at timestamptz,
    resolution_notes text,
    created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
    updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

CREATE INDEX IF NOT EXISTS idx_kdj_system_incidents_status_last_seen
    ON public.kdj_system_incidents (status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_kdj_system_incidents_severity_status
    ON public.kdj_system_incidents (severity, status);

CREATE TABLE IF NOT EXISTS public.kdj_system_incident_events (
    id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    incident_id uuid NOT NULL REFERENCES public.kdj_system_incidents(id) ON DELETE RESTRICT,
    event_type text NOT NULL,
    actor_admin_id uuid,
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

CREATE INDEX IF NOT EXISTS idx_kdj_system_incident_events_incident_created
    ON public.kdj_system_incident_events (incident_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.kdj_followup_profiles (
    profile_id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid() UNIQUE,
    phone_local text PRIMARY KEY CHECK (phone_local ~ '^08[0-9]{8,11}$'),
    consent_granted boolean NOT NULL DEFAULT false,
    consent_source text,
    consent_text_version text,
    consented_at timestamptz,
    consent_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    opted_out_at timestamptz,
    last_inbound_at timestamptz,
    last_inbound_message_id text,
    sequence_id uuid,
    sequence_status text NOT NULL DEFAULT 'AWAITING_CONSENT'
        CHECK (sequence_status IN ('AWAITING_CONSENT', 'AWAITING_INBOUND', 'ACTIVE', 'STOPPED', 'COMPLETED')),
    stop_reason text,
    admin_stopped_at timestamptz,
    admin_stopped_by uuid,
    admin_stop_reason text,
    updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

CREATE TABLE IF NOT EXISTS public.kdj_followup_control_events (
    id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    profile_id uuid NOT NULL REFERENCES public.kdj_followup_profiles(profile_id) ON DELETE RESTRICT,
    phone_local text NOT NULL CHECK (phone_local ~ '^08[0-9]{8,11}$'),
    action text NOT NULL CHECK (action IN ('ADMIN_STOP')),
    actor_admin_id uuid NOT NULL,
    reason text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

CREATE INDEX IF NOT EXISTS idx_kdj_followup_control_events_profile_created
    ON public.kdj_followup_control_events (profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.kdj_followup_consent_events (
    id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    phone_local text NOT NULL CHECK (phone_local ~ '^08[0-9]{8,11}$'),
    action text NOT NULL CHECK (action IN ('GRANTED', 'WITHDRAWN')),
    source text NOT NULL CHECK (source IN ('PORTAL', 'WHATSAPP')),
    text_version text NOT NULL,
    consent_text text NOT NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

CREATE INDEX IF NOT EXISTS idx_kdj_followup_consent_phone_created
    ON public.kdj_followup_consent_events (phone_local, created_at DESC);

CREATE TABLE IF NOT EXISTS public.kdj_followup_jobs (
    id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    phone_local text NOT NULL CHECK (phone_local ~ '^08[0-9]{8,11}$'),
    sequence_id uuid NOT NULL,
    step smallint NOT NULL CHECK (step IN (1, 2, 3)),
    due_at timestamptz NOT NULL,
    status text NOT NULL CHECK (status IN ('HELD_COMPLIANCE', 'SCHEDULED', 'PROCESSING', 'SENT', 'FAILED', 'UNKNOWN', 'CANCELLED')),
    held_reason text,
    idempotency_key text NOT NULL UNIQUE,
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    last_error text,
    stop_reason text,
    created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
    updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
    UNIQUE (sequence_id, step)
);

CREATE INDEX IF NOT EXISTS idx_kdj_followup_jobs_due_status
    ON public.kdj_followup_jobs (status, due_at);
CREATE INDEX IF NOT EXISTS idx_kdj_followup_jobs_phone_due
    ON public.kdj_followup_jobs (phone_local, due_at DESC);

CREATE TABLE IF NOT EXISTS public.kdj_followup_delivery_gate (
    id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    delivery_enabled boolean NOT NULL DEFAULT false,
    compliance_status text NOT NULL DEFAULT 'BLOCKED'
        CHECK (compliance_status IN ('BLOCKED', 'IN_REVIEW', 'APPROVED')),
    approved_channel text,
    approved_by uuid,
    approved_at timestamptz,
    review_reference text,
    updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
    CHECK (delivery_enabled = false OR (compliance_status = 'APPROVED' AND approved_channel IS NOT NULL AND approved_at IS NOT NULL))
);

INSERT INTO public.kdj_followup_delivery_gate (id, delivery_enabled, compliance_status)
VALUES (1, false, 'BLOCKED')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.kdj_system_controls (
    id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    global_safe_mode boolean NOT NULL DEFAULT false,
    paused_modules text[] NOT NULL DEFAULT ARRAY[]::text[],
    updated_by uuid,
    updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

INSERT INTO public.kdj_system_controls (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.kdj_system_heartbeats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kdj_system_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kdj_system_incident_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kdj_followup_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kdj_followup_control_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kdj_followup_consent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kdj_followup_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kdj_followup_delivery_gate ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kdj_system_controls ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.kdj_system_heartbeats, public.kdj_system_incidents,
    public.kdj_system_incident_events, public.kdj_followup_profiles,
    public.kdj_followup_consent_events, public.kdj_followup_control_events,
    public.kdj_followup_jobs, public.kdj_followup_delivery_gate, public.kdj_system_controls
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.kdj_system_heartbeats TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.kdj_system_incidents TO service_role;
GRANT SELECT, INSERT ON TABLE public.kdj_system_incident_events TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.kdj_followup_profiles TO service_role;
GRANT SELECT, INSERT ON TABLE public.kdj_followup_consent_events TO service_role;
GRANT SELECT, INSERT ON TABLE public.kdj_followup_control_events TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.kdj_followup_jobs TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.kdj_followup_delivery_gate TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.kdj_system_controls TO service_role;

CREATE OR REPLACE FUNCTION public.kdj_record_system_heartbeat(
    p_component text,
    p_instance_id text,
    p_status text,
    p_latency_ms integer DEFAULT NULL,
    p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_row public.kdj_system_heartbeats%ROWTYPE;
BEGIN
    IF p_component IS NULL OR p_component !~ '^[a-z][a-z0-9_-]{1,49}$'
       OR p_instance_id IS NULL OR length(p_instance_id) NOT BETWEEN 1 AND 120
       OR (p_status IS NULL OR p_status NOT IN ('OK', 'DEGRADED', 'DOWN', 'STARTING', 'UNKNOWN'))
       OR (p_latency_ms IS NOT NULL AND p_latency_ms < 0)
       OR pg_catalog.jsonb_typeof(COALESCE(p_details, '{}'::jsonb)) <> 'object'
    THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_HEARTBEAT_PAYLOAD';
    END IF;

    INSERT INTO public.kdj_system_heartbeats (
        component, instance_id, status, observed_at, latency_ms, details
    ) VALUES (
        p_component, p_instance_id, p_status, pg_catalog.now(), p_latency_ms,
        pg_catalog.jsonb_strip_nulls(COALESCE(p_details, '{}'::jsonb))
    )
    ON CONFLICT (component, instance_id) DO UPDATE SET
        status = EXCLUDED.status,
        observed_at = EXCLUDED.observed_at,
        latency_ms = EXCLUDED.latency_ms,
        details = EXCLUDED.details
    RETURNING * INTO v_row;

    RETURN pg_catalog.jsonb_build_object(
        'component', v_row.component,
        'instance_id', v_row.instance_id,
        'status', v_row.status,
        'observed_at', v_row.observed_at
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.kdj_open_system_incident(
    p_fingerprint text,
    p_severity text,
    p_module text,
    p_title text,
    p_evidence jsonb DEFAULT '{}'::jsonb,
    p_correlation_id text DEFAULT NULL,
    p_affected_entity text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_incident_id uuid;
BEGIN
    IF p_fingerprint IS NULL OR length(p_fingerprint) NOT BETWEEN 3 AND 200
       OR (p_severity IS NULL OR p_severity NOT IN ('P0', 'P1', 'P2', 'P3'))
       OR p_module IS NULL OR length(p_module) NOT BETWEEN 1 AND 80
       OR p_title IS NULL OR length(p_title) NOT BETWEEN 1 AND 240
       OR pg_catalog.jsonb_typeof(COALESCE(p_evidence, '{}'::jsonb)) <> 'object'
    THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_INCIDENT_PAYLOAD';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_fingerprint, 0));

    SELECT i.id INTO v_incident_id
    FROM public.kdj_system_incidents AS i
    WHERE i.fingerprint = p_fingerprint
      AND i.status IN ('OPEN', 'ACKNOWLEDGED')
    ORDER BY i.created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_incident_id IS NULL THEN
        INSERT INTO public.kdj_system_incidents (
            fingerprint, severity, module, title, evidence, correlation_id, affected_entity
        ) VALUES (
            p_fingerprint, p_severity, p_module, p_title,
            COALESCE(p_evidence, '{}'::jsonb), p_correlation_id, p_affected_entity
        ) RETURNING id INTO v_incident_id;

        INSERT INTO public.kdj_system_incident_events (incident_id, event_type, details)
        VALUES (v_incident_id, 'INCIDENT_OPENED', pg_catalog.jsonb_build_object('severity', p_severity, 'module', p_module));
    ELSE
        UPDATE public.kdj_system_incidents
        SET severity = p_severity,
            title = p_title,
            evidence = COALESCE(p_evidence, '{}'::jsonb),
            correlation_id = COALESCE(p_correlation_id, correlation_id),
            affected_entity = COALESCE(p_affected_entity, affected_entity),
            last_seen_at = pg_catalog.now(),
            updated_at = pg_catalog.now()
        WHERE id = v_incident_id;
    END IF;

    RETURN v_incident_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.kdj_set_followup_consent(
    p_phone_local text,
    p_consented boolean,
    p_source text,
    p_text_version text,
    p_consent_text text,
    p_evidence jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_event_id uuid;
    v_status text;
BEGIN
    IF p_phone_local IS NULL OR p_phone_local !~ '^08[0-9]{8,11}$'
       OR p_consented IS NULL
       OR (p_source IS NULL OR p_source NOT IN ('PORTAL', 'WHATSAPP'))
       OR p_text_version IS NULL OR length(p_text_version) NOT BETWEEN 1 AND 80
       OR p_consent_text IS NULL OR length(p_consent_text) NOT BETWEEN 10 AND 1000
       OR pg_catalog.jsonb_typeof(COALESCE(p_evidence, '{}'::jsonb)) <> 'object'
    THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_FOLLOWUP_CONSENT_PAYLOAD';
    END IF;

    INSERT INTO public.kdj_followup_consent_events (
        phone_local, action, source, text_version, consent_text, evidence
    ) VALUES (
        p_phone_local,
        CASE WHEN p_consented THEN 'GRANTED' ELSE 'WITHDRAWN' END,
        p_source, p_text_version, p_consent_text,
        pg_catalog.jsonb_strip_nulls(COALESCE(p_evidence, '{}'::jsonb))
    ) RETURNING id INTO v_event_id;

    INSERT INTO public.kdj_followup_profiles (
        phone_local, consent_granted, consent_source, consent_text_version,
        consented_at, consent_evidence, opted_out_at, sequence_status,
        stop_reason, updated_at
    ) VALUES (
        p_phone_local, p_consented,
        CASE WHEN p_consented THEN p_source ELSE NULL END,
        CASE WHEN p_consented THEN p_text_version ELSE NULL END,
        CASE WHEN p_consented THEN pg_catalog.now() ELSE NULL END,
        CASE WHEN p_consented THEN COALESCE(p_evidence, '{}'::jsonb) ELSE '{}'::jsonb END,
        CASE WHEN p_consented THEN NULL ELSE pg_catalog.now() END,
        CASE WHEN p_consented THEN 'AWAITING_INBOUND' ELSE 'STOPPED' END,
        CASE WHEN p_consented THEN NULL ELSE 'CONSENT_WITHDRAWN' END,
        pg_catalog.now()
    )
    ON CONFLICT (phone_local) DO UPDATE SET
        consent_granted = EXCLUDED.consent_granted,
        consent_source = EXCLUDED.consent_source,
        consent_text_version = EXCLUDED.consent_text_version,
        consented_at = EXCLUDED.consented_at,
        consent_evidence = EXCLUDED.consent_evidence,
        opted_out_at = EXCLUDED.opted_out_at,
        sequence_status = CASE
            WHEN public.kdj_followup_profiles.admin_stopped_at IS NOT NULL THEN 'STOPPED'
            WHEN EXCLUDED.consent_granted THEN 'AWAITING_INBOUND'
            ELSE 'STOPPED'
        END,
        stop_reason = CASE
            WHEN public.kdj_followup_profiles.admin_stopped_at IS NOT NULL THEN 'ADMIN_STOP'
            ELSE EXCLUDED.stop_reason
        END,
        updated_at = pg_catalog.now();

    IF NOT p_consented THEN
        UPDATE public.kdj_followup_jobs
        SET status = 'CANCELLED', stop_reason = 'CONSENT_WITHDRAWN', updated_at = pg_catalog.now()
        WHERE phone_local = p_phone_local
          AND status IN ('HELD_COMPLIANCE', 'SCHEDULED', 'PROCESSING');
    END IF;

    SELECT sequence_status INTO v_status
    FROM public.kdj_followup_profiles WHERE phone_local = p_phone_local;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'consent_granted', p_consented,
        'consent_event_id', v_event_id,
        'sequence_status', v_status
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.kdj_record_followup_inbound(
    p_phone_local text,
    p_message_id text,
    p_received_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_received_at timestamptz := COALESCE(p_received_at, pg_catalog.now());
    v_profile public.kdj_followup_profiles%ROWTYPE;
    v_sequence_id uuid := pg_catalog.gen_random_uuid();
    v_human boolean := false;
    v_booked boolean := false;
    v_block_reason text;
    v_jobs_created integer := 0;
BEGIN
    IF p_phone_local IS NULL OR p_phone_local !~ '^08[0-9]{8,11}$'
       OR (p_message_id IS NOT NULL AND length(p_message_id) > 200)
       OR v_received_at > pg_catalog.now() + interval '5 minutes'
    THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_FOLLOWUP_INBOUND_PAYLOAD';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_phone_local, 0));

    SELECT * INTO v_profile
    FROM public.kdj_followup_profiles
    WHERE phone_local = p_phone_local
    FOR UPDATE;

    IF FOUND AND p_message_id IS NOT NULL AND v_profile.last_inbound_message_id = p_message_id THEN
        RETURN pg_catalog.jsonb_build_object('success', true, 'duplicate', true, 'jobs_created', 0, 'sequence_status', v_profile.sequence_status);
    END IF;

    IF FOUND AND v_profile.last_inbound_at IS NOT NULL AND v_received_at < v_profile.last_inbound_at THEN
        RETURN pg_catalog.jsonb_build_object('success', true, 'stale_inbound', true, 'jobs_created', 0, 'sequence_status', v_profile.sequence_status);
    END IF;

    INSERT INTO public.kdj_followup_profiles (phone_local, last_inbound_at, last_inbound_message_id, sequence_id, sequence_status, updated_at)
    VALUES (p_phone_local, v_received_at, p_message_id, v_sequence_id, 'AWAITING_CONSENT', pg_catalog.now())
    ON CONFLICT (phone_local) DO UPDATE SET
        last_inbound_at = EXCLUDED.last_inbound_at,
        last_inbound_message_id = EXCLUDED.last_inbound_message_id,
        sequence_id = v_sequence_id,
        sequence_status = CASE
            WHEN public.kdj_followup_profiles.admin_stopped_at IS NOT NULL THEN 'STOPPED'
            WHEN public.kdj_followup_profiles.opted_out_at IS NOT NULL THEN 'STOPPED'
            WHEN public.kdj_followup_profiles.consent_granted THEN 'ACTIVE'
            ELSE 'AWAITING_CONSENT'
        END,
        stop_reason = CASE
            WHEN public.kdj_followup_profiles.admin_stopped_at IS NOT NULL THEN 'ADMIN_STOP'
            WHEN public.kdj_followup_profiles.opted_out_at IS NOT NULL THEN 'CONSENT_WITHDRAWN'
            ELSE NULL
        END,
        updated_at = pg_catalog.now()
    RETURNING * INTO v_profile;

    -- Any newer inbound invalidates every not-yet-sent job in the previous cycle.
    UPDATE public.kdj_followup_jobs
    SET status = 'CANCELLED', stop_reason = 'NEW_INBOUND', updated_at = pg_catalog.now()
    WHERE phone_local = p_phone_local
      AND status IN ('HELD_COMPLIANCE', 'SCHEDULED', 'PROCESSING');

    IF v_profile.admin_stopped_at IS NOT NULL THEN
        RETURN pg_catalog.jsonb_build_object('success', true, 'jobs_created', 0, 'sequence_status', 'STOPPED', 'stop_reason', 'ADMIN_STOP');
    END IF;

    IF NOT v_profile.consent_granted OR v_profile.opted_out_at IS NOT NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', true, 'jobs_created', 0,
            'sequence_status', CASE WHEN v_profile.opted_out_at IS NOT NULL THEN 'STOPPED' ELSE 'AWAITING_CONSENT' END
        );
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.pendaftar p
        WHERE p.no_wa IN (p_phone_local, '62' || pg_catalog.substr(p_phone_local, 2))
          AND p.chat_handler = 'HUMAN'
    ) INTO v_human;

    SELECT EXISTS (
        SELECT 1 FROM public.jadwal_konsultasi j
        WHERE j.no_wa IN (p_phone_local, '62' || pg_catalog.substr(p_phone_local, 2))
          AND j.status = 'Terjadwal'
          AND j.jadwal_pilihan >= v_received_at
    ) INTO v_booked;

    IF v_human THEN
        v_block_reason := 'HUMAN_HANDOVER';
    ELSIF v_booked THEN
        v_block_reason := 'ACTIVE_BOOKING';
    END IF;

    IF v_block_reason IS NOT NULL THEN
        UPDATE public.kdj_followup_profiles
        SET sequence_status = 'STOPPED', stop_reason = v_block_reason, updated_at = pg_catalog.now()
        WHERE phone_local = p_phone_local;
        RETURN pg_catalog.jsonb_build_object(
            'success', true, 'jobs_created', 0,
            'sequence_status', 'STOPPED', 'stop_reason', v_block_reason
        );
    END IF;

    -- Jobs are persisted for visibility and testing, but remain HELD_COMPLIANCE.
    -- No worker or code path may send them until the WhatsApp release gate is approved.
    INSERT INTO public.kdj_followup_jobs (
        phone_local, sequence_id, step, due_at, status,
        held_reason, idempotency_key
    ) VALUES
        (p_phone_local, v_profile.sequence_id, 1, v_received_at + interval '1 day', 'HELD_COMPLIANCE', 'WHATSAPP_COMPLIANCE_GATE',
            pg_catalog.md5(p_phone_local || ':' || v_profile.sequence_id::text || ':1')),
        (p_phone_local, v_profile.sequence_id, 2, v_received_at + interval '3 days', 'HELD_COMPLIANCE', 'WHATSAPP_COMPLIANCE_GATE',
            pg_catalog.md5(p_phone_local || ':' || v_profile.sequence_id::text || ':2')),
        (p_phone_local, v_profile.sequence_id, 3, v_received_at + interval '7 days', 'HELD_COMPLIANCE', 'WHATSAPP_COMPLIANCE_GATE',
            pg_catalog.md5(p_phone_local || ':' || v_profile.sequence_id::text || ':3'))
    ON CONFLICT (sequence_id, step) DO NOTHING;

    GET DIAGNOSTICS v_jobs_created = ROW_COUNT;

    UPDATE public.kdj_followup_profiles
    SET sequence_status = 'ACTIVE', stop_reason = NULL, updated_at = pg_catalog.now()
    WHERE phone_local = p_phone_local;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'jobs_created', v_jobs_created,
        'sequence_id', v_profile.sequence_id,
        'sequence_status', 'ACTIVE',
        'delivery_status', 'HELD_COMPLIANCE'
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.kdj_update_system_incident(
    p_incident_id uuid,
    p_action text,
    p_actor_admin_id uuid,
    p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_incident public.kdj_system_incidents%ROWTYPE;
    v_status text;
BEGIN
    IF p_incident_id IS NULL OR p_actor_admin_id IS NULL
       OR p_action IS NULL OR p_action NOT IN ('ACKNOWLEDGE', 'RESOLVE')
       OR (p_action = 'RESOLVE' AND (p_notes IS NULL OR length(pg_catalog.btrim(p_notes)) NOT BETWEEN 5 AND 2000))
    THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_INCIDENT_ACTION';
    END IF;

    SELECT * INTO v_incident
    FROM public.kdj_system_incidents
    WHERE id = p_incident_id
    FOR UPDATE;

    IF NOT FOUND OR v_incident.status = 'RESOLVED' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'INCIDENT_NOT_OPEN';
    END IF;

    IF p_action = 'ACKNOWLEDGE' THEN
        IF v_incident.status <> 'OPEN' THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INCIDENT_ALREADY_ACKNOWLEDGED';
        END IF;
        v_status := 'ACKNOWLEDGED';
        UPDATE public.kdj_system_incidents
        SET status = v_status, acknowledged_at = pg_catalog.now(), owner_admin_id = p_actor_admin_id, updated_at = pg_catalog.now()
        WHERE id = p_incident_id;
    ELSE
        v_status := 'RESOLVED';
        UPDATE public.kdj_system_incidents
        SET status = v_status, resolved_at = pg_catalog.now(), resolution_notes = pg_catalog.btrim(p_notes), owner_admin_id = p_actor_admin_id, updated_at = pg_catalog.now()
        WHERE id = p_incident_id;
    END IF;

    INSERT INTO public.kdj_system_incident_events (incident_id, event_type, actor_admin_id, details)
    VALUES (
        p_incident_id,
        CASE WHEN p_action = 'ACKNOWLEDGE' THEN 'ACKNOWLEDGED' ELSE 'RESOLVED' END,
        p_actor_admin_id,
        CASE WHEN p_action = 'RESOLVE' THEN pg_catalog.jsonb_build_object('notes', pg_catalog.btrim(p_notes)) ELSE '{}'::jsonb END
    );

    RETURN pg_catalog.jsonb_build_object('id', p_incident_id, 'status', v_status);
END;
$function$;

CREATE OR REPLACE FUNCTION public.kdj_admin_stop_followup(
    p_profile_id uuid,
    p_actor_admin_id uuid,
    p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_profile public.kdj_followup_profiles%ROWTYPE;
BEGIN
    IF p_profile_id IS NULL OR p_actor_admin_id IS NULL
       OR p_reason IS NULL OR length(pg_catalog.btrim(p_reason)) NOT BETWEEN 5 AND 1000
    THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_ADMIN_FOLLOWUP_STOP';
    END IF;

    SELECT * INTO v_profile
    FROM public.kdj_followup_profiles
    WHERE profile_id = p_profile_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'FOLLOWUP_PROFILE_NOT_FOUND';
    END IF;

    UPDATE public.kdj_followup_profiles
    SET sequence_status = 'STOPPED',
        stop_reason = 'ADMIN_STOP',
        admin_stopped_at = pg_catalog.now(),
        admin_stopped_by = p_actor_admin_id,
        admin_stop_reason = pg_catalog.btrim(p_reason),
        updated_at = pg_catalog.now()
    WHERE profile_id = p_profile_id;

    UPDATE public.kdj_followup_jobs
    SET status = 'CANCELLED', stop_reason = 'ADMIN_STOP', updated_at = pg_catalog.now()
    WHERE phone_local = v_profile.phone_local
      AND status IN ('HELD_COMPLIANCE', 'SCHEDULED', 'PROCESSING');

    INSERT INTO public.kdj_followup_control_events (profile_id, phone_local, action, actor_admin_id, reason)
    VALUES (p_profile_id, v_profile.phone_local, 'ADMIN_STOP', p_actor_admin_id, pg_catalog.btrim(p_reason));

    RETURN pg_catalog.jsonb_build_object('success', true, 'profile_id', p_profile_id, 'sequence_status', 'STOPPED');
END;
$function$;

CREATE OR REPLACE FUNCTION public.kdj_cancel_followups_for_lifecycle_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_digits text;
    v_phone_local text;
    v_reason text;
BEGIN
    IF TG_TABLE_NAME = 'pendaftar' THEN
        IF NEW.chat_handler IS DISTINCT FROM 'HUMAN' THEN
            RETURN NEW;
        END IF;
        v_digits := pg_catalog.regexp_replace(COALESCE(NEW.no_wa, ''), '\D', '', 'g');
        v_reason := 'HUMAN_HANDOVER';
    ELSIF TG_TABLE_NAME = 'jadwal_konsultasi' THEN
        IF NEW.status IS DISTINCT FROM 'Terjadwal' OR NEW.jadwal_pilihan IS NULL OR NEW.jadwal_pilihan < pg_catalog.now() THEN
            RETURN NEW;
        END IF;
        v_digits := pg_catalog.regexp_replace(COALESCE(NEW.no_wa, ''), '\D', '', 'g');
        v_reason := 'ACTIVE_BOOKING';
    ELSE
        RETURN NEW;
    END IF;

    IF pg_catalog.left(v_digits, 2) = '62' THEN
        v_phone_local := '0' || pg_catalog.substr(v_digits, 3);
    ELSIF pg_catalog.left(v_digits, 1) = '8' THEN
        v_phone_local := '0' || v_digits;
    ELSE
        v_phone_local := v_digits;
    END IF;

    IF v_phone_local !~ '^08[0-9]{8,11}$' THEN
        RETURN NEW;
    END IF;

    UPDATE public.kdj_followup_jobs
    SET status = 'CANCELLED', stop_reason = v_reason, updated_at = pg_catalog.now()
    WHERE phone_local = v_phone_local
      AND status IN ('HELD_COMPLIANCE', 'SCHEDULED', 'PROCESSING');

    UPDATE public.kdj_followup_profiles
    SET sequence_status = 'STOPPED', stop_reason = v_reason, updated_at = pg_catalog.now()
    WHERE phone_local = v_phone_local
      AND sequence_status <> 'STOPPED';

    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_kdj_cancel_fu_on_human_handover ON public.pendaftar;
CREATE TRIGGER trg_kdj_cancel_fu_on_human_handover
AFTER INSERT OR UPDATE OF chat_handler, no_wa ON public.pendaftar
FOR EACH ROW
WHEN (NEW.chat_handler = 'HUMAN')
EXECUTE FUNCTION public.kdj_cancel_followups_for_lifecycle_change();

DROP TRIGGER IF EXISTS trg_kdj_cancel_fu_on_active_booking ON public.jadwal_konsultasi;
CREATE TRIGGER trg_kdj_cancel_fu_on_active_booking
AFTER INSERT OR UPDATE OF status, jadwal_pilihan ON public.jadwal_konsultasi
FOR EACH ROW
WHEN (NEW.status = 'Terjadwal')
EXECUTE FUNCTION public.kdj_cancel_followups_for_lifecycle_change();

REVOKE ALL ON FUNCTION public.kdj_record_system_heartbeat(text, text, text, integer, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_open_system_incident(text, text, text, text, jsonb, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_update_system_incident(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_admin_stop_followup(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_cancel_followups_for_lifecycle_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_set_followup_consent(text, boolean, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_record_followup_inbound(text, text, timestamptz) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.kdj_record_system_heartbeat(text, text, text, integer, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.kdj_open_system_incident(text, text, text, text, jsonb, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.kdj_update_system_incident(uuid, text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.kdj_admin_stop_followup(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.kdj_cancel_followups_for_lifecycle_change() TO service_role;
GRANT EXECUTE ON FUNCTION public.kdj_set_followup_consent(text, boolean, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.kdj_record_followup_inbound(text, text, timestamptz) TO service_role;

COMMIT;
