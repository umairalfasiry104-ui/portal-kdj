-- KDJ Daily Business Report v2
-- Additive candidate migration. Existing v1 event ledger and v1 report RPC remain unchanged.
-- Do not apply to Staging/Production before local restore validation and separate approval.

BEGIN;

CREATE TABLE IF NOT EXISTS public.kdj_admin_daily_report_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_date date NOT NULL,
    report_version integer NOT NULL DEFAULT 2 CHECK (report_version = 2),
    window_start timestamptz NOT NULL,
    window_end timestamptz NOT NULL,
    generated_at timestamptz NOT NULL DEFAULT now(),
    snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
    coverage_complete boolean NOT NULL,
    coverage_note text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT kdj_admin_daily_report_window_valid CHECK (window_end > window_start),
    CONSTRAINT kdj_admin_daily_report_run_date_version_unique UNIQUE (report_date, report_version)
);

CREATE INDEX IF NOT EXISTS idx_kdj_admin_daily_report_runs_generated
    ON public.kdj_admin_daily_report_runs (generated_at DESC);

CREATE TABLE IF NOT EXISTS public.kdj_admin_daily_report_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_run_id uuid NOT NULL
        REFERENCES public.kdj_admin_daily_report_runs(id) ON DELETE RESTRICT,
    admin_id uuid NOT NULL
        REFERENCES public.admins(id) ON DELETE RESTRICT,
    admin_role text NOT NULL CHECK (admin_role IN ('Super Admin', 'Admin Konsultan')),
    recipient_phone text NOT NULL CHECK (length(btrim(recipient_phone)) BETWEEN 8 AND 40),
    idempotency_key text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'UNKNOWN')),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    claim_token uuid,
    lease_until timestamptz,
    last_error text,
    provider_message_id text,
    sent_at timestamptz,
    rendered_text text,
    formatter_version text,
    last_retry_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT kdj_admin_daily_report_delivery_run_admin_unique UNIQUE (report_run_id, admin_id),
    CONSTRAINT kdj_admin_daily_report_delivery_claim_consistency CHECK (
        (status = 'PROCESSING' AND claim_token IS NOT NULL AND lease_until IS NOT NULL)
        OR
        (status <> 'PROCESSING' AND claim_token IS NULL AND lease_until IS NULL)
    ),
    CONSTRAINT kdj_admin_daily_report_delivery_sent_consistency CHECK (
        (status = 'SENT' AND sent_at IS NOT NULL AND provider_message_id IS NOT NULL)
        OR
        (status <> 'SENT')
    )
);

CREATE INDEX IF NOT EXISTS idx_kdj_admin_daily_report_deliveries_queue
    ON public.kdj_admin_daily_report_deliveries (status, created_at)
    WHERE status IN ('PENDING', 'PROCESSING');

CREATE INDEX IF NOT EXISTS idx_kdj_admin_daily_report_deliveries_admin
    ON public.kdj_admin_daily_report_deliveries (admin_id, created_at DESC);

-- One WhatsApp account must receive at most one report variant per report run.
CREATE UNIQUE INDEX IF NOT EXISTS idx_kdj_admin_daily_report_delivery_run_recipient_unique
    ON public.kdj_admin_daily_report_deliveries (report_run_id, recipient_phone);

CREATE TABLE IF NOT EXISTS public.kdj_admin_daily_report_delivery_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_id uuid NOT NULL
        REFERENCES public.kdj_admin_daily_report_deliveries(id) ON DELETE RESTRICT,
    event_type text NOT NULL CHECK (event_type IN (
        'CLAIMED',
        'SENT',
        'FAILED',
        'UNKNOWN',
        'LEASE_EXPIRED_TO_UNKNOWN',
        'MANUAL_RETRY_AUTHORIZED',
        'UNKNOWN_RECONCILED'
    )),
    previous_status text,
    new_status text NOT NULL,
    actor_type text NOT NULL CHECK (actor_type IN ('SYSTEM', 'ADMIN')),
    actor_admin_id uuid REFERENCES public.admins(id) ON DELETE RESTRICT,
    reason text,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kdj_admin_daily_report_delivery_events_delivery_time
    ON public.kdj_admin_daily_report_delivery_events (delivery_id, created_at DESC);

