-- =============================================================================
-- KDJ DEPARTURE BATCHES — MONTH/YEAR PERIOD + CONFIRMED DATE LIFECYCLE
-- Owner-directed Production migration reviewed on 2026-11-18.
-- Historical estimates are informational only; H-45 follow-up uses confirmed_departure_date.
-- H-45 is a follow-up trigger, not a payment deadline or installment restriction.
-- Existing installment submission/review RPCs are not altered.
-- =============================================================================

BEGIN;

CREATE TABLE public.kdj_departure_batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_code text NOT NULL UNIQUE
        CHECK (batch_code ~ '^[A-Z0-9][A-Z0-9_-]{2,39}$'),
    name text NOT NULL
        CHECK (length(btrim(name)) BETWEEN 1 AND 120),
    departure_month date NOT NULL
        CHECK (EXTRACT(DAY FROM departure_month) = 1),
    estimated_departure_date date,
    confirmed_departure_date date,
    status text NOT NULL DEFAULT 'PLANNED'
        CHECK (status IN ('PLANNED', 'CONFIRMED', 'CLOSED', 'CANCELLED')),
    note text,
    created_by_admin_id uuid NOT NULL REFERENCES public.admins(id) ON DELETE RESTRICT,
    updated_by_admin_id uuid NOT NULL REFERENCES public.admins(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT kdj_departure_batch_estimate_month_check CHECK (
        estimated_departure_date IS NULL
        OR date_trunc('month', estimated_departure_date)::date = departure_month
    ),
    CONSTRAINT kdj_departure_batch_confirmed_month_check CHECK (
        confirmed_departure_date IS NULL
        OR date_trunc('month', confirmed_departure_date)::date = departure_month
    ),
    CONSTRAINT kdj_departure_batch_confirmed_status_check CHECK (
        status NOT IN ('CONFIRMED', 'CLOSED')
        OR confirmed_departure_date IS NOT NULL
    )
);

CREATE INDEX idx_kdj_departure_batches_month_status
    ON public.kdj_departure_batches (departure_month, status);
CREATE INDEX idx_kdj_departure_batches_created_by
    ON public.kdj_departure_batches (created_by_admin_id);
CREATE INDEX idx_kdj_departure_batches_updated_by
    ON public.kdj_departure_batches (updated_by_admin_id);

ALTER TABLE public.kdj_departure_orders
    ADD COLUMN departure_batch_id uuid;

ALTER TABLE public.kdj_departure_orders
    ADD CONSTRAINT kdj_departure_orders_batch_fk
    FOREIGN KEY (departure_batch_id)
    REFERENCES public.kdj_departure_batches(id)
    ON DELETE RESTRICT;

CREATE INDEX idx_kdj_departure_orders_batch
    ON public.kdj_departure_orders (departure_batch_id)
    WHERE departure_batch_id IS NOT NULL;

CREATE TABLE public.kdj_departure_batch_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id uuid REFERENCES public.kdj_departure_batches(id) ON DELETE RESTRICT,
    order_id uuid REFERENCES public.kdj_departure_orders(id) ON DELETE RESTRICT,
    previous_batch_id uuid REFERENCES public.kdj_departure_batches(id) ON DELETE RESTRICT,
    new_batch_id uuid REFERENCES public.kdj_departure_batches(id) ON DELETE RESTRICT,
    event_type text NOT NULL CHECK (event_type IN (
        'BATCH_CREATED',
        'ESTIMATE_UPDATED',
        'DATE_CONFIRMED',
        'DATE_CHANGED',
        'ORDER_ASSIGNED',
        'ORDER_REASSIGNED'
    )),
    previous_departure_month date,
    new_departure_month date,
    previous_estimated_departure_date date,
    new_estimated_departure_date date,
    previous_confirmed_departure_date date,
    new_confirmed_departure_date date,
    previous_status text,
    new_status text,
    actor_admin_id uuid NOT NULL REFERENCES public.admins(id) ON DELETE RESTRICT,
    reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 1000),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT kdj_departure_batch_event_context_check CHECK (
        (event_type IN ('ORDER_ASSIGNED', 'ORDER_REASSIGNED') AND order_id IS NOT NULL AND new_batch_id IS NOT NULL)
        OR
        (event_type NOT IN ('ORDER_ASSIGNED', 'ORDER_REASSIGNED') AND batch_id IS NOT NULL)
    )
);

