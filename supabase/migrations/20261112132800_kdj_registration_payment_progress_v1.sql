-- KDJ Registration Payment Gate + Student Progress Lifecycle
-- Additive candidate migration. Local restore validation required before any Staging approval.
-- Does not alter historical migrations or enable a payment gateway.

BEGIN;

-- Capture the first inbound timestamp for profiles created after this reporting rollout.
-- Existing profiles keep NULL because their true first inbound cannot be reconstructed
-- from last_inbound_at; those rows are excluded from new-lead daily counts.
ALTER TABLE public.kdj_followup_profiles
    ADD COLUMN IF NOT EXISTS first_inbound_at timestamptz;

CREATE OR REPLACE FUNCTION public.kdj_capture_first_inbound_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.last_inbound_at IS NOT NULL AND NEW.first_inbound_at IS NULL THEN
            NEW.first_inbound_at := NEW.last_inbound_at;
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.last_inbound_at IS NULL AND NEW.last_inbound_at IS NOT NULL THEN
            NEW.first_inbound_at := COALESCE(OLD.first_inbound_at, NEW.last_inbound_at);
        ELSE
            NEW.first_inbound_at := OLD.first_inbound_at;
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_kdj_capture_first_inbound_at ON public.kdj_followup_profiles;
CREATE TRIGGER trg_kdj_capture_first_inbound_at
BEFORE INSERT OR UPDATE OF last_inbound_at
ON public.kdj_followup_profiles
FOR EACH ROW
EXECUTE FUNCTION public.kdj_capture_first_inbound_at();

CREATE INDEX IF NOT EXISTS idx_kdj_followup_profiles_first_inbound
    ON public.kdj_followup_profiles (first_inbound_at)
    WHERE first_inbound_at IS NOT NULL;