-- One immutable report snapshot per business date/version. The old v1 stats RPC is not changed.
CREATE OR REPLACE FUNCTION public.kdj_generate_admin_daily_report(
    p_report_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_start timestamptz;
    v_end timestamptz;
    v_generated_at timestamptz := pg_catalog.now();
    v_coverage_started_at timestamptz;
    v_coverage_complete boolean;
    v_coverage_note text;
    v_snapshot jsonb;
    v_run public.kdj_admin_daily_report_runs%ROWTYPE;
    v_delivery_count integer := 0;
    v_total_leads integer := 0;
    v_duplicate_recipient_count integer := 0;
BEGIN
    IF p_report_date IS NULL
       OR p_report_date >= (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'REPORT_DATE_MUST_BE_A_COMPLETED_LOCAL_DAY';
    END IF;

    v_start := p_report_date::timestamp AT TIME ZONE 'Asia/Jakarta';
    v_end := (p_report_date + 1)::timestamp AT TIME ZONE 'Asia/Jakarta';

    SELECT business_ledger_enabled_at
    INTO v_coverage_started_at
    FROM public.kdj_registration_reporting_config
    WHERE id = 1;

    v_coverage_complete := v_coverage_started_at IS NOT NULL
        AND v_coverage_started_at <= v_start;

    v_coverage_note := CASE
        WHEN v_coverage_complete THEN 'Ledger bisnis tersedia sejak awal periode laporan.'
        WHEN v_coverage_started_at IS NULL THEN 'Waktu awal pencatatan ledger bisnis tidak tersedia; angka historis harus dianggap parsial.'
        ELSE 'Ledger bisnis baru mulai pada ' ||
             pg_catalog.to_char(v_coverage_started_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI:SS') ||
             ' WIB. Data sebelum waktu tersebut tidak dibackfill dan tidak dapat dianggap lengkap.'
    END;

    WITH new_leads AS (
        SELECT
            lead.phone_local,
            lead.lead_name,
            COALESCE(latest_event.category, 'UNCLASSIFIED') AS category,
            COALESCE(latest_event.operational_status, 'NORMAL') AS operational_status,
            latest_event.action AS latest_action
        FROM (
            SELECT
                profile.phone_local,
                COALESCE(
                    NULLIF(pg_catalog.btrim(applicant.nama_leads), ''),
                    NULLIF(pg_catalog.btrim(applicant.nama_lengkap), ''),
                    'Nama belum tersedia'
                ) AS lead_name
            FROM public.kdj_followup_profiles AS profile
            LEFT JOIN LATERAL (
                SELECT p.nama_leads, p.nama_lengkap
                FROM public.pendaftar AS p
                WHERE p.no_wa = profile.phone_local
                ORDER BY p.created_at ASC NULLS LAST, p.id
                LIMIT 1
            ) AS applicant ON true
            WHERE profile.first_inbound_at >= v_start
              AND profile.first_inbound_at < v_end
        ) AS lead
        LEFT JOIN LATERAL (
            SELECT e.category, e.operational_status, e.action
            FROM public.kdj_lead_qualification_events AS e
            WHERE e.phone_local = lead.phone_local
              AND e.created_at < v_end
              AND e.action IN ('BOT_RECOMMENDATION', 'ADMIN_CONFIRMED', 'ADMIN_REVISED', 'INVALIDATED_BY_INBOUND')
            ORDER BY e.created_at DESC, e.id DESC
            LIMIT 1
        ) AS latest_event ON true
    ),
    normalized_leads AS (
        SELECT
            phone_local,
            lead_name,
            CASE
                WHEN latest_action = 'INVALIDATED_BY_INBOUND' THEN 'UNCLASSIFIED'
                WHEN category IN ('PROSPEK', 'DINGIN', 'BIMBANG') THEN category
                ELSE 'UNCLASSIFIED'
            END AS category,
            CASE
                WHEN latest_action = 'INVALIDATED_BY_INBOUND' THEN 'NORMAL'
                WHEN operational_status IN ('NORMAL', 'MASIH_BERTANYA') THEN operational_status
                ELSE 'NORMAL'
            END AS operational_status
        FROM new_leads
    ),
    lead_counts AS (
        SELECT
            count(*)::integer AS total,
            count(*) FILTER (WHERE category = 'PROSPEK')::integer AS prospek,
            count(*) FILTER (WHERE category = 'DINGIN')::integer AS dingin,
            count(*) FILTER (WHERE category = 'BIMBANG')::integer AS bimbang,
            count(*) FILTER (WHERE category = 'UNCLASSIFIED')::integer AS unclassified,
            count(*) FILTER (WHERE operational_status = 'MASIH_BERTANYA')::integer AS masih_bertanya
        FROM normalized_leads
    ),
    prospek_people AS (
        SELECT COALESCE(
            pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object(
                    'name', lead_name,
                    'phone', phone_local
                )
                ORDER BY lead_name, phone_local
            ),
            '[]'::jsonb
        ) AS rows
        FROM normalized_leads
        WHERE category = 'PROSPEK'
    )
    SELECT total INTO v_total_leads FROM lead_counts;

    WITH new_leads AS (
        SELECT
            profile.phone_local,
            COALESCE(latest_event.category, 'UNCLASSIFIED') AS category,
            COALESCE(latest_event.operational_status, 'NORMAL') AS operational_status,
            latest_event.action AS latest_action
        FROM public.kdj_followup_profiles AS profile
        LEFT JOIN LATERAL (
            SELECT e.category, e.operational_status, e.action
            FROM public.kdj_lead_qualification_events AS e
            WHERE e.phone_local = profile.phone_local
              AND e.created_at < v_end
              AND e.action IN ('BOT_RECOMMENDATION', 'ADMIN_CONFIRMED', 'ADMIN_REVISED', 'INVALIDATED_BY_INBOUND')
            ORDER BY e.created_at DESC, e.id DESC
            LIMIT 1
        ) AS latest_event ON true
        WHERE profile.first_inbound_at >= v_start
          AND profile.first_inbound_at < v_end
    ),
    normalized_leads AS (
        SELECT
            phone_local,
            CASE
                WHEN latest_action = 'INVALIDATED_BY_INBOUND' THEN 'UNCLASSIFIED'
                WHEN category IN ('PROSPEK', 'DINGIN', 'BIMBANG') THEN category
                ELSE 'UNCLASSIFIED'
            END AS category,
            CASE
                WHEN latest_action = 'INVALIDATED_BY_INBOUND' THEN 'NORMAL'
                WHEN operational_status IN ('NORMAL', 'MASIH_BERTANYA') THEN operational_status
                ELSE 'NORMAL'
            END AS operational_status
        FROM new_leads
    ),
    lead_counts AS (
        SELECT
            count(*)::integer AS total,
            count(*) FILTER (WHERE category = 'PROSPEK')::integer AS prospek,
            count(*) FILTER (WHERE category = 'DINGIN')::integer AS dingin,
            count(*) FILTER (WHERE category = 'BIMBANG')::integer AS bimbang,
            count(*) FILTER (WHERE category = 'UNCLASSIFIED')::integer AS unclassified,
            count(*) FILTER (WHERE operational_status = 'MASIH_BERTANYA')::integer AS masih_bertanya
        FROM normalized_leads
    ),
    prospek_people AS (
        SELECT COALESCE(
            pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object(
                    'name', COALESCE(prospect.name, 'Nama belum tersedia'),
                    'phone', normalized.phone_local
                )
                ORDER BY COALESCE(prospect.name, normalized.phone_local)
            ),
            '[]'::jsonb
        ) AS rows
        FROM normalized_leads AS normalized
        LEFT JOIN LATERAL (
            SELECT COALESCE(
                NULLIF(pg_catalog.btrim(p.nama_leads), ''),
                NULLIF(pg_catalog.btrim(p.nama_lengkap), '')
            ) AS name
            FROM public.pendaftar AS p
            WHERE p.no_wa = normalized.phone_local
            ORDER BY p.created_at ASC NULLS LAST, p.id
            LIMIT 1
        ) AS prospect ON true
        WHERE normalized.category = 'PROSPEK'
    ),
    consults AS (
        SELECT
            count(DISTINCT o.booking_id) FILTER (
                WHERE o.event_type = 'BOOKING_CREATED'
            )::integer AS scheduled,
            count(DISTINCT o.booking_id) FILTER (
                WHERE o.event_type = 'BOOKING_STATUS_UPDATED'
                  AND o.booking_status = 'Selesai'
            )::integer AS completed
        FROM public.booking_notification_outbox AS o
        WHERE o.created_at >= v_start AND o.created_at < v_end
    ),
    payments_at_cutoff AS (
        SELECT
            payment.pendaftar_id,
            latest_payment_event.new_status AS state_at_cutoff
        FROM public.kdj_registration_payments AS payment
        LEFT JOIN LATERAL (
            SELECT event.new_status
            FROM public.kdj_registration_payment_events AS event
            WHERE event.payment_id = payment.id
              AND event.created_at < v_end
            ORDER BY event.created_at DESC, event.id DESC
            LIMIT 1
        ) AS latest_payment_event ON true
        WHERE payment.initial_submission_at < v_end
    ),
    unpaid_eod AS (
        SELECT count(DISTINCT pendaftar_id)::integer AS total
        FROM payments_at_cutoff
        WHERE state_at_cutoff IS DISTINCT FROM 'PAID'
    ),
    closing_today AS (
        SELECT count(DISTINCT pendaftar_id)::integer AS total
        FROM public.kdj_registration_payment_events
        WHERE event_type = 'PAYMENT_VERIFIED_PAID'
          AND created_at >= v_start AND created_at < v_end
    ),
    submissions_today AS (
        SELECT count(DISTINCT pendaftar_id)::integer AS total
        FROM public.kdj_registration_events
        WHERE event_type IN ('APPLICATION_SUBMITTED', 'APPLICATION_RESUBMITTED')
          AND created_at >= v_start AND created_at < v_end
    )
    SELECT
        pg_catalog.jsonb_build_object(
            'report_date', p_report_date::text,
            'generated_at', v_generated_at,
            'timezone', 'Asia/Jakarta',
            'window_start', v_start,
            'window_end', v_end,
            'coverage', pg_catalog.jsonb_build_object(
                'complete', v_coverage_complete,
                'started_at', v_coverage_started_at,
                'note', v_coverage_note
            ),
            'business', pg_catalog.jsonb_build_object(
                'new_leads', pg_catalog.jsonb_build_object(
                    'total', lead_counts.total,
                    'category_counts', pg_catalog.jsonb_build_object(
                        'PROSPEK', lead_counts.prospek,
                        'DINGIN', lead_counts.dingin,
                        'BIMBANG', lead_counts.bimbang,
                        'UNCLASSIFIED', lead_counts.unclassified
                    ),
                    'masih_bertanya', lead_counts.masih_bertanya,
                    'prospek', prospek_people.rows
                ),
                'consultations', pg_catalog.jsonb_build_object(
                    'scheduled', consults.scheduled,
                    'completed', consults.completed
                ),
                'registrations', pg_catalog.jsonb_build_object(
                    'closing_today', closing_today.total,
                    'data_complete_unpaid_eod', unpaid_eod.total,
                    'documents_submitted_today', submissions_today.total
                )
            )
        )
    INTO v_snapshot
    FROM lead_counts, prospek_people, consults, unpaid_eod, closing_today, submissions_today;

    -- Fail closed when multiple active Admin records point to the same normalized WhatsApp number.
    WITH active_admins AS (
        SELECT
            admin.id,
            CASE
                WHEN raw_phone.digits LIKE '62%' THEN '0' || pg_catalog.substr(raw_phone.digits, 3)
                WHEN raw_phone.digits LIKE '8%' THEN '0' || raw_phone.digits
                ELSE raw_phone.digits
            END AS phone_local
        FROM public.admins AS admin
        CROSS JOIN LATERAL (
            SELECT pg_catalog.regexp_replace(COALESCE(admin.no_wa, ''), '[^0-9]', '', 'g') AS digits
        ) AS raw_phone
        WHERE admin.is_active IS TRUE
          AND admin.disabled_at IS NULL
          AND admin.role IN ('Admin Konsultan', 'Super Admin')
    ),
    valid_admins AS (
        SELECT id, phone_local
        FROM active_admins
        WHERE phone_local ~ '^08[0-9]{8,13}$'
    )
    SELECT count(*)::integer
    INTO v_duplicate_recipient_count
    FROM (
        SELECT phone_local
        FROM valid_admins
        GROUP BY phone_local
        HAVING count(*) > 1
    ) AS duplicate_numbers;

    -- Component heartbeat thresholds are tied to measured emitters:
    -- Bot/WhatsApp/Gemini/Supabase use the 30s Bot heartbeat or on-demand request signal (180s grace);
    -- Portal is checked on its health/admin-monitoring route (300s grace).
    WITH latest_heartbeat AS (
        SELECT DISTINCT ON (component)
            component, status, observed_at, latency_ms
        FROM public.kdj_system_heartbeats
        ORDER BY component, observed_at DESC
    ),
    expected(component, source_component, stale_after_seconds) AS (
        VALUES
            ('WhatsApp Bot', 'bot_process', 180),
            ('WhatsApp connection', 'whatsapp', 180),
            ('Gemini', 'gemini', 180),
            ('Portal', 'portal', 300),
            ('Supabase', 'supabase', 180)
    ),
    mapped_health AS (
        SELECT
            expected.component,
            CASE
                WHEN heartbeat.component IS NULL THEN 'NOT_CHECKED'
                WHEN heartbeat.observed_at < v_generated_at
                    - pg_catalog.make_interval(secs => expected.stale_after_seconds) THEN 'STALE'
                WHEN pg_catalog.upper(heartbeat.status) IN ('OK', 'READY', 'HEALTHY') THEN 'OK'
                WHEN pg_catalog.upper(heartbeat.status) IN ('DOWN', 'ERROR', 'FAILED') THEN 'DOWN'
                ELSE 'DEGRADED'
            END AS status,
            heartbeat.observed_at,
            heartbeat.latency_ms,
            CASE
                WHEN heartbeat.component IS NULL THEN NULL
                WHEN heartbeat.observed_at < v_generated_at
                    - pg_catalog.make_interval(secs => expected.stale_after_seconds)
                    THEN 'Heartbeat lebih lama dari ' || expected.stale_after_seconds::text || ' detik.'
                ELSE heartbeat.status
            END AS raw_status
        FROM expected
        LEFT JOIN latest_heartbeat AS heartbeat
          ON heartbeat.component = expected.source_component
    ),
    queue_state AS (
        SELECT
            count(*) FILTER (WHERE status = 'PENDING')::integer AS pending,
            count(*) FILTER (WHERE status = 'PROCESSING')::integer AS processing,
            count(*) FILTER (WHERE status = 'FAILED')::integer AS failed,
            count(*) FILTER (WHERE status = 'UNKNOWN')::integer AS unknown
        FROM public.booking_notification_outbox
    ),
    open_incidents AS (
        SELECT COALESCE(
            pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object(
                    'severity', severity,
                    'module', module,
                    'title', title,
                    'status', status,
                    'first_seen_at', first_seen_at,
                    'last_seen_at', last_seen_at,
                    'impact', COALESCE(evidence->>'impact', 'Dampak belum dapat dipastikan dari metadata incident.'),
                    'recommended_action', CASE
                        WHEN pg_catalog.lower(module) LIKE '%portal%' THEN 'Periksa log Portal pada route yang terdampak dan verifikasi koneksi dependency terkait.'
                        WHEN pg_catalog.lower(module) LIKE '%database%' OR pg_catalog.lower(module) LIKE '%supabase%' THEN 'Periksa koneksi Supabase, query error, latency, dan kapasitas database.'
                        WHEN pg_catalog.lower(module) LIKE '%whatsapp%' OR pg_catalog.lower(module) LIKE '%bot%' THEN 'Periksa heartbeat Bot, koneksi WhatsApp, log error, dan antrean yang tertahan.'
                        ELSE 'Periksa log modul terkait, korelasikan waktu kejadian, dan verifikasi dampak sebelum melakukan perubahan.'
                    END
                ) ORDER BY
                    CASE severity WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
                    first_seen_at
            ),
            '[]'::jsonb
        ) AS rows
        FROM public.kdj_system_incidents
        WHERE status IN ('OPEN', 'ACKNOWLEDGED', 'INVESTIGATING')
    ),
    control_state AS (
        SELECT global_safe_mode
        FROM public.kdj_system_controls
        WHERE id = 1
    )
    SELECT
        v_snapshot ||
        pg_catalog.jsonb_build_object(
            'system',
            pg_catalog.jsonb_build_object(
                'health',
                (
                    SELECT pg_catalog.jsonb_agg(
                        pg_catalog.jsonb_build_object(
                            'component', component,
                            'status', status,
                            'observed_at', observed_at,
                            'note', CASE
                                WHEN status = 'STALE' THEN raw_status
                                WHEN status = 'NOT_CHECKED' THEN 'Belum ada heartbeat untuk komponen ini.'
                                ELSE raw_status
                            END,
                            'latency_ms', latency_ms
                        ) ORDER BY component
                    )
                    FROM (
                        SELECT * FROM mapped_health
                        UNION ALL
                        SELECT 'Storage', 'NOT_CHECKED', NULL::timestamptz, NULL::integer, NULL::text
                        UNION ALL
                        SELECT 'Cron evaluator', 'NOT_CHECKED', NULL::timestamptz, NULL::integer, NULL::text
                        UNION ALL
                        SELECT 'Database query', 'OK', v_generated_at, NULL::integer, 'Report snapshot query completed.'
                        UNION ALL
                        SELECT 'Admin report delivery',
                            CASE
                                WHEN EXISTS (SELECT 1 FROM public.kdj_admin_daily_report_deliveries WHERE status IN ('FAILED', 'UNKNOWN')) THEN 'DEGRADED'
                                WHEN EXISTS (SELECT 1 FROM public.kdj_admin_daily_report_deliveries WHERE status IN ('PENDING', 'PROCESSING')) THEN 'DEGRADED'
                                ELSE 'OK'
                            END,
                            v_generated_at, NULL::integer, 'Based on current durable Admin report delivery states.'
                    ) AS all_health
                ),
                'incidents', (SELECT rows FROM open_incidents),
                'global_safe_mode', (SELECT global_safe_mode FROM control_state),
                'recipient_conflict_count', v_duplicate_recipient_count,
                'booking_notification_queue', (SELECT pg_catalog.to_jsonb(queue_state) FROM queue_state),
                'recommendations', pg_catalog.jsonb_build_object(
                    'daily', pg_catalog.jsonb_build_array(
                        'Periksa status Bot, WhatsApp, Gemini, Portal, dan Supabase berdasarkan heartbeat terbaru.',
                        'Tinjau antrean notification PENDING/FAILED/UNKNOWN; jangan mengirim ulang hasil UNKNOWN sebelum rekonsiliasi.',
                        'Pastikan report yang gagal kirim memiliki status dan alasan yang tercatat.'
                    ),
                    'weekly', pg_catalog.jsonb_build_array(
                        'Audit dependency dan advisory keamanan yang masih berlaku.',
                        'Tinjau kapasitas database dan Storage serta query yang lambat.',
                        'Verifikasi integritas backup dan catatan restore drill.'
                    )
                )
            )
        )
    INTO v_snapshot;

    INSERT INTO public.kdj_admin_daily_report_runs (
        report_date, report_version, window_start, window_end,
        generated_at, snapshot, coverage_complete, coverage_note
    )
    VALUES (
        p_report_date, 2, v_start, v_end, v_generated_at,
        v_snapshot, v_coverage_complete, v_coverage_note
    )
    ON CONFLICT (report_date, report_version) DO NOTHING;

    SELECT * INTO v_run
    FROM public.kdj_admin_daily_report_runs
    WHERE report_date = p_report_date AND report_version = 2;

    -- Return the immutable stored snapshot's count on idempotent re-generation.
    v_total_leads := COALESCE((v_run.snapshot #>> '{business,new_leads,total}')::integer, 0);

    WITH active_admins AS (
        SELECT
            admin.id,
            admin.role,
            CASE
                WHEN raw_phone.digits LIKE '62%' THEN '0' || pg_catalog.substr(raw_phone.digits, 3)
                WHEN raw_phone.digits LIKE '8%' THEN '0' || raw_phone.digits
                ELSE raw_phone.digits
            END AS phone_local
        FROM public.admins AS admin
        CROSS JOIN LATERAL (
            SELECT pg_catalog.regexp_replace(COALESCE(admin.no_wa, ''), '[^0-9]', '', 'g') AS digits
        ) AS raw_phone
        WHERE admin.is_active IS TRUE
          AND admin.disabled_at IS NULL
          AND admin.role IN ('Admin Konsultan', 'Super Admin')
    ),
    valid_admins AS (
        SELECT id, role, phone_local
        FROM active_admins
        WHERE phone_local ~ '^08[0-9]{8,13}$'
    ),
    unambiguous_recipients AS (
        SELECT id, role, phone_local
        FROM (
            SELECT
                id,
                role,
                phone_local,
                count(*) OVER (PARTITION BY phone_local) AS phone_owner_count
            FROM valid_admins
        ) AS candidates
        WHERE phone_owner_count = 1
    )
    INSERT INTO public.kdj_admin_daily_report_deliveries (
        report_run_id, admin_id, admin_role, recipient_phone, idempotency_key
    )
    SELECT
        v_run.id,
        recipient.id,
        recipient.role,
        recipient.phone_local,
        'KDJ_ADMIN_DAILY_REPORT_V2:' || p_report_date::text || ':' || recipient.id::text
    FROM unambiguous_recipients AS recipient
    ON CONFLICT (report_run_id, admin_id) DO NOTHING;

    GET DIAGNOSTICS v_delivery_count = ROW_COUNT;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'report_run_id', v_run.id,
        'report_date', p_report_date,
        'report_version', 2,
        'new_leads', v_total_leads,
        'coverage_complete', v_run.coverage_complete,
        'recipient_conflicts', COALESCE((v_run.snapshot #>> '{system,recipient_conflict_count}')::integer, v_duplicate_recipient_count),
        'delivery_rows_created', v_delivery_count
    );
END;
$function$;

-- Claim is durable and bounded. An expired PROCESSING lease becomes UNKNOWN, never PENDING.
CREATE OR REPLACE FUNCTION public.kdj_claim_admin_daily_report_deliveries(
    p_limit integer DEFAULT 10,
    p_lease_seconds integer DEFAULT 120
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_row record;
    v_token uuid;
    v_rows jsonb := '[]'::jsonb;
    v_count integer := 0;
BEGIN
    IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50
       OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 600 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_ADMIN_REPORT_CLAIM_ARGUMENTS';
    END IF;

    WITH expired AS (
        UPDATE public.kdj_admin_daily_report_deliveries
        SET status = 'UNKNOWN',
            claim_token = NULL,
            lease_until = NULL,
            last_error = COALESCE(last_error, 'Delivery lease expired; provider result may be unknown.'),
            updated_at = pg_catalog.now()
        WHERE status = 'PROCESSING'
          AND lease_until < pg_catalog.now()
        RETURNING id
    )
    INSERT INTO public.kdj_admin_daily_report_delivery_events (
        delivery_id, event_type, previous_status, new_status, actor_type, reason
    )
    SELECT id, 'LEASE_EXPIRED_TO_UNKNOWN', 'PROCESSING', 'UNKNOWN', 'SYSTEM',
           'Lease expired. Delivery is held for manual reconciliation; no automatic resend.'
    FROM expired;

    FOR v_row IN
        SELECT
            d.id,
            d.report_run_id,
            d.admin_id,
            d.admin_role,
            d.recipient_phone,
            r.snapshot,
            r.report_date
        FROM public.kdj_admin_daily_report_deliveries AS d
        JOIN public.kdj_admin_daily_report_runs AS r
          ON r.id = d.report_run_id
        JOIN public.admins AS a
          ON a.id = d.admin_id
         AND a.is_active IS TRUE
         AND a.disabled_at IS NULL
         AND a.role = d.admin_role
        WHERE d.status = 'PENDING'
          AND d.admin_role IN ('Admin Konsultan', 'Super Admin')
        ORDER BY r.report_date, d.admin_role, d.admin_id
        LIMIT p_limit
        FOR UPDATE OF d SKIP LOCKED
    LOOP
        v_token := pg_catalog.gen_random_uuid();

        UPDATE public.kdj_admin_daily_report_deliveries
        SET status = 'PROCESSING',
            attempts = attempts + 1,
            claim_token = v_token,
            lease_until = pg_catalog.now() + pg_catalog.make_interval(secs => p_lease_seconds),
            updated_at = pg_catalog.now()
        WHERE id = v_row.id;

        INSERT INTO public.kdj_admin_daily_report_delivery_events (
            delivery_id, event_type, previous_status, new_status, actor_type, reason,
            evidence
        )
        VALUES (
            v_row.id, 'CLAIMED', 'PENDING', 'PROCESSING', 'SYSTEM',
            'Claimed by an authorized Bot report worker.',
            pg_catalog.jsonb_build_object('lease_seconds', p_lease_seconds)
        );

        v_rows := v_rows || pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object(
                'delivery_id', v_row.id,
                'report_run_id', v_row.report_run_id,
                'report_date', v_row.report_date,
                'admin_id', v_row.admin_id,
                'admin_role', v_row.admin_role,
                'recipient_phone', v_row.recipient_phone,
                'report_snapshot', v_row.snapshot,
                'claim_token', v_token
            )
        );
        v_count := v_count + 1;
    END LOOP;

    RETURN pg_catalog.jsonb_build_object('success', true, 'claimed_count', v_count, 'deliveries', v_rows);
END;
$function$;

CREATE OR REPLACE FUNCTION public.kdj_finish_admin_daily_report_delivery(
    p_delivery_id uuid,
    p_claim_token uuid,
    p_outcome text,
    p_error text DEFAULT NULL,
    p_provider_message_id text DEFAULT NULL,
    p_rendered_text text DEFAULT NULL,
    p_formatter_version text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_delivery public.kdj_admin_daily_report_deliveries%ROWTYPE;
    v_event_type text;
BEGIN
    IF p_delivery_id IS NULL OR p_claim_token IS NULL
       OR p_outcome IS NULL OR p_outcome NOT IN ('SENT', 'FAILED', 'UNKNOWN')
       OR (p_outcome = 'SENT' AND NULLIF(pg_catalog.btrim(p_provider_message_id), '') IS NULL)
       OR (p_outcome <> 'SENT' AND NULLIF(pg_catalog.btrim(p_error), '') IS NULL)
       OR (p_rendered_text IS NOT NULL AND length(p_rendered_text) > 20000)
       OR (p_formatter_version IS NOT NULL AND length(p_formatter_version) > 80) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_ADMIN_REPORT_DELIVERY_OUTCOME';
    END IF;

    SELECT * INTO v_delivery
    FROM public.kdj_admin_daily_report_deliveries
    WHERE id = p_delivery_id
    FOR UPDATE;

    IF NOT FOUND OR v_delivery.status <> 'PROCESSING'
       OR v_delivery.claim_token IS DISTINCT FROM p_claim_token
       OR v_delivery.lease_until < pg_catalog.now() THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'ADMIN_REPORT_DELIVERY_CLAIM_STALE';
    END IF;

    v_event_type := p_outcome;

    UPDATE public.kdj_admin_daily_report_deliveries
    SET status = p_outcome,
        claim_token = NULL,
        lease_until = NULL,
        last_error = CASE WHEN p_outcome = 'SENT' THEN NULL ELSE left(p_error, 2000) END,
        provider_message_id = CASE WHEN p_outcome = 'SENT' THEN p_provider_message_id ELSE NULL END,
        sent_at = CASE WHEN p_outcome = 'SENT' THEN pg_catalog.now() ELSE NULL END,
        rendered_text = COALESCE(p_rendered_text, rendered_text),
        formatter_version = COALESCE(p_formatter_version, formatter_version),
        updated_at = pg_catalog.now()
    WHERE id = p_delivery_id;

    INSERT INTO public.kdj_admin_daily_report_delivery_events (
        delivery_id, event_type, previous_status, new_status, actor_type, reason,
        evidence
    )
    VALUES (
        p_delivery_id, v_event_type, 'PROCESSING', p_outcome, 'SYSTEM',
        CASE WHEN p_outcome = 'SENT' THEN 'Provider returned a message reference.'
             ELSE left(p_error, 2000) END,
        pg_catalog.jsonb_build_object('provider_message_id', p_provider_message_id)
    );

    RETURN pg_catalog.jsonb_build_object('success', true, 'delivery_id', p_delivery_id, 'status', p_outcome);
END;
$function$;

CREATE OR REPLACE FUNCTION public.kdj_admin_reconcile_daily_report_delivery(
    p_delivery_id uuid,
    p_resolution text,
    p_reason text,
    p_actor_admin_id uuid,
    p_provider_message_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_admin public.admins%ROWTYPE;
    v_delivery public.kdj_admin_daily_report_deliveries%ROWTYPE;
BEGIN
    IF p_delivery_id IS NULL
       OR p_resolution IS NULL OR p_resolution NOT IN ('SENT', 'FAILED')
       OR p_reason IS NULL OR length(pg_catalog.btrim(p_reason)) NOT BETWEEN 3 AND 1000
       OR p_actor_admin_id IS NULL
       OR (p_resolution = 'SENT' AND NULLIF(pg_catalog.btrim(p_provider_message_id), '') IS NULL) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_ADMIN_REPORT_RECONCILIATION';
    END IF;

    SELECT * INTO v_admin
    FROM public.admins
    WHERE id = p_actor_admin_id
      AND is_active IS TRUE
      AND disabled_at IS NULL
      AND role = 'Super Admin'
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SUPER_ADMIN_REQUIRED_FOR_REPORT_RECONCILIATION';
    END IF;

    SELECT * INTO v_delivery
    FROM public.kdj_admin_daily_report_deliveries
    WHERE id = p_delivery_id
    FOR UPDATE;

    IF NOT FOUND OR v_delivery.status <> 'UNKNOWN' THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'REPORT_DELIVERY_NOT_UNKNOWN';
    END IF;

    UPDATE public.kdj_admin_daily_report_deliveries
    SET status = p_resolution,
        claim_token = NULL,
        lease_until = NULL,
        last_error = CASE WHEN p_resolution = 'FAILED' THEN pg_catalog.btrim(p_reason) ELSE NULL END,
        provider_message_id = CASE WHEN p_resolution = 'SENT' THEN p_provider_message_id ELSE NULL END,
        sent_at = CASE WHEN p_resolution = 'SENT' THEN pg_catalog.now() ELSE NULL END,
        updated_at = pg_catalog.now()
    WHERE id = p_delivery_id;

    INSERT INTO public.kdj_admin_daily_report_delivery_events (
        delivery_id, event_type, previous_status, new_status, actor_type,
        actor_admin_id, reason, evidence
    )
    VALUES (
        p_delivery_id, 'UNKNOWN_RECONCILED', 'UNKNOWN', p_resolution,
        'ADMIN', p_actor_admin_id, pg_catalog.btrim(p_reason),
        pg_catalog.jsonb_build_object('provider_message_id', p_provider_message_id)
    );

    RETURN pg_catalog.jsonb_build_object('success', true, 'delivery_id', p_delivery_id, 'status', p_resolution);
END;
$function$;

CREATE OR REPLACE FUNCTION public.kdj_admin_retry_failed_daily_report_delivery(
    p_delivery_id uuid,
    p_reason text,
    p_actor_admin_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_admin public.admins%ROWTYPE;
    v_delivery public.kdj_admin_daily_report_deliveries%ROWTYPE;
BEGIN
    IF p_delivery_id IS NULL OR p_reason IS NULL
       OR length(pg_catalog.btrim(p_reason)) NOT BETWEEN 3 AND 1000
       OR p_actor_admin_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_ADMIN_REPORT_RETRY';
    END IF;

    SELECT * INTO v_admin
    FROM public.admins
    WHERE id = p_actor_admin_id
      AND is_active IS TRUE
      AND disabled_at IS NULL
      AND role = 'Super Admin'
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SUPER_ADMIN_REQUIRED_FOR_REPORT_RETRY';
    END IF;

    SELECT * INTO v_delivery
    FROM public.kdj_admin_daily_report_deliveries
    WHERE id = p_delivery_id
    FOR UPDATE;

    IF NOT FOUND OR v_delivery.status <> 'FAILED' THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'ONLY_PROVEN_FAILED_REPORT_MAY_BE_RETRIED';
    END IF;

    UPDATE public.kdj_admin_daily_report_deliveries
    SET status = 'PENDING',
        claim_token = NULL,
        lease_until = NULL,
        last_retry_reason = pg_catalog.btrim(p_reason),
        last_error = NULL,
        updated_at = pg_catalog.now()
    WHERE id = p_delivery_id;

    INSERT INTO public.kdj_admin_daily_report_delivery_events (
        delivery_id, event_type, previous_status, new_status,
        actor_type, actor_admin_id, reason
    )
    VALUES (
        p_delivery_id, 'MANUAL_RETRY_AUTHORIZED', 'FAILED', 'PENDING',
        'ADMIN', p_actor_admin_id, pg_catalog.btrim(p_reason)
    );

    RETURN pg_catalog.jsonb_build_object('success', true, 'delivery_id', p_delivery_id, 'status', 'PENDING');
END;
$function$;

ALTER TABLE public.kdj_admin_daily_report_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kdj_admin_daily_report_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kdj_admin_daily_report_delivery_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
    public.kdj_admin_daily_report_runs,
    public.kdj_admin_daily_report_deliveries,
    public.kdj_admin_daily_report_delivery_events
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT ON TABLE public.kdj_admin_daily_report_runs TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.kdj_admin_daily_report_deliveries TO service_role;
GRANT SELECT, INSERT ON TABLE public.kdj_admin_daily_report_delivery_events TO service_role;

REVOKE ALL ON FUNCTION public.kdj_generate_admin_daily_report(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_claim_admin_daily_report_deliveries(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_finish_admin_daily_report_delivery(uuid, uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_admin_reconcile_daily_report_delivery(uuid, text, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_admin_retry_failed_daily_report_delivery(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.kdj_generate_admin_daily_report(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.kdj_claim_admin_daily_report_deliveries(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.kdj_finish_admin_daily_report_delivery(uuid, uuid, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.kdj_admin_reconcile_daily_report_delivery(uuid, text, text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.kdj_admin_retry_failed_daily_report_delivery(uuid, text, uuid) TO service_role;

-- Automatic schedule intentionally omitted: KDJ reports remain Admin-initiated only.

COMMIT;