CREATE INDEX idx_kdj_departure_batch_events_batch_time
    ON public.kdj_departure_batch_events (batch_id, created_at DESC)
    WHERE batch_id IS NOT NULL;

CREATE INDEX idx_kdj_departure_batch_events_order_time
    ON public.kdj_departure_batch_events (order_id, created_at DESC)
    WHERE order_id IS NOT NULL;

CREATE INDEX idx_kdj_departure_batch_events_previous_batch
    ON public.kdj_departure_batch_events (previous_batch_id)
    WHERE previous_batch_id IS NOT NULL;

CREATE INDEX idx_kdj_departure_batch_events_new_batch
    ON public.kdj_departure_batch_events (new_batch_id)
    WHERE new_batch_id IS NOT NULL;

CREATE INDEX idx_kdj_departure_batch_events_actor_admin
    ON public.kdj_departure_batch_events (actor_admin_id);

-- Create a new monthly/yearly departure wave. Estimated dates are not financial dates.
CREATE OR REPLACE FUNCTION public.kdj_admin_create_departure_batch(
    p_batch_code text,
    p_name text,
    p_departure_month date,
    p_estimated_departure_date date,
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
    v_batch public.kdj_departure_batches%ROWTYPE;
    v_code text := pg_catalog.upper(pg_catalog.btrim(p_batch_code));
BEGIN
    IF p_batch_code IS NULL
       OR p_departure_month IS NULL
       OR EXTRACT(DAY FROM p_departure_month) <> 1
       OR p_departure_month < pg_catalog.date_trunc('month', pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date
       OR v_code !~ '^[A-Z0-9][A-Z0-9_-]{2,39}$'
       OR p_name IS NULL OR length(pg_catalog.btrim(p_name)) NOT BETWEEN 1 AND 120
       OR p_actor_admin_id IS NULL
       OR p_reason IS NULL OR length(pg_catalog.btrim(p_reason)) NOT BETWEEN 3 AND 1000
       OR (
            p_estimated_departure_date IS NOT NULL
            AND pg_catalog.date_trunc('month', p_estimated_departure_date)::date <> p_departure_month
       )
       OR (
            p_estimated_departure_date IS NOT NULL
            AND p_estimated_departure_date < (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date
       ) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_DEPARTURE_BATCH_PAYLOAD';
    END IF;

    SELECT * INTO v_admin
    FROM public.admins
    WHERE id = p_actor_admin_id
      AND is_active IS TRUE
      AND disabled_at IS NULL
      AND role = 'Super Admin'
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'DEPARTURE_BATCH_SUPER_ADMIN_REQUIRED';
    END IF;

    INSERT INTO public.kdj_departure_batches (
        batch_code, name, departure_month, estimated_departure_date,
        status, created_by_admin_id, updated_by_admin_id
    )
    VALUES (
        v_code, pg_catalog.btrim(p_name), p_departure_month, p_estimated_departure_date,
        'PLANNED', v_admin.id, v_admin.id
    )
    RETURNING * INTO v_batch;

    INSERT INTO public.kdj_departure_batch_events (
        batch_id, event_type, new_departure_month, new_estimated_departure_date,
        new_status, actor_admin_id, reason
    )
    VALUES (
        v_batch.id, 'BATCH_CREATED', v_batch.departure_month, v_batch.estimated_departure_date,
        v_batch.status, v_admin.id, pg_catalog.btrim(p_reason)
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'batch', pg_catalog.to_jsonb(v_batch),
        'h45_followup_available', false
    );
END;
$function$;

-- Update only the informational estimate; never change the confirmed financial date here.
CREATE OR REPLACE FUNCTION public.kdj_admin_update_departure_batch_estimate(
    p_batch_id uuid,
    p_estimated_departure_date date,
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
    v_batch public.kdj_departure_batches%ROWTYPE;
    v_previous_estimate date;
BEGIN
    IF p_batch_id IS NULL OR p_actor_admin_id IS NULL
       OR p_reason IS NULL OR length(pg_catalog.btrim(p_reason)) NOT BETWEEN 3 AND 1000 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_DEPARTURE_ESTIMATE_UPDATE';
    END IF;

    SELECT * INTO v_admin
    FROM public.admins
    WHERE id = p_actor_admin_id
      AND is_active IS TRUE
      AND disabled_at IS NULL
      AND role = 'Super Admin'
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'DEPARTURE_BATCH_SUPER_ADMIN_REQUIRED';
    END IF;

    SELECT * INTO v_batch
    FROM public.kdj_departure_batches
    WHERE id = p_batch_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'DEPARTURE_BATCH_NOT_FOUND';
    END IF;

    IF v_batch.status IN ('CLOSED', 'CANCELLED') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DEPARTURE_BATCH_NOT_ACTIVE';
    END IF;

    IF p_estimated_departure_date IS NOT NULL
       AND pg_catalog.date_trunc('month', p_estimated_departure_date)::date <> v_batch.departure_month THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ESTIMATE_OUTSIDE_DEPARTURE_MONTH';
    END IF;

    IF p_estimated_departure_date IS NOT NULL
       AND p_estimated_departure_date < (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ESTIMATED_DEPARTURE_DATE_IN_PAST';
    END IF;

    v_previous_estimate := v_batch.estimated_departure_date;

    IF v_previous_estimate IS NOT DISTINCT FROM p_estimated_departure_date THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', true, 'changed', false, 'batch', pg_catalog.to_jsonb(v_batch)
        );
    END IF;

    UPDATE public.kdj_departure_batches
    SET estimated_departure_date = p_estimated_departure_date,
        updated_by_admin_id = v_admin.id,
        updated_at = pg_catalog.now()
    WHERE id = p_batch_id
    RETURNING * INTO v_batch;

    INSERT INTO public.kdj_departure_batch_events (
        batch_id, event_type, previous_departure_month, new_departure_month,
        previous_estimated_departure_date, new_estimated_departure_date,
        previous_confirmed_departure_date, new_confirmed_departure_date,
        previous_status, new_status, actor_admin_id, reason
    )
    VALUES (
        v_batch.id, 'ESTIMATE_UPDATED', v_batch.departure_month, v_batch.departure_month,
        v_previous_estimate, v_batch.estimated_departure_date,
        v_batch.confirmed_departure_date, v_batch.confirmed_departure_date,
        v_batch.status, v_batch.status, v_admin.id, pg_catalog.btrim(p_reason)
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'changed', true,
        'batch', pg_catalog.to_jsonb(v_batch),
        'h45_followup_available', v_batch.confirmed_departure_date IS NOT NULL
    );
END;
$function$;

-- Confirm the operational date. Confirmation is a separate action from the estimate.
CREATE OR REPLACE FUNCTION public.kdj_admin_confirm_departure_batch(
    p_batch_id uuid,
    p_confirmed_departure_date date,
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
    v_batch public.kdj_departure_batches%ROWTYPE;
BEGIN
    IF p_batch_id IS NULL OR p_confirmed_departure_date IS NULL OR p_actor_admin_id IS NULL
       OR p_reason IS NULL OR length(pg_catalog.btrim(p_reason)) NOT BETWEEN 3 AND 1000 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_DEPARTURE_DATE_CONFIRMATION';
    END IF;

    SELECT * INTO v_admin
    FROM public.admins
    WHERE id = p_actor_admin_id
      AND is_active IS TRUE
      AND disabled_at IS NULL
      AND role = 'Super Admin'
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'DEPARTURE_BATCH_SUPER_ADMIN_REQUIRED';
    END IF;

    SELECT * INTO v_batch
    FROM public.kdj_departure_batches
    WHERE id = p_batch_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'DEPARTURE_BATCH_NOT_FOUND';
    END IF;

    IF v_batch.status IN ('CLOSED', 'CANCELLED') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DEPARTURE_BATCH_NOT_ACTIVE';
    END IF;

    IF v_batch.confirmed_departure_date IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DEPARTURE_DATE_ALREADY_CONFIRMED_USE_CHANGE_RPC';
    END IF;

    IF pg_catalog.date_trunc('month', p_confirmed_departure_date)::date <> v_batch.departure_month THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CONFIRMED_DATE_OUTSIDE_DEPARTURE_MONTH';
    END IF;

    IF p_confirmed_departure_date < (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CONFIRMED_DEPARTURE_DATE_IN_PAST';
    END IF;

    UPDATE public.kdj_departure_batches
    SET confirmed_departure_date = p_confirmed_departure_date,
        status = 'CONFIRMED',
        updated_by_admin_id = v_admin.id,
        updated_at = pg_catalog.now()
    WHERE id = p_batch_id
    RETURNING * INTO v_batch;

    INSERT INTO public.kdj_departure_batch_events (
        batch_id, event_type, previous_departure_month, new_departure_month,
        previous_estimated_departure_date, new_estimated_departure_date,
        previous_confirmed_departure_date, new_confirmed_departure_date,
        previous_status, new_status, actor_admin_id, reason
    )
    VALUES (
        v_batch.id, 'DATE_CONFIRMED', v_batch.departure_month, v_batch.departure_month,
        v_batch.estimated_departure_date, v_batch.estimated_departure_date,
        NULL, v_batch.confirmed_departure_date,
        'PLANNED', 'CONFIRMED', v_admin.id, pg_catalog.btrim(p_reason)
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'batch', pg_catalog.to_jsonb(v_batch),
        'h45_trigger_date', v_batch.confirmed_departure_date - 45
    );
END;
$function$;

-- Change a previously confirmed date; the old/new date and reason remain in the ledger.
CREATE OR REPLACE FUNCTION public.kdj_admin_change_departure_batch_date(
    p_batch_id uuid,
    p_new_confirmed_departure_date date,
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
    v_batch public.kdj_departure_batches%ROWTYPE;
    v_previous_date date;
BEGIN
    IF p_batch_id IS NULL OR p_new_confirmed_departure_date IS NULL OR p_actor_admin_id IS NULL
       OR p_reason IS NULL OR length(pg_catalog.btrim(p_reason)) NOT BETWEEN 3 AND 1000 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_DEPARTURE_DATE_CHANGE';
    END IF;

    SELECT * INTO v_admin
    FROM public.admins
    WHERE id = p_actor_admin_id
      AND is_active IS TRUE
      AND disabled_at IS NULL
      AND role = 'Super Admin'
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'DEPARTURE_BATCH_SUPER_ADMIN_REQUIRED';
    END IF;

    SELECT * INTO v_batch
    FROM public.kdj_departure_batches
    WHERE id = p_batch_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'DEPARTURE_BATCH_NOT_FOUND';
    END IF;

    IF v_batch.status <> 'CONFIRMED' OR v_batch.confirmed_departure_date IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DEPARTURE_DATE_NOT_CONFIRMED';
    END IF;

    IF pg_catalog.date_trunc('month', p_new_confirmed_departure_date)::date <> v_batch.departure_month THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CONFIRMED_DATE_OUTSIDE_DEPARTURE_MONTH';
    END IF;

    IF p_new_confirmed_departure_date < (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CONFIRMED_DEPARTURE_DATE_IN_PAST';
    END IF;

    v_previous_date := v_batch.confirmed_departure_date;
    IF v_previous_date = p_new_confirmed_departure_date THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', true, 'changed', false, 'batch', pg_catalog.to_jsonb(v_batch)
        );
    END IF;

    UPDATE public.kdj_departure_batches
    SET confirmed_departure_date = p_new_confirmed_departure_date,
        updated_by_admin_id = v_admin.id,
        updated_at = pg_catalog.now()
    WHERE id = p_batch_id
    RETURNING * INTO v_batch;

    INSERT INTO public.kdj_departure_batch_events (
        batch_id, event_type, previous_departure_month, new_departure_month,
        previous_estimated_departure_date, new_estimated_departure_date,
        previous_confirmed_departure_date, new_confirmed_departure_date,
        previous_status, new_status, actor_admin_id, reason
    )
    VALUES (
        v_batch.id, 'DATE_CHANGED', v_batch.departure_month, v_batch.departure_month,
        v_batch.estimated_departure_date, v_batch.estimated_departure_date,
        v_previous_date, v_batch.confirmed_departure_date,
        'CONFIRMED', 'CONFIRMED', v_admin.id, pg_catalog.btrim(p_reason)
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'changed', true,
        'batch', pg_catalog.to_jsonb(v_batch),
        'previous_h45_trigger_date', v_previous_date - 45,
        'new_h45_trigger_date', v_batch.confirmed_departure_date - 45
    );
END;
$function$;

-- Attach an existing approved package order to a monthly/yearly departure wave.
CREATE OR REPLACE FUNCTION public.kdj_admin_assign_departure_order_batch(
    p_order_id uuid,
    p_batch_id uuid,
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
    v_order public.kdj_departure_orders%ROWTYPE;
    v_batch public.kdj_departure_batches%ROWTYPE;
    v_previous_batch_id uuid;
    v_event_type text;
BEGIN
    IF p_order_id IS NULL OR p_batch_id IS NULL OR p_actor_admin_id IS NULL
       OR p_reason IS NULL OR length(pg_catalog.btrim(p_reason)) NOT BETWEEN 3 AND 1000 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_DEPARTURE_ORDER_BATCH_ASSIGNMENT';
    END IF;

    SELECT * INTO v_admin
    FROM public.admins
    WHERE id = p_actor_admin_id
      AND is_active IS TRUE
      AND disabled_at IS NULL
      AND role = 'Super Admin'
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'DEPARTURE_BATCH_SUPER_ADMIN_REQUIRED';
    END IF;

    SELECT * INTO v_order
    FROM public.kdj_departure_orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'DEPARTURE_ORDER_NOT_FOUND';
    END IF;

    SELECT * INTO v_batch
    FROM public.kdj_departure_batches
    WHERE id = p_batch_id
    FOR SHARE;

    IF NOT FOUND OR v_batch.status IN ('CANCELLED', 'CLOSED') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DEPARTURE_BATCH_NOT_ASSIGNABLE';
    END IF;

    v_previous_batch_id := v_order.departure_batch_id;
    IF v_previous_batch_id = p_batch_id THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', true, 'changed', false, 'order', pg_catalog.to_jsonb(v_order)
        );
    END IF;

    v_event_type := CASE
        WHEN v_previous_batch_id IS NULL THEN 'ORDER_ASSIGNED'
        ELSE 'ORDER_REASSIGNED'
    END;

    UPDATE public.kdj_departure_orders
    SET departure_batch_id = p_batch_id,
        updated_at = pg_catalog.now()
    WHERE id = p_order_id
    RETURNING * INTO v_order;

    INSERT INTO public.kdj_departure_batch_events (
        batch_id, order_id, previous_batch_id, new_batch_id,
        event_type, actor_admin_id, reason
    )
    VALUES (
        p_batch_id, p_order_id, v_previous_batch_id, p_batch_id,
        v_event_type, v_admin.id, pg_catalog.btrim(p_reason)
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'changed', true,
        'order', pg_catalog.to_jsonb(v_order),
        'previous_batch_id', v_previous_batch_id,
        'new_batch_id', p_batch_id
    );
END;
$function$;

-- H-45 follow-up read model. The confirmed date is used only to trigger monitoring/reminders.
-- This is not a payment deadline or installment eligibility gate.
CREATE OR REPLACE FUNCTION public.kdj_get_departure_h45_followup_status(
    p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_order public.kdj_departure_orders%ROWTYPE;
    v_batch public.kdj_departure_batches%ROWTYPE;
    v_today date := (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date;
    v_days_until_departure integer;
BEGIN
    IF p_order_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_DEPARTURE_ORDER_ID';
    END IF;

    SELECT * INTO v_order
    FROM public.kdj_departure_orders
    WHERE id = p_order_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'DEPARTURE_ORDER_NOT_FOUND';
    END IF;

    IF v_order.departure_batch_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', true,
            'h45_followup_determinable', false,
            'code', 'DEPARTURE_BATCH_NOT_ASSIGNED',
            'departure_month', NULL,
            'estimated_departure_date', NULL,
            'confirmed_departure_date', NULL,
            'h45_trigger_date', NULL,
            'days_until_departure', NULL,
            'h45_followup_triggered', NULL,
            'payment_restriction_applies', false
        );
    END IF;

    SELECT * INTO v_batch
    FROM public.kdj_departure_batches
    WHERE id = v_order.departure_batch_id;

    IF NOT FOUND OR v_batch.status IN ('CANCELLED', 'CLOSED') THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', true,
            'h45_followup_determinable', false,
            'code', 'DEPARTURE_BATCH_UNAVAILABLE',
            'departure_month', NULL,
            'estimated_departure_date', NULL,
            'confirmed_departure_date', NULL,
            'h45_trigger_date', NULL,
            'days_until_departure', NULL,
            'h45_followup_triggered', NULL,
            'payment_restriction_applies', false
        );
    END IF;

    IF v_batch.confirmed_departure_date IS NULL
       OR v_batch.status <> 'CONFIRMED' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', true,
            'h45_followup_determinable', false,
            'code', 'DEPARTURE_DATE_NOT_CONFIRMED',
            'departure_month', v_batch.departure_month,
            'estimated_departure_date', v_batch.estimated_departure_date,
            'confirmed_departure_date', NULL,
            'h45_trigger_date', NULL,
            'days_until_departure', NULL,
            'h45_followup_triggered', NULL,
            'payment_restriction_applies', false
        );
    END IF;

    v_days_until_departure := v_batch.confirmed_departure_date - v_today;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'h45_followup_determinable', true,
        'code', 'OK',
        'departure_month', v_batch.departure_month,
        'estimated_departure_date', v_batch.estimated_departure_date,
        'confirmed_departure_date', v_batch.confirmed_departure_date,
        'h45_trigger_date', v_batch.confirmed_departure_date - 45,
        'days_until_departure', v_days_until_departure,
        'h45_followup_triggered', v_days_until_departure <= 45,
        'payment_restriction_applies', false
    );
END;
$function$;

-- Admin read model for all package orders with an outstanding balance.
-- H-45 starts follow-up only; this function never changes payment eligibility.
CREATE OR REPLACE FUNCTION public.kdj_admin_list_departure_h45_followups()
RETURNS TABLE (
    order_id uuid,
    pendaftar_id uuid,
    student_name text,
    whatsapp text,
    package_name text,
    total_amount_idr integer,
    paid_amount_idr integer,
    remaining_amount_idr integer,
    payment_status text,
    departure_month date,
    estimated_departure_date date,
    confirmed_departure_date date,
    batch_code text,
    batch_name text,
    batch_status text,
    h45_followup_code text,
    h45_followup_determinable boolean,
    h45_trigger_date date,
    days_until_departure integer,
    h45_followup_triggered boolean,
    followup_stage text,
    pending_verification_count integer,
    pending_verification_amount_idr bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
    SELECT
        o.id AS order_id,
        o.pendaftar_id,
        COALESCE(
            NULLIF(pg_catalog.btrim(p.nama_lengkap), ''),
            NULLIF(pg_catalog.btrim(p.nama_leads), ''),
            'Nama belum tersedia'
        )::text AS student_name,
        NULLIF(pg_catalog.btrim(p.no_wa), '')::text AS whatsapp,
        o.package_name,
        o.total_amount_idr,
        o.paid_amount_idr,
        o.remaining_amount_idr,
        o.payment_status,
        b.departure_month,
        b.estimated_departure_date,
        b.confirmed_departure_date,
        b.batch_code,
        b.name AS batch_name,
        b.status AS batch_status,
        CASE
            WHEN o.departure_batch_id IS NULL THEN 'DEPARTURE_BATCH_NOT_ASSIGNED'
            WHEN b.id IS NULL OR b.status IN ('CLOSED', 'CANCELLED') THEN 'DEPARTURE_BATCH_UNAVAILABLE'
            WHEN b.confirmed_departure_date IS NULL OR b.status <> 'CONFIRMED' THEN 'DEPARTURE_DATE_NOT_CONFIRMED'
            ELSE 'OK'
        END::text AS h45_followup_code,
        (
            b.id IS NOT NULL
            AND b.status = 'CONFIRMED'
            AND b.confirmed_departure_date IS NOT NULL
        ) AS h45_followup_determinable,
        CASE
            WHEN b.status = 'CONFIRMED' AND b.confirmed_departure_date IS NOT NULL
                THEN b.confirmed_departure_date - 45
            ELSE NULL
        END AS h45_trigger_date,
        CASE
            WHEN b.status = 'CONFIRMED' AND b.confirmed_departure_date IS NOT NULL
                THEN b.confirmed_departure_date - (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date
            ELSE NULL
        END AS days_until_departure,
        CASE
            WHEN b.status = 'CONFIRMED' AND b.confirmed_departure_date IS NOT NULL
                THEN (
                    b.confirmed_departure_date - (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date
                ) <= 45
            ELSE NULL
        END AS h45_followup_triggered,
        CASE
            WHEN o.departure_batch_id IS NULL THEN 'BATCH_NOT_ASSIGNED'
            WHEN b.id IS NULL OR b.status IN ('CLOSED', 'CANCELLED') THEN 'BATCH_UNAVAILABLE'
            WHEN b.confirmed_departure_date IS NULL OR b.status <> 'CONFIRMED' THEN 'AWAITING_DATE_CONFIRMATION'
            WHEN b.confirmed_departure_date - (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date < 0 THEN 'AFTER_DEPARTURE_DATE'
            WHEN b.confirmed_departure_date - (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date <= 7 THEN 'H7_URGENT'
            WHEN b.confirmed_departure_date - (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date <= 30 THEN 'H30_TARGET'
            WHEN b.confirmed_departure_date - (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date <= 45 THEN 'H45_FOLLOW_UP'
            ELSE 'BEFORE_H45'
        END::text AS followup_stage,
        COALESCE(pending.pending_count, 0)::integer AS pending_verification_count,
        COALESCE(pending.pending_amount, 0)::bigint AS pending_verification_amount_idr
    FROM public.kdj_departure_orders AS o
    INNER JOIN public.pendaftar AS p
        ON p.id = o.pendaftar_id
    LEFT JOIN public.kdj_departure_batches AS b
        ON b.id = o.departure_batch_id
    LEFT JOIN LATERAL (
        SELECT
            pg_catalog.count(*) FILTER (WHERE i.status = 'PENDING_VERIFICATION') AS pending_count,
            COALESCE(
                pg_catalog.sum(i.amount_idr) FILTER (WHERE i.status = 'PENDING_VERIFICATION'),
                0
            ) AS pending_amount
        FROM public.kdj_departure_installments AS i
        WHERE i.order_id = o.id
    ) AS pending ON TRUE
    WHERE o.remaining_amount_idr > 0
      AND o.payment_status IS DISTINCT FROM 'PAID'
    ORDER BY
        CASE
            WHEN b.status = 'CONFIRMED' AND b.confirmed_departure_date IS NOT NULL THEN 0
            ELSE 1
        END,
        CASE
            WHEN b.status = 'CONFIRMED' AND b.confirmed_departure_date IS NOT NULL
                THEN b.confirmed_departure_date - (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date
            ELSE NULL
        END ASC NULLS LAST,
        o.created_at ASC;
$function$;

-- Read-only service-role RPC for Minje's customer-facing departure information.
-- Historical estimates are not copied into the confirmed date and are explicitly labeled by date_status.
CREATE OR REPLACE FUNCTION public.kdj_get_nearest_departure_wave()
RETURNS TABLE (
    batch_code text,
    batch_name text,
    departure_month date,
    estimated_departure_date date,
    confirmed_departure_date date,
    batch_status text,
    date_status text,
    updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
    SELECT
        b.batch_code,
        b.name AS batch_name,
        b.departure_month,
        b.estimated_departure_date,
        b.confirmed_departure_date,
        b.status AS batch_status,
        CASE
            WHEN b.confirmed_departure_date IS NOT NULL THEN 'CONFIRMED'
            WHEN b.estimated_departure_date IS NOT NULL THEN 'ESTIMATED'
            ELSE 'MONTH_ONLY'
        END::text AS date_status,
        b.updated_at
    FROM public.kdj_departure_batches AS b
    WHERE b.status IN ('PLANNED', 'CONFIRMED')
      AND b.departure_month >= pg_catalog.date_trunc(
          'month',
          pg_catalog.now() AT TIME ZONE 'Asia/Jakarta'
      )::date
      AND (
          (
              b.confirmed_departure_date IS NOT NULL
              AND b.confirmed_departure_date >= (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date
          )
          OR (
              b.confirmed_departure_date IS NULL
              AND (
                  b.estimated_departure_date IS NULL
                  OR b.estimated_departure_date >= (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date
              )
          )
      )
    ORDER BY
        b.departure_month ASC,
        COALESCE(b.confirmed_departure_date, b.estimated_departure_date) ASC NULLS LAST,
        b.batch_code ASC
    LIMIT 1;
$function$;

ALTER TABLE public.kdj_departure_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kdj_departure_batch_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.kdj_departure_batches FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.kdj_departure_batch_events FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.kdj_departure_batches TO service_role;
GRANT SELECT ON TABLE public.kdj_departure_batch_events TO service_role;

REVOKE ALL ON FUNCTION public.kdj_admin_create_departure_batch(text, text, date, date, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_admin_update_departure_batch_estimate(uuid, date, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_admin_confirm_departure_batch(uuid, date, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_admin_change_departure_batch_date(uuid, date, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_admin_assign_departure_order_batch(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_get_departure_h45_followup_status(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_admin_list_departure_h45_followups() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_get_nearest_departure_wave() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.kdj_admin_create_departure_batch(text, text, date, date, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.kdj_admin_update_departure_batch_estimate(uuid, date, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.kdj_admin_confirm_departure_batch(uuid, date, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.kdj_admin_change_departure_batch_date(uuid, date, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.kdj_admin_assign_departure_order_batch(uuid, uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.kdj_get_departure_h45_followup_status(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.kdj_admin_list_departure_h45_followups() TO service_role;
GRANT EXECUTE ON FUNCTION public.kdj_get_nearest_departure_wave() TO service_role;

COMMIT;