-- One-time registration fee record. Legacy pendaftar payment fields remain for compatibility.
CREATE TABLE IF NOT EXISTS public.kdj_registration_payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pendaftar_id uuid NOT NULL UNIQUE
        REFERENCES public.pendaftar(id) ON DELETE RESTRICT,
    invoice_ref text NOT NULL UNIQUE,
    amount_idr integer NOT NULL CHECK (amount_idr > 0),
    currency text NOT NULL DEFAULT 'IDR' CHECK (currency = 'IDR'),
    payment_method text NOT NULL DEFAULT 'MANUAL_TRANSFER'
        CHECK (payment_method IN ('MANUAL_TRANSFER')),
    status text NOT NULL DEFAULT 'PENDING_PAYMENT'
        CHECK (status IN (
            'PENDING_PAYMENT',
            'PROOF_SUBMITTED',
            'REVISION_REQUIRED',
            'PAID',
            'EXPIRED',
            'REOPENED'
        )),
    initial_submission_at timestamptz NOT NULL,
    deadline_at timestamptz NOT NULL,
    current_proof_id uuid,
    paid_at timestamptz,
    verified_by uuid REFERENCES public.admins(id) ON DELETE RESTRICT,
    verified_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT kdj_registration_payment_deadline_valid CHECK (deadline_at > initial_submission_at),
    CONSTRAINT kdj_registration_payment_paid_consistency CHECK (
        (status = 'PAID' AND paid_at IS NOT NULL AND verified_by IS NOT NULL AND verified_at IS NOT NULL)
        OR
        (status <> 'PAID' AND paid_at IS NULL AND verified_by IS NULL AND verified_at IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_kdj_registration_payments_status_deadline
    ON public.kdj_registration_payments (status, deadline_at);

CREATE TABLE IF NOT EXISTS public.kdj_registration_payment_proofs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id uuid NOT NULL
        REFERENCES public.kdj_registration_payments(id) ON DELETE RESTRICT,
    attempt_no integer NOT NULL CHECK (attempt_no > 0),
    object_path text NOT NULL UNIQUE,
    original_filename text NOT NULL CHECK (length(original_filename) BETWEEN 1 AND 255),
    mime_type text NOT NULL CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png')),
    size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
    sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
    status text NOT NULL DEFAULT 'SUBMITTED'
        CHECK (status IN ('SUBMITTED', 'APPROVED', 'REJECTED')),
    is_current boolean NOT NULL DEFAULT true,
    submitted_at timestamptz NOT NULL DEFAULT now(),
    reviewed_by uuid REFERENCES public.admins(id) ON DELETE RESTRICT,
    reviewed_at timestamptz,
    review_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT kdj_registration_payment_proof_review_consistency CHECK (
        (status = 'SUBMITTED' AND reviewed_by IS NULL AND reviewed_at IS NULL)
        OR
        (status IN ('APPROVED', 'REJECTED') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
    ),
    CONSTRAINT kdj_registration_payment_proof_version_unique UNIQUE(payment_id, attempt_no)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kdj_registration_payment_proofs_current
    ON public.kdj_registration_payment_proofs (payment_id)
    WHERE is_current IS TRUE;

CREATE INDEX IF NOT EXISTS idx_kdj_registration_payment_proofs_history
    ON public.kdj_registration_payment_proofs (payment_id, attempt_no DESC);

DO $block$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'kdj_registration_payments_current_proof_fk'
          AND conrelid = 'public.kdj_registration_payments'::regclass
    ) THEN
        ALTER TABLE public.kdj_registration_payments
            ADD CONSTRAINT kdj_registration_payments_current_proof_fk
            FOREIGN KEY (current_proof_id)
            REFERENCES public.kdj_registration_payment_proofs(id)
            ON DELETE RESTRICT;
    END IF;
END;
$block$;

CREATE TABLE IF NOT EXISTS public.kdj_registration_payment_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id uuid NOT NULL
        REFERENCES public.kdj_registration_payments(id) ON DELETE RESTRICT,
    pendaftar_id uuid NOT NULL
        REFERENCES public.pendaftar(id) ON DELETE RESTRICT,
    event_type text NOT NULL CHECK (event_type IN (
        'INITIAL_FORM_SUBMITTED',
        'PROOF_SUBMITTED',
        'PROOF_REJECTED',
        'PAYMENT_VERIFIED_PAID',
        'PAYMENT_EXPIRED',
        'PAYMENT_REOPENED'
    )),
    previous_status text,
    new_status text NOT NULL,
    proof_id uuid REFERENCES public.kdj_registration_payment_proofs(id) ON DELETE RESTRICT,
    actor_type text NOT NULL CHECK (actor_type IN ('CUSTOMER', 'ADMIN', 'SYSTEM')),
    actor_admin_id uuid REFERENCES public.admins(id) ON DELETE RESTRICT,
    reason text,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(evidence) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kdj_registration_payment_events_payment_time
    ON public.kdj_registration_payment_events (payment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_kdj_registration_payment_events_type_time
    ON public.kdj_registration_payment_events (event_type, created_at);

CREATE TABLE IF NOT EXISTS public.kdj_registration_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pendaftar_id uuid NOT NULL
        REFERENCES public.pendaftar(id) ON DELETE RESTRICT,
    event_type text NOT NULL CHECK (event_type IN (
        'INITIAL_FORM_SUBMITTED',
        'REGISTRATION_CLOSED',
        'APPLICATION_SUBMITTED',
        'APPLICATION_RESUBMITTED',
        'ACADEMIC_APPROVED',
        'APPLICATION_REJECTED',
        'REVISION_REQUESTED'
    )),
    previous_status text,
    new_status text,
    actor_type text NOT NULL CHECK (actor_type IN ('CUSTOMER', 'ADMIN', 'SYSTEM')),
    actor_admin_id uuid REFERENCES public.admins(id) ON DELETE RESTRICT,
    reason text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kdj_registration_events_pendaftar_time
    ON public.kdj_registration_events (pendaftar_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_kdj_registration_events_type_time
    ON public.kdj_registration_events (event_type, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kdj_registration_events_closing_once
    ON public.kdj_registration_events (pendaftar_id)
    WHERE event_type = 'REGISTRATION_CLOSED';

CREATE TABLE IF NOT EXISTS public.kdj_registration_reporting_config (
    id smallint PRIMARY KEY CHECK (id = 1),
    business_ledger_enabled_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.kdj_registration_reporting_config (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- Student progress primary state is separate from the four independent downstream documents.
CREATE TABLE IF NOT EXISTS public.kdj_student_progress (
    pendaftar_id uuid PRIMARY KEY
        REFERENCES public.pendaftar(id) ON DELETE RESTRICT,
    progress_status text NOT NULL
        CHECK (progress_status IN (
            'TRANSLATION_AND_CAMPUS_REGISTRATION',
            'WAITING_DEPARTURE',
            'DEPARTED'
        )),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.kdj_student_progress_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pendaftar_id uuid NOT NULL
        REFERENCES public.pendaftar(id) ON DELETE RESTRICT,
    previous_status text,
    new_status text NOT NULL
        CHECK (new_status IN (
            'TRANSLATION_AND_CAMPUS_REGISTRATION',
            'WAITING_DEPARTURE',
            'DEPARTED'
        )),
    actor_type text NOT NULL CHECK (actor_type IN ('SYSTEM', 'ADMIN')),
    actor_admin_id uuid REFERENCES public.admins(id) ON DELETE RESTRICT,
    reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 1000),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kdj_student_progress_events_pendaftar_time
    ON public.kdj_student_progress_events (pendaftar_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kdj_student_progress_initial_event_once
    ON public.kdj_student_progress_events (pendaftar_id)
    WHERE previous_status IS NULL
      AND new_status = 'TRANSLATION_AND_CAMPUS_REGISTRATION';

CREATE TABLE IF NOT EXISTS public.kdj_student_progress_documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pendaftar_id uuid NOT NULL
        REFERENCES public.pendaftar(id) ON DELETE RESTRICT,
    document_type text NOT NULL CHECK (document_type IN ('SUKETMAH', 'LOA', 'VISA', 'TICKET')),
    version_no integer NOT NULL CHECK (version_no > 0),
    object_path text NOT NULL UNIQUE,
    original_filename text NOT NULL CHECK (length(original_filename) BETWEEN 1 AND 255),
    mime_type text NOT NULL CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png')),
    size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
    sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
    uploaded_by_admin_id uuid NOT NULL
        REFERENCES public.admins(id) ON DELETE RESTRICT,
    uploaded_at timestamptz NOT NULL DEFAULT now(),
    is_current boolean NOT NULL DEFAULT true,
    supersedes_id uuid REFERENCES public.kdj_student_progress_documents(id) ON DELETE RESTRICT,
    note text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT kdj_student_progress_document_version_unique
        UNIQUE (pendaftar_id, document_type, version_no)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kdj_student_progress_documents_current
    ON public.kdj_student_progress_documents (pendaftar_id, document_type)
    WHERE is_current IS TRUE;

CREATE INDEX IF NOT EXISTS idx_kdj_student_progress_documents_history
    ON public.kdj_student_progress_documents (pendaftar_id, document_type, version_no DESC);

-- Status history is event-based; repeated status updates do not silently erase lifecycle evidence.
CREATE OR REPLACE FUNCTION public.kdj_record_registration_status_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_event_type text;
BEGIN
    IF NEW.status_pendaftaran IS NOT DISTINCT FROM OLD.status_pendaftaran THEN
        RETURN NEW;
    END IF;

    v_event_type := CASE
        WHEN NEW.status_pendaftaran = 'Revisi Diajukan'
            THEN 'APPLICATION_RESUBMITTED'
        WHEN NEW.status_pendaftaran = 'Submitted' AND OLD.status_pendaftaran IN ('Rejected', 'Revisi Diajukan')
            THEN 'APPLICATION_RESUBMITTED'
        WHEN NEW.status_pendaftaran = 'Submitted'
            THEN 'APPLICATION_SUBMITTED'
        WHEN NEW.status_pendaftaran = 'Approved'
            THEN 'ACADEMIC_APPROVED'
        WHEN NEW.status_pendaftaran = 'Rejected'
            THEN 'APPLICATION_REJECTED'
        ELSE NULL
    END;

    IF v_event_type IS NOT NULL THEN
        INSERT INTO public.kdj_registration_events (
            pendaftar_id, event_type, previous_status, new_status, actor_type, reason
        )
        VALUES (
            NEW.id, v_event_type, OLD.status_pendaftaran, NEW.status_pendaftaran,
            'SYSTEM', 'Captured from the authoritative pendaftar status transition.'
        );

        IF NEW.status_pendaftaran = 'Approved' THEN
            INSERT INTO public.kdj_student_progress (pendaftar_id, progress_status)
            VALUES (NEW.id, 'TRANSLATION_AND_CAMPUS_REGISTRATION')
            ON CONFLICT (pendaftar_id) DO NOTHING;

            INSERT INTO public.kdj_student_progress_events (
                pendaftar_id, previous_status, new_status, actor_type, reason
            )
            VALUES (
                NEW.id, NULL, 'TRANSLATION_AND_CAMPUS_REGISTRATION', 'SYSTEM',
                'Initial post-approval progress state.'
            )
            ON CONFLICT DO NOTHING;
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_kdj_record_registration_status_event ON public.pendaftar;
CREATE TRIGGER trg_kdj_record_registration_status_event
AFTER UPDATE OF status_pendaftaran
ON public.pendaftar
FOR EACH ROW
EXECUTE FUNCTION public.kdj_record_registration_status_event();

-- A future Admin upload operation can bootstrap a legacy Approved record without a blanket backfill.
CREATE OR REPLACE FUNCTION public.kdj_ensure_student_progress_for_approved(
    p_pendaftar_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.pendaftar
        WHERE id = p_pendaftar_id AND status_pendaftaran = 'Approved'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PENDAFTAR_NOT_APPROVED';
    END IF;

    INSERT INTO public.kdj_student_progress (pendaftar_id, progress_status)
    VALUES (p_pendaftar_id, 'TRANSLATION_AND_CAMPUS_REGISTRATION')
    ON CONFLICT (pendaftar_id) DO NOTHING;

    INSERT INTO public.kdj_student_progress_events (
        pendaftar_id, previous_status, new_status, actor_type, reason
    )
    SELECT p_pendaftar_id, NULL, 'TRANSLATION_AND_CAMPUS_REGISTRATION',
           'SYSTEM', 'Initial progress state created for an existing Approved applicant.'
    WHERE NOT EXISTS (
        SELECT 1 FROM public.kdj_student_progress_events
        WHERE pendaftar_id = p_pendaftar_id
          AND new_status = 'TRANSLATION_AND_CAMPUS_REGISTRATION'
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.kdj_start_registration_payment(
    p_pendaftar_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_pendaftar public.pendaftar%ROWTYPE;
    v_payment public.kdj_registration_payments%ROWTYPE;
    v_invoice_ref text;
    v_inserted boolean := false;
BEGIN
    IF p_pendaftar_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_PENDAFTAR_ID';
    END IF;

    SELECT * INTO v_pendaftar
    FROM public.pendaftar
    WHERE id = p_pendaftar_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'PENDAFTAR_NOT_FOUND';
    END IF;

    IF NULLIF(pg_catalog.btrim(v_pendaftar.nama_lengkap), '') IS NULL
       OR v_pendaftar.tanggal_lahir IS NULL
       OR NULLIF(pg_catalog.btrim(v_pendaftar.jenis_kelamin), '') IS NULL
       OR NULLIF(pg_catalog.btrim(v_pendaftar.alamat_lengkap), '') IS NULL
       OR NULLIF(pg_catalog.btrim(v_pendaftar.asal_sekolah), '') IS NULL
       OR v_pendaftar.tahun_lulus IS NULL
       OR NULLIF(pg_catalog.btrim(v_pendaftar.pilihan_kampus), '') IS NULL
       OR NULLIF(pg_catalog.btrim(v_pendaftar.pilihan_jurusan), '') IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INITIAL_REGISTRATION_DATA_INCOMPLETE';
    END IF;

    IF v_pendaftar.status_pendaftaran IS NULL
       OR v_pendaftar.status_pendaftaran NOT IN ('Draft', 'draft_berkas') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'REGISTRATION_STATE_NOT_ELIGIBLE_FOR_PAYMENT';
    END IF;

    SELECT * INTO v_payment
    FROM public.kdj_registration_payments
    WHERE pendaftar_id = p_pendaftar_id
    FOR UPDATE;

    IF FOUND THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', true, 'created', false, 'payment_id', v_payment.id,
            'invoice_ref', v_payment.invoice_ref, 'amount_idr', v_payment.amount_idr,
            'status', v_payment.status, 'initial_submission_at', v_payment.initial_submission_at,
            'deadline_at', v_payment.deadline_at
        );
    END IF;

    -- Preserve legacy payment records. They must be reconciled explicitly rather than overwritten.
    IF v_pendaftar.status_pembayaran IN ('Lunas', 'Menunggu Verifikasi', 'Ditolak')
       OR NULLIF(pg_catalog.btrim(v_pendaftar.bukti_bayar_url), '') IS NOT NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false, 'code', 'LEGACY_PAYMENT_REQUIRES_RECONCILIATION',
            'message', 'Existing legacy payment state is preserved; no new invoice was created.'
        );
    END IF;

    v_invoice_ref := 'KDJ-REG-' || pg_catalog.upper(
        pg_catalog.substr(pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 12)
    );

    INSERT INTO public.kdj_registration_payments (
        pendaftar_id, invoice_ref, amount_idr, payment_method, status,
        initial_submission_at, deadline_at
    )
    VALUES (
        p_pendaftar_id, v_invoice_ref, 1500000, 'MANUAL_TRANSFER', 'PENDING_PAYMENT',
        pg_catalog.now(), pg_catalog.now() + interval '24 hours'
    )
    ON CONFLICT (pendaftar_id) DO NOTHING
    RETURNING * INTO v_payment;

    IF v_payment.id IS NOT NULL THEN
        v_inserted := true;
        INSERT INTO public.kdj_registration_payment_events (
            payment_id, pendaftar_id, event_type, previous_status, new_status,
            actor_type, reason
        )
        VALUES (
            v_payment.id, p_pendaftar_id, 'INITIAL_FORM_SUBMITTED', NULL,
            'PENDING_PAYMENT', 'CUSTOMER',
            'Initial registration form accepted; 24-hour payment deadline created by server.'
        );

        INSERT INTO public.kdj_registration_events (
            pendaftar_id, event_type, previous_status, new_status, actor_type, reason
        )
        VALUES (
            p_pendaftar_id, 'INITIAL_FORM_SUBMITTED', NULL, 'PENDING_PAYMENT',
            'CUSTOMER', 'Initial registration data completed and submitted.'
        )
        ON CONFLICT DO NOTHING;
    ELSE
        SELECT * INTO v_payment
        FROM public.kdj_registration_payments
        WHERE pendaftar_id = p_pendaftar_id;
    END IF;

    UPDATE public.pendaftar
    SET nominal_tagihan = 1500000,
        status_pembayaran = CASE v_payment.status
            WHEN 'PAID' THEN 'Lunas'
            WHEN 'PROOF_SUBMITTED' THEN 'Menunggu Verifikasi'
            WHEN 'REVISION_REQUIRED' THEN 'Ditolak'
            ELSE 'Belum Bayar'
        END,
        updated_at = pg_catalog.now()
    WHERE id = p_pendaftar_id;

    RETURN pg_catalog.jsonb_build_object(
        'success', true, 'created', v_inserted, 'payment_id', v_payment.id,
        'invoice_ref', v_payment.invoice_ref, 'amount_idr', v_payment.amount_idr,
        'status', v_payment.status, 'initial_submission_at', v_payment.initial_submission_at,
        'deadline_at', v_payment.deadline_at
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.kdj_record_registration_payment_proof(
    p_pendaftar_id uuid,
    p_object_path text,
    p_original_filename text,
    p_mime_type text,
    p_size_bytes bigint,
    p_sha256 text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_pendaftar public.pendaftar%ROWTYPE;
    v_payment public.kdj_registration_payments%ROWTYPE;
    v_proof public.kdj_registration_payment_proofs%ROWTYPE;
    v_next_attempt integer;
BEGIN
    IF p_pendaftar_id IS NULL
       OR p_object_path IS NULL
       OR length(p_object_path) > 500
       OR p_original_filename IS NULL
       OR length(p_original_filename) NOT BETWEEN 1 AND 255
       OR p_mime_type IS NULL
       OR p_mime_type NOT IN ('application/pdf', 'image/jpeg', 'image/png')
       OR p_size_bytes IS NULL OR p_size_bytes NOT BETWEEN 1 AND 5242880
       OR (p_sha256 IS NOT NULL AND p_sha256 !~ '^[0-9a-f]{64}$')
       OR p_object_path ~ '(^/|(^|/)\.\.?(/|$)|\\|://|[[:cntrl:]])' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_PAYMENT_PROOF_PAYLOAD';
    END IF;

    SELECT * INTO v_pendaftar
    FROM public.pendaftar
    WHERE id = p_pendaftar_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'PENDAFTAR_NOT_FOUND';
    END IF;

    IF p_object_path NOT LIKE v_pendaftar.no_wa || '/bukti_bayar-%' THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PAYMENT_PROOF_OWNER_PATH_MISMATCH';
    END IF;

    SELECT * INTO v_payment
    FROM public.kdj_registration_payments
    WHERE pendaftar_id = p_pendaftar_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'REGISTRATION_PAYMENT_NOT_FOUND';
    END IF;

    IF v_payment.status NOT IN ('PENDING_PAYMENT', 'REVISION_REQUIRED', 'REOPENED') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PAYMENT_PROOF_STATE_NOT_ELIGIBLE';
    END IF;

    IF pg_catalog.now() > v_payment.deadline_at THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PAYMENT_DEADLINE_PASSED';
    END IF;

    SELECT COALESCE(MAX(attempt_no), 0) + 1 INTO v_next_attempt
    FROM public.kdj_registration_payment_proofs
    WHERE payment_id = v_payment.id;

    UPDATE public.kdj_registration_payment_proofs
    SET is_current = false
    WHERE payment_id = v_payment.id AND is_current IS TRUE;

    INSERT INTO public.kdj_registration_payment_proofs (
        payment_id, attempt_no, object_path, original_filename,
        mime_type, size_bytes, sha256, status, is_current
    )
    VALUES (
        v_payment.id, v_next_attempt, p_object_path, p_original_filename,
        p_mime_type, p_size_bytes, p_sha256, 'SUBMITTED', true
    )
    RETURNING * INTO v_proof;

    UPDATE public.kdj_registration_payments
    SET status = 'PROOF_SUBMITTED',
        current_proof_id = v_proof.id,
        updated_at = pg_catalog.now()
    WHERE id = v_payment.id
    RETURNING * INTO v_payment;

    UPDATE public.pendaftar
    SET bukti_bayar_url = p_object_path,
        status_pembayaran = 'Menunggu Verifikasi',
        catatan_pembayaran = NULL,
        updated_at = pg_catalog.now()
    WHERE id = p_pendaftar_id;

    INSERT INTO public.kdj_registration_payment_events (
        payment_id, pendaftar_id, event_type, previous_status, new_status,
        proof_id, actor_type, reason, evidence
    )
    VALUES (
        v_payment.id, p_pendaftar_id, 'PROOF_SUBMITTED',
        CASE WHEN v_next_attempt = 1 THEN 'PENDING_PAYMENT' ELSE 'REVISION_REQUIRED' END,
        'PROOF_SUBMITTED', v_proof.id, 'CUSTOMER',
        'Payment proof uploaded by the authenticated applicant.',
        pg_catalog.jsonb_build_object('attempt_no', v_next_attempt, 'mime_type', p_mime_type, 'size_bytes', p_size_bytes)
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', true, 'payment_id', v_payment.id, 'proof_id', v_proof.id,
        'attempt_no', v_next_attempt, 'status', v_payment.status
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.kdj_admin_review_registration_payment(
    p_payment_id uuid,
    p_proof_id uuid,
    p_decision text,
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
    v_payment public.kdj_registration_payments%ROWTYPE;
    v_proof public.kdj_registration_payment_proofs%ROWTYPE;
    v_pendaftar public.pendaftar%ROWTYPE;
    v_new_status text;
BEGIN
    IF p_payment_id IS NULL OR p_proof_id IS NULL
       OR p_decision IS NULL OR p_decision NOT IN ('APPROVE', 'REJECT')
       OR p_reason IS NULL OR length(pg_catalog.btrim(p_reason)) NOT BETWEEN 3 AND 1000
       OR p_actor_admin_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_PAYMENT_REVIEW_PAYLOAD';
    END IF;

    SELECT * INTO v_admin
    FROM public.admins
    WHERE id = p_actor_admin_id
      AND is_active IS TRUE
      AND disabled_at IS NULL
      AND role = 'Super Admin'
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PAYMENT_REVIEW_SUPER_ADMIN_REQUIRED';
    END IF;

    SELECT * INTO v_payment
    FROM public.kdj_registration_payments
    WHERE id = p_payment_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'REGISTRATION_PAYMENT_NOT_FOUND';
    END IF;

    IF v_payment.status <> 'PROOF_SUBMITTED'
       OR v_payment.current_proof_id IS DISTINCT FROM p_proof_id THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'PAYMENT_PROOF_REVIEW_STALE';
    END IF;

    SELECT * INTO v_proof
    FROM public.kdj_registration_payment_proofs
    WHERE id = p_proof_id
      AND payment_id = p_payment_id
      AND is_current IS TRUE
      AND status = 'SUBMITTED'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'CURRENT_PAYMENT_PROOF_NOT_FOUND';
    END IF;

    SELECT * INTO v_pendaftar
    FROM public.pendaftar
    WHERE id = v_payment.pendaftar_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'PENDAFTAR_NOT_FOUND';
    END IF;

    IF p_decision = 'APPROVE' THEN
        v_new_status := 'PAID';

        UPDATE public.kdj_registration_payment_proofs
        SET status = 'APPROVED',
            reviewed_by = p_actor_admin_id,
            reviewed_at = pg_catalog.now(),
            review_reason = pg_catalog.btrim(p_reason)
        WHERE id = p_proof_id;

        UPDATE public.kdj_registration_payments
        SET status = 'PAID',
            paid_at = pg_catalog.now(),
            verified_by = p_actor_admin_id,
            verified_at = pg_catalog.now(),
            updated_at = pg_catalog.now()
        WHERE id = p_payment_id;

        UPDATE public.pendaftar
        SET status_pembayaran = 'Lunas',
            bukti_bayar_url = v_proof.object_path,
            catatan_pembayaran = NULL,
            updated_at = pg_catalog.now()
        WHERE id = v_payment.pendaftar_id;

        INSERT INTO public.kdj_registration_events (
            pendaftar_id, event_type, previous_status, new_status,
            actor_type, actor_admin_id, reason
        )
        SELECT v_payment.pendaftar_id, 'REGISTRATION_CLOSED',
               v_pendaftar.status_pembayaran, 'PAID',
               'ADMIN', p_actor_admin_id, pg_catalog.btrim(p_reason)
        WHERE NOT EXISTS (
            SELECT 1 FROM public.kdj_registration_events
            WHERE pendaftar_id = v_payment.pendaftar_id
              AND event_type = 'REGISTRATION_CLOSED'
        );

        INSERT INTO public.kdj_registration_payment_events (
            payment_id, pendaftar_id, event_type, previous_status, new_status,
            proof_id, actor_type, actor_admin_id, reason
        )
        VALUES (
            p_payment_id, v_payment.pendaftar_id, 'PAYMENT_VERIFIED_PAID',
            'PROOF_SUBMITTED', v_new_status, p_proof_id,
            'ADMIN', p_actor_admin_id, pg_catalog.btrim(p_reason)
        );
    ELSE
        v_new_status := 'REVISION_REQUIRED';

        UPDATE public.kdj_registration_payment_proofs
        SET status = 'REJECTED',
            reviewed_by = p_actor_admin_id,
            reviewed_at = pg_catalog.now(),
            review_reason = pg_catalog.btrim(p_reason)
        WHERE id = p_proof_id;

        UPDATE public.kdj_registration_payments
        SET status = 'REVISION_REQUIRED',
            updated_at = pg_catalog.now()
        WHERE id = p_payment_id;

        UPDATE public.pendaftar
        SET status_pembayaran = 'Ditolak',
            catatan_pembayaran = pg_catalog.btrim(p_reason),
            updated_at = pg_catalog.now()
        WHERE id = v_payment.pendaftar_id;

        INSERT INTO public.kdj_registration_payment_events (
            payment_id, pendaftar_id, event_type, previous_status, new_status,
            proof_id, actor_type, actor_admin_id, reason
        )
        VALUES (
            p_payment_id, v_payment.pendaftar_id, 'PROOF_REJECTED',
            'PROOF_SUBMITTED', v_new_status, p_proof_id,
            'ADMIN', p_actor_admin_id, pg_catalog.btrim(p_reason)
        );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true, 'payment_id', p_payment_id, 'pendaftar_id', v_payment.pendaftar_id,
        'status', v_new_status, 'proof_id', p_proof_id
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.kdj_admin_reopen_registration_payment(
    p_payment_id uuid,
    p_new_deadline timestamptz,
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
    v_payment public.kdj_registration_payments%ROWTYPE;
    v_previous_status text;
BEGIN
    IF p_payment_id IS NULL OR p_new_deadline IS NULL
       OR p_new_deadline <= pg_catalog.now()
       OR p_reason IS NULL OR length(pg_catalog.btrim(p_reason)) NOT BETWEEN 3 AND 1000
       OR p_actor_admin_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_PAYMENT_REOPEN_PAYLOAD';
    END IF;

    SELECT * INTO v_admin
    FROM public.admins
    WHERE id = p_actor_admin_id
      AND is_active IS TRUE
      AND disabled_at IS NULL
      AND role = 'Super Admin'
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PAYMENT_REOPEN_SUPER_ADMIN_REQUIRED';
    END IF;

    SELECT * INTO v_payment
    FROM public.kdj_registration_payments
    WHERE id = p_payment_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'REGISTRATION_PAYMENT_NOT_FOUND';
    END IF;

    IF v_payment.status NOT IN ('PENDING_PAYMENT', 'REOPENED', 'EXPIRED', 'REVISION_REQUIRED') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PAYMENT_STATE_NOT_REOPENABLE';
    END IF;

    IF v_payment.status IN ('PENDING_PAYMENT', 'REOPENED')
       AND v_payment.deadline_at > pg_catalog.now() THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PAYMENT_DEADLINE_NOT_EXPIRED';
    END IF;

    IF v_payment.status IN ('PENDING_PAYMENT', 'REOPENED', 'REVISION_REQUIRED')
       AND v_payment.deadline_at <= pg_catalog.now() THEN
        v_previous_status := 'EXPIRED';
        INSERT INTO public.kdj_registration_payment_events (
            payment_id, pendaftar_id, event_type, previous_status, new_status,
            actor_type, reason
        )
        VALUES (
            v_payment.id, v_payment.pendaftar_id, 'PAYMENT_EXPIRED',
            v_payment.status, 'EXPIRED', 'SYSTEM',
            'Current payment deadline passed without an eligible proof submission.'
        );
    ELSE
        v_previous_status := v_payment.status;
    END IF;

    UPDATE public.kdj_registration_payments
    SET status = 'REOPENED',
        deadline_at = p_new_deadline,
        updated_at = pg_catalog.now()
    WHERE id = p_payment_id;

    UPDATE public.pendaftar
    SET status_pembayaran = 'Belum Bayar',
        catatan_pembayaran = pg_catalog.btrim(p_reason),
        updated_at = pg_catalog.now()
    WHERE id = v_payment.pendaftar_id;

    INSERT INTO public.kdj_registration_payment_events (
        payment_id, pendaftar_id, event_type, previous_status, new_status,
        actor_type, actor_admin_id, reason, evidence
    )
    VALUES (
        p_payment_id, v_payment.pendaftar_id, 'PAYMENT_REOPENED',
        v_previous_status, 'REOPENED', 'ADMIN', p_actor_admin_id,
        pg_catalog.btrim(p_reason),
        pg_catalog.jsonb_build_object('new_deadline_at', p_new_deadline)
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', true, 'payment_id', p_payment_id,
        'status', 'REOPENED', 'deadline_at', p_new_deadline
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.kdj_admin_record_student_progress_document(
    p_pendaftar_id uuid,
    p_document_type text,
    p_object_path text,
    p_original_filename text,
    p_mime_type text,
    p_size_bytes bigint,
    p_sha256 text,
    p_actor_admin_id uuid,
    p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_admin public.admins%ROWTYPE;
    v_pendaftar public.pendaftar%ROWTYPE;
    v_existing public.kdj_student_progress_documents%ROWTYPE;
    v_version integer;
    v_new public.kdj_student_progress_documents%ROWTYPE;
BEGIN
    IF p_pendaftar_id IS NULL
       OR p_document_type IS NULL OR p_document_type NOT IN ('SUKETMAH', 'LOA', 'VISA', 'TICKET')
       OR p_object_path IS NULL OR length(p_object_path) > 500
       OR p_original_filename IS NULL OR length(p_original_filename) NOT BETWEEN 1 AND 255
       OR p_mime_type IS NULL OR p_mime_type NOT IN ('application/pdf', 'image/jpeg', 'image/png')
       OR p_size_bytes IS NULL OR p_size_bytes NOT BETWEEN 1 AND 5242880
       OR (p_sha256 IS NOT NULL AND p_sha256 !~ '^[0-9a-f]{64}$')
       OR p_actor_admin_id IS NULL
       OR (p_note IS NOT NULL AND length(p_note) > 1000) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_STUDENT_PROGRESS_DOCUMENT_PAYLOAD';
    END IF;

    IF p_object_path NOT LIKE 'progress/' || p_pendaftar_id::text || '/' || pg_catalog.lower(p_document_type) || '/%'
       OR p_object_path ~ '(^/|(^|/)\.\.?(/|$)|\\|://|[[:cntrl:]])' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_STUDENT_PROGRESS_STORAGE_PATH';
    END IF;

    SELECT * INTO v_admin
    FROM public.admins
    WHERE id = p_actor_admin_id
      AND is_active IS TRUE
      AND disabled_at IS NULL
      AND role = 'Super Admin'
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'STUDENT_PROGRESS_SUPER_ADMIN_REQUIRED';
    END IF;

    SELECT * INTO v_pendaftar
    FROM public.pendaftar
    WHERE id = p_pendaftar_id
    FOR SHARE;

    IF NOT FOUND OR v_pendaftar.status_pendaftaran <> 'Approved' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PENDAFTAR_NOT_APPROVED';
    END IF;

    PERFORM public.kdj_ensure_student_progress_for_approved(p_pendaftar_id);

    SELECT * INTO v_existing
    FROM public.kdj_student_progress_documents
    WHERE pendaftar_id = p_pendaftar_id
      AND document_type = p_document_type
      AND is_current IS TRUE
    FOR UPDATE;

    SELECT COALESCE(MAX(version_no), 0) + 1 INTO v_version
    FROM public.kdj_student_progress_documents
    WHERE pendaftar_id = p_pendaftar_id
      AND document_type = p_document_type;

    UPDATE public.kdj_student_progress_documents
    SET is_current = false
    WHERE pendaftar_id = p_pendaftar_id
      AND document_type = p_document_type
      AND is_current IS TRUE;

    INSERT INTO public.kdj_student_progress_documents (
        pendaftar_id, document_type, version_no, object_path,
        original_filename, mime_type, size_bytes, sha256,
        uploaded_by_admin_id, is_current, supersedes_id, note
    )
    VALUES (
        p_pendaftar_id, p_document_type, v_version, p_object_path,
        p_original_filename, p_mime_type, p_size_bytes, p_sha256,
        p_actor_admin_id, true, v_existing.id, NULLIF(pg_catalog.btrim(p_note), '')
    )
    RETURNING * INTO v_new;

    RETURN pg_catalog.jsonb_build_object(
        'success', true, 'document_id', v_new.id, 'pendaftar_id', p_pendaftar_id,
        'document_type', p_document_type, 'version_no', v_version,
        'uploaded_at', v_new.uploaded_at
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.kdj_admin_transition_student_progress(
    p_pendaftar_id uuid,
    p_new_status text,
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
    v_pendaftar public.pendaftar%ROWTYPE;
    v_progress public.kdj_student_progress%ROWTYPE;
BEGIN
    IF p_pendaftar_id IS NULL
       OR p_new_status IS NULL OR p_new_status NOT IN ('TRANSLATION_AND_CAMPUS_REGISTRATION', 'WAITING_DEPARTURE', 'DEPARTED')
       OR p_reason IS NULL OR length(pg_catalog.btrim(p_reason)) NOT BETWEEN 3 AND 1000
       OR p_actor_admin_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_STUDENT_PROGRESS_TRANSITION';
    END IF;

    SELECT * INTO v_admin
    FROM public.admins
    WHERE id = p_actor_admin_id
      AND is_active IS TRUE
      AND disabled_at IS NULL
      AND role = 'Super Admin'
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'STUDENT_PROGRESS_SUPER_ADMIN_REQUIRED';
    END IF;

    SELECT * INTO v_pendaftar
    FROM public.pendaftar
    WHERE id = p_pendaftar_id
    FOR SHARE;

    IF NOT FOUND OR v_pendaftar.status_pendaftaran <> 'Approved' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PENDAFTAR_NOT_APPROVED';
    END IF;

    PERFORM public.kdj_ensure_student_progress_for_approved(p_pendaftar_id);

    SELECT * INTO v_progress
    FROM public.kdj_student_progress
    WHERE pendaftar_id = p_pendaftar_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'STUDENT_PROGRESS_NOT_FOUND';
    END IF;

    IF p_new_status = v_progress.progress_status THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'STUDENT_PROGRESS_NO_CHANGE';
    END IF;

    IF NOT (
        (v_progress.progress_status = 'TRANSLATION_AND_CAMPUS_REGISTRATION'
            AND p_new_status = 'WAITING_DEPARTURE')
        OR
        (v_progress.progress_status = 'WAITING_DEPARTURE'
            AND p_new_status = 'DEPARTED')
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'STUDENT_PROGRESS_TRANSITION_NOT_ALLOWED';
    END IF;

    UPDATE public.kdj_student_progress
    SET progress_status = p_new_status,
        updated_at = pg_catalog.now()
    WHERE pendaftar_id = p_pendaftar_id;

    INSERT INTO public.kdj_student_progress_events (
        pendaftar_id, previous_status, new_status,
        actor_type, actor_admin_id, reason
    )
    VALUES (
        p_pendaftar_id, v_progress.progress_status, p_new_status,
        'ADMIN', p_actor_admin_id, pg_catalog.btrim(p_reason)
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', true, 'pendaftar_id', p_pendaftar_id,
        'previous_status', v_progress.progress_status, 'status', p_new_status
    );
END;
$function$;

-- Expire overdue invoices durably. Timely PROOF_SUBMITTED records are deliberately excluded:
-- an Admin may review evidence after the original 24-hour deadline.
CREATE OR REPLACE FUNCTION public.kdj_expire_registration_payments(
    p_limit integer DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_expired_count integer := 0;
BEGIN
    IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_PAYMENT_EXPIRY_BATCH_SIZE';
    END IF;

    WITH due AS (
        SELECT
            payment.id,
            payment.pendaftar_id,
            payment.status AS previous_status
        FROM public.kdj_registration_payments AS payment
        WHERE payment.status IN ('PENDING_PAYMENT', 'REOPENED', 'REVISION_REQUIRED')
          AND payment.deadline_at <= pg_catalog.now()
        ORDER BY payment.deadline_at ASC, payment.id ASC
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    ),
    expired AS (
        UPDATE public.kdj_registration_payments AS payment
        SET status = 'EXPIRED',
            updated_at = pg_catalog.now()
        FROM due
        WHERE payment.id = due.id
        RETURNING payment.id, payment.pendaftar_id
    ),
    event_rows AS (
        INSERT INTO public.kdj_registration_payment_events (
            payment_id, pendaftar_id, event_type, previous_status, new_status,
            actor_type, reason, evidence
        )
        SELECT
            expired.id,
            expired.pendaftar_id,
            'PAYMENT_EXPIRED',
            due.previous_status,
            'EXPIRED',
            'SYSTEM',
            'Payment deadline passed without a currently eligible proof awaiting verification.',
            pg_catalog.jsonb_build_object('expired_by', 'kdj_expire_registration_payments')
        FROM expired
        JOIN due ON due.id = expired.id
        RETURNING id
    )
    SELECT count(*)::integer
    INTO v_expired_count
    FROM event_rows;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'expired_count', v_expired_count
    );
END;
$function$;

-- Expiry is a database-owned scheduled operation, separate from the applicant's clock.
DO $payment_expiry_cron$
DECLARE
    v_existing record;
BEGIN
    IF pg_catalog.to_regclass('cron.job') IS NOT NULL THEN
        SELECT schedule, command
        INTO v_existing
        FROM cron.job
        WHERE jobname = 'kdj-registration-payment-expiry'
        LIMIT 1;

        IF FOUND THEN
            IF v_existing.schedule <> '*/5 * * * *'
               OR v_existing.command NOT LIKE '%kdj_expire_registration_payments%' THEN
                RAISE EXCEPTION 'Existing kdj-registration-payment-expiry Cron job differs from the approved five-minute expiry worker.';
            END IF;
        ELSIF pg_catalog.to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL THEN
            PERFORM cron.schedule(
                'kdj-registration-payment-expiry',
                '*/5 * * * *',
                'SELECT public.kdj_expire_registration_payments(200);'
            );
        END IF;
    END IF;
END;
$payment_expiry_cron$;

REVOKE ALL ON FUNCTION public.kdj_expire_registration_payments(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kdj_expire_registration_payments(integer) TO service_role;

-- Every new table is private by default; service_role accesses are through server-side APIs/RPCs only.
ALTER TABLE public.kdj_registration_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kdj_registration_payment_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kdj_registration_payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kdj_registration_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kdj_registration_reporting_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kdj_student_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kdj_student_progress_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kdj_student_progress_documents ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
    public.kdj_registration_payments,
    public.kdj_registration_payment_proofs,
    public.kdj_registration_payment_events,
    public.kdj_registration_events,
    public.kdj_registration_reporting_config,
    public.kdj_student_progress,
    public.kdj_student_progress_events,
    public.kdj_student_progress_documents
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE
    public.kdj_registration_payments,
    public.kdj_registration_payment_proofs,
    public.kdj_student_progress,
    public.kdj_student_progress_documents
TO service_role;

GRANT SELECT ON TABLE public.kdj_registration_reporting_config TO service_role;
GRANT SELECT, INSERT ON TABLE
    public.kdj_registration_payment_events,
    public.kdj_registration_events,
    public.kdj_student_progress_events
TO service_role;

REVOKE ALL ON FUNCTION public.kdj_capture_first_inbound_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_record_registration_status_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_ensure_student_progress_for_approved(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_start_registration_payment(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_record_registration_payment_proof(uuid, text, text, text, bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_admin_review_registration_payment(uuid, uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_admin_reopen_registration_payment(uuid, timestamptz, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_admin_record_student_progress_document(uuid, text, text, text, text, bigint, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_admin_transition_student_progress(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.kdj_start_registration_payment(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.kdj_record_registration_payment_proof(uuid, text, text, text, bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.kdj_admin_review_registration_payment(uuid, uuid, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.kdj_admin_reopen_registration_payment(uuid, timestamptz, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.kdj_admin_record_student_progress_document(uuid, text, text, text, text, bigint, text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.kdj_admin_transition_student_progress(uuid, text, text, uuid) TO service_role;

COMMIT;
