-- =============================================================================
-- KDJ FINANCIAL DOCUMENTS - IMMUTABLE INVOICES / RECEIPTS + PRIVATE PDF DELIVERY
-- Draft migration candidate. Verify against isolated PostgreSQL contract before any hosted apply.
-- H-45 is a follow-up trigger only. It never limits or blocks partial payments.
-- =============================================================================

BEGIN;

-- Private PDF bucket. No anon/authenticated object policies are created.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'kdj-financial-documents',
    'kdj-financial-documents',
    false,
    10485760,
    ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE TABLE IF NOT EXISTS public.kdj_financial_document_counters (
    document_year integer NOT NULL CHECK (document_year BETWEEN 2020 AND 2200),
    document_type text NOT NULL CHECK (document_type IN ('INVOICE', 'RECEIPT')),
    last_number bigint NOT NULL DEFAULT 0 CHECK (last_number >= 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (document_year, document_type)
);

CREATE TABLE IF NOT EXISTS public.kdj_financial_documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_type text NOT NULL CHECK (document_type IN ('INVOICE', 'RECEIPT')),
    document_number text NOT NULL UNIQUE,
    source_type text NOT NULL CHECK (source_type IN (
        'REGISTRATION_PAYMENT_EVENT',
        'DEPARTURE_PAYMENT_EVENT'
    )),
    source_event_id uuid NOT NULL,
    source_key text NOT NULL UNIQUE,
    pendaftar_id uuid NOT NULL REFERENCES public.pendaftar(id) ON DELETE RESTRICT,
    registration_payment_id uuid REFERENCES public.kdj_registration_payments(id) ON DELETE RESTRICT,
    departure_order_id uuid REFERENCES public.kdj_departure_orders(id) ON DELETE RESTRICT,
    amount_idr integer NOT NULL CHECK (amount_idr > 0),
    currency text NOT NULL DEFAULT 'IDR' CHECK (currency = 'IDR'),
    status text NOT NULL DEFAULT 'ISSUED'
        CHECK (status IN ('ISSUED', 'PAID', 'SUPERSEDED', 'VOID')),
    issued_at timestamptz NOT NULL DEFAULT now(),
    due_at timestamptz,
    paid_at timestamptz,
    supersedes_document_id uuid REFERENCES public.kdj_financial_documents(id) ON DELETE RESTRICT,
    document_snapshot jsonb NOT NULL CHECK (jsonb_typeof(document_snapshot) = 'object'),
    storage_bucket text NOT NULL DEFAULT 'kdj-financial-documents'
        CHECK (storage_bucket = 'kdj-financial-documents'),
    storage_path text UNIQUE,
    sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
    rendered_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT kdj_financial_document_source_relation_check CHECK (
        (source_type = 'REGISTRATION_PAYMENT_EVENT'
            AND registration_payment_id IS NOT NULL
            AND departure_order_id IS NULL)
        OR
        (source_type = 'DEPARTURE_PAYMENT_EVENT'
            AND departure_order_id IS NOT NULL
            AND registration_payment_id IS NULL)
    ),
    CONSTRAINT kdj_financial_document_due_date_check CHECK (
        document_type = 'INVOICE' OR due_at IS NULL
    ),
    CONSTRAINT kdj_financial_document_paid_check CHECK (
        status <> 'PAID' OR paid_at IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS idx_kdj_financial_documents_owner_time
    ON public.kdj_financial_documents (pendaftar_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_kdj_financial_documents_order_time
    ON public.kdj_financial_documents (departure_order_id, issued_at DESC)
    WHERE departure_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kdj_financial_documents_status_time
    ON public.kdj_financial_documents (status, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_kdj_financial_documents_source_event
    ON public.kdj_financial_documents (source_type, source_event_id);
CREATE INDEX IF NOT EXISTS idx_kdj_financial_documents_registration_payment
    ON public.kdj_financial_documents (registration_payment_id) WHERE registration_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kdj_financial_documents_supersedes
    ON public.kdj_financial_documents (supersedes_document_id) WHERE supersedes_document_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.kdj_financial_document_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id uuid NOT NULL REFERENCES public.kdj_financial_documents(id) ON DELETE RESTRICT,
    event_type text NOT NULL CHECK (event_type IN (
        'ISSUED',
        'RENDERED',
        'PAID',
        'SUPERSEDED',
        'VOIDED',
        'DELIVERY_QUEUED',
        'DELIVERY_SENT',
        'DELIVERY_FAILED',
        'DELIVERY_UNKNOWN',
        'RESEND_REQUESTED',
        'UNKNOWN_RECONCILED'
    )),
    previous_status text,
    new_status text,
    actor_type text NOT NULL DEFAULT 'SYSTEM'
        CHECK (actor_type IN ('SYSTEM', 'CUSTOMER', 'ADMIN', 'BOT')),
    actor_admin_id uuid REFERENCES public.admins(id) ON DELETE RESTRICT,
    reason text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(metadata) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kdj_financial_document_events_document_time
    ON public.kdj_financial_document_events (document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kdj_financial_document_events_actor_admin
    ON public.kdj_financial_document_events (actor_admin_id) WHERE actor_admin_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.kdj_financial_document_outbox (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id uuid NOT NULL REFERENCES public.kdj_financial_documents(id) ON DELETE RESTRICT,
    recipient_phone text NOT NULL CHECK (recipient_phone ~ '^(\+62[8][0-9]{8,13}|\+962[1-9][0-9]{6,11}|\+967[1-9][0-9]{6,11})$'),
    status text NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'UNKNOWN')),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    claim_token uuid,
    lease_until timestamptz,
    provider_message_id text,
    last_error_code text,
    last_error_message text,
    queued_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT kdj_financial_document_outbox_lease_check CHECK (
        (status = 'PROCESSING' AND claim_token IS NOT NULL AND lease_until IS NOT NULL)
        OR
        (status <> 'PROCESSING' AND claim_token IS NULL AND lease_until IS NULL)
    ),
    CONSTRAINT kdj_financial_document_outbox_sent_check CHECK (
        status <> 'SENT' OR sent_at IS NOT NULL
    ),
    CONSTRAINT kdj_financial_document_outbox_unique_recipient
        UNIQUE (document_id, recipient_phone)
);

CREATE INDEX IF NOT EXISTS idx_kdj_financial_document_outbox_pending
    ON public.kdj_financial_document_outbox (queued_at)
    WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_kdj_financial_document_outbox_document
    ON public.kdj_financial_document_outbox (document_id, queued_at DESC);

ALTER TABLE public.kdj_financial_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kdj_financial_document_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kdj_financial_document_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kdj_financial_document_counters ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.kdj_financial_document_counters FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.kdj_financial_documents FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.kdj_financial_document_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.kdj_financial_document_outbox FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.kdj_financial_document_counters TO service_role;
GRANT ALL ON TABLE public.kdj_financial_documents TO service_role;
GRANT ALL ON TABLE public.kdj_financial_document_events TO service_role;
GRANT ALL ON TABLE public.kdj_financial_document_outbox TO service_role;

-- Canonical E.164 recipients. KDJ currently accepts Indonesia, Jordan and Yemen only.
CREATE OR REPLACE FUNCTION public.kdj_normalize_financial_document_phone(p_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
DECLARE
    v_digits text := pg_catalog.regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
    v_e164 text;
BEGIN
    IF v_digits ~ '^08[0-9]{8,13}$' THEN
        v_e164 := '+62' || pg_catalog.substr(v_digits, 2);
    ELSIF v_digits ~ '^8[0-9]{8,13}$' THEN
        v_e164 := '+62' || v_digits;
    ELSIF v_digits ~ '^62[8][0-9]{8,13}$' THEN
        v_e164 := '+' || v_digits;
    ELSIF v_digits ~ '^962[1-9][0-9]{6,11}$' THEN
        v_e164 := '+' || v_digits;
    ELSIF v_digits ~ '^967[1-9][0-9]{6,11}$' THEN
        v_e164 := '+' || v_digits;
    ELSE
        RETURN NULL;
    END IF;

    IF v_e164 ~ '^(\+62[8][0-9]{8,13}|\+962[1-9][0-9]{6,11}|\+967[1-9][0-9]{6,11})$' THEN
        RETURN v_e164;
    END IF;
    RETURN NULL;
END;
$function$;

-- Internal creator. A source event can create each document exactly once.
CREATE OR REPLACE FUNCTION public.kdj_create_financial_document(
    p_document_type text,
    p_source_type text,
    p_source_event_id uuid,
    p_source_key text,
    p_pendaftar_id uuid,
    p_registration_payment_id uuid,
    p_departure_order_id uuid,
    p_amount_idr integer,
    p_due_at timestamptz,
    p_snapshot jsonb,
    p_recipient_phone text,
    p_supersedes_document_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_year integer := EXTRACT(YEAR FROM pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::integer;
    v_number bigint;
    v_prefix text;
    v_document_number text;
    v_document_id uuid;
    v_snapshot jsonb;
BEGIN
    IF p_document_type NOT IN ('INVOICE', 'RECEIPT')
       OR p_source_type NOT IN ('REGISTRATION_PAYMENT_EVENT', 'DEPARTURE_PAYMENT_EVENT')
       OR p_source_event_id IS NULL
       OR p_source_key IS NULL OR length(pg_catalog.btrim(p_source_key)) < 8
       OR p_pendaftar_id IS NULL
       OR p_amount_idr IS NULL OR p_amount_idr <= 0
       OR p_snapshot IS NULL OR pg_catalog.jsonb_typeof(p_snapshot) <> 'object'
       OR (p_document_type = 'RECEIPT' AND p_due_at IS NOT NULL)
       OR (p_document_type = 'INVOICE' AND p_source_type = 'REGISTRATION_PAYMENT_EVENT' AND p_due_at IS NULL)
    THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_FINANCIAL_DOCUMENT_PAYLOAD';
    END IF;

    SELECT id INTO v_document_id
    FROM public.kdj_financial_documents
    WHERE source_key = p_source_key;
    IF FOUND THEN
        RETURN v_document_id;
    END IF;

    INSERT INTO public.kdj_financial_document_counters (document_year, document_type, last_number)
    VALUES (v_year, p_document_type, 1)
    ON CONFLICT (document_year, document_type)
    DO UPDATE SET
        last_number = public.kdj_financial_document_counters.last_number + 1,
        updated_at = pg_catalog.now()
    RETURNING last_number INTO v_number;

    v_prefix := CASE WHEN p_document_type = 'INVOICE' THEN 'INV' ELSE 'KWT' END;
    v_document_number := v_prefix || '/KDJ/' || v_year::text || '/' || pg_catalog.lpad(v_number::text, 6, '0');
    v_snapshot := p_snapshot || pg_catalog.jsonb_build_object(
        'document_type', p_document_type,
        'document_number', v_document_number,
        'issued_at', pg_catalog.now(),
        'currency', 'IDR',
        'issuer', pg_catalog.jsonb_build_object(
            'display_name', 'KULIAH DI JORDAN',
            'legal_name', 'Yayasan Generasi Cerdas Akhlakul Karimah',
            'address', 'KDJ HOME OFFICE Jl. Pulo Mangga Raya No. 157 Grogol, Limo, Depok',
            'phone', '081366245544',
            'instagram', '@kuliahdijordan',
            'email', 'kdjmendunia@gmail.com',
            'bank_account_holder', 'Yayasan Generasi Cerdas Akhlakul Karimah',
            'bank_name', 'BSI',
            'bank_account_number', '7169735128',
            'payment_warning', 'KAMI TIDAK BERTANGGUNG JAWAB JIKA PEMBAYARAN TIDAK MELALUI REKENING DI ATAS',
            'signatory_name', 'Cyntia Nabila',
            'logo_sha256', 'f767d1b60983722435769d59654b8693a4dbe4524f52249486e99bacbad15b6b',
            'signature_sha256', '82b765625730ec6ab70e9bc0f093ad1c40c3d0d4f643074e22596c9e07ba4c51',
            'transfer_label', 'Transfer via Rekening Bank'
        )
    );

    INSERT INTO public.kdj_financial_documents (
        document_type, document_number, source_type, source_event_id, source_key,
        pendaftar_id, registration_payment_id, departure_order_id,
        amount_idr, status, due_at, supersedes_document_id, document_snapshot
    )
    VALUES (
        p_document_type, v_document_number, p_source_type, p_source_event_id, p_source_key,
        p_pendaftar_id, p_registration_payment_id, p_departure_order_id,
        p_amount_idr, 'ISSUED', p_due_at, p_supersedes_document_id, v_snapshot
    )
    ON CONFLICT (source_key) DO NOTHING
    RETURNING id INTO v_document_id;

    IF v_document_id IS NULL THEN
        SELECT id INTO v_document_id
        FROM public.kdj_financial_documents
        WHERE source_key = p_source_key;
        RETURN v_document_id;
    END IF;

    INSERT INTO public.kdj_financial_document_events (
        document_id, event_type, new_status, actor_type, metadata
    )
    VALUES (
        v_document_id, 'ISSUED', 'ISSUED', 'SYSTEM',
        pg_catalog.jsonb_build_object('source_type', p_source_type, 'source_event_id', p_source_event_id)
    );

    IF p_recipient_phone IS NOT NULL AND p_recipient_phone ~ '^(\+62[8][0-9]{8,13}|\+962[1-9][0-9]{6,11}|\+967[1-9][0-9]{6,11})$' THEN
        INSERT INTO public.kdj_financial_document_outbox (
            document_id, recipient_phone, status
        )
        VALUES (v_document_id, p_recipient_phone, 'PENDING')
        ON CONFLICT (document_id, recipient_phone) DO NOTHING;

        INSERT INTO public.kdj_financial_document_events (
            document_id, event_type, new_status, actor_type, metadata
        )
        VALUES (
            v_document_id, 'DELIVERY_QUEUED', 'PENDING', 'SYSTEM',
            pg_catalog.jsonb_build_object('recipient_phone_masked',
                pg_catalog.left(p_recipient_phone, 4) || '******' || pg_catalog.right(p_recipient_phone, 3))
        );
    END IF;

    RETURN v_document_id;
END;
$function$;

-- Create registration invoices/receipts from committed payment events.
CREATE OR REPLACE FUNCTION public.kdj_on_registration_financial_document_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_payment public.kdj_registration_payments%ROWTYPE;
    v_student public.pendaftar%ROWTYPE;
    v_document_id uuid;
    v_old_document record;
    v_superseded_document_id uuid;
    v_snapshot jsonb;
    v_recipient text;
BEGIN
    SELECT * INTO v_payment
    FROM public.kdj_registration_payments
    WHERE id = NEW.payment_id;
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    SELECT * INTO v_student
    FROM public.pendaftar
    WHERE id = NEW.pendaftar_id;
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    v_recipient := public.kdj_normalize_financial_document_phone(v_student.no_wa);

    IF NEW.event_type = 'INITIAL_FORM_SUBMITTED' THEN
        v_snapshot := pg_catalog.jsonb_build_object(
            'customer', pg_catalog.jsonb_build_object(
                'pendaftar_id', v_student.id,
                'name', COALESCE(v_student.nama_lengkap, 'Calon Mahasiswa'),
                'whatsapp', v_recipient
            ),
            'line_items', pg_catalog.jsonb_build_array(
                pg_catalog.jsonb_build_object(
                    'description', 'Biaya pendaftaran awal KDJ',
                    'quantity', 1,
                    'unit_amount_idr', v_payment.amount_idr,
                    'total_amount_idr', v_payment.amount_idr
                )
            ),
            'amount_idr', v_payment.amount_idr,
            'due_at', v_payment.deadline_at,
            'payment_instructions', 'Transfer ke rekening BSI atas nama Yayasan Generasi Cerdas Akhlakul Karimah.',
            'notes', 'Invoice pendaftaran terpisah dari biaya paket keberangkatan.'
        );

        PERFORM public.kdj_create_financial_document(
            'INVOICE', 'REGISTRATION_PAYMENT_EVENT', NEW.id,
            'REGISTRATION:' || v_payment.id::text || ':INITIAL_INVOICE',
            v_student.id, v_payment.id, NULL, v_payment.amount_idr,
            v_payment.deadline_at, v_snapshot, v_recipient, NULL
        );

    ELSIF NEW.event_type = 'PAYMENT_VERIFIED_PAID' THEN
        FOR v_old_document IN
            UPDATE public.kdj_financial_documents
            SET status = 'PAID',
                paid_at = COALESCE(v_payment.paid_at, pg_catalog.now()),
                updated_at = pg_catalog.now()
            WHERE registration_payment_id = v_payment.id
              AND document_type = 'INVOICE'
              AND status = 'ISSUED'
            RETURNING id, document_number
        LOOP
            INSERT INTO public.kdj_financial_document_events (
                document_id, event_type, previous_status, new_status, actor_type,
                actor_admin_id, reason, metadata
            )
            VALUES (
                v_old_document.id, 'PAID', 'ISSUED', 'PAID', 'ADMIN',
                NEW.actor_admin_id, 'Pembayaran pendaftaran diverifikasi.',
                pg_catalog.jsonb_build_object('verification_event_id', NEW.id)
            );
        END LOOP;

        v_snapshot := pg_catalog.jsonb_build_object(
            'customer', pg_catalog.jsonb_build_object(
                'pendaftar_id', v_student.id,
                'name', COALESCE(v_student.nama_lengkap, 'Calon Mahasiswa'),
                'whatsapp', v_recipient
            ),
            'line_items', pg_catalog.jsonb_build_array(
                pg_catalog.jsonb_build_object(
                    'description', 'Pembayaran biaya pendaftaran KDJ',
                    'quantity', 1,
                    'unit_amount_idr', v_payment.amount_idr,
                    'total_amount_idr', v_payment.amount_idr
                )
            ),
            'amount_idr', v_payment.amount_idr,
            'payment_entries', pg_catalog.jsonb_build_array(
                pg_catalog.jsonb_build_object(
                    'description', 'Pembayaran biaya pendaftaran',
                    'amount_idr', v_payment.amount_idr,
                    'paid_at', COALESCE(v_payment.paid_at, pg_catalog.now()),
                    'method', 'Transfer via BSI',
                    'status', 'Lunas'
                )
            ),
            'package_items', pg_catalog.jsonb_build_array(
                pg_catalog.jsonb_build_object(
                    'quantity', 1,
                    'description', 'Biaya pendaftaran KDJ',
                    'amount_idr', v_payment.amount_idr
                )
            ),
            'package_total_amount_idr', v_payment.amount_idr,
            'total_paid_amount_idr', v_payment.amount_idr,
            'remaining_amount_idr', 0,
            'payment_received_at', COALESCE(v_payment.paid_at, pg_catalog.now()),
            'payment_method', 'TRANSFER BANK BSI',
            'payment_reference', v_payment.invoice_ref,
            'notes', 'Kuitansi diterbitkan setelah pembayaran diverifikasi oleh Admin KDJ.'
        );

        PERFORM public.kdj_create_financial_document(
            'RECEIPT', 'REGISTRATION_PAYMENT_EVENT', NEW.id,
            'REGISTRATION:' || v_payment.id::text || ':RECEIPT',
            v_student.id, v_payment.id, NULL, v_payment.amount_idr,
            NULL, v_snapshot, v_recipient, NULL
        );

    ELSIF NEW.event_type = 'PAYMENT_REOPENED' THEN
        v_superseded_document_id := NULL;
        FOR v_old_document IN
            UPDATE public.kdj_financial_documents
            SET status = 'SUPERSEDED', updated_at = pg_catalog.now()
            WHERE registration_payment_id = v_payment.id
              AND document_type = 'INVOICE'
              AND status = 'ISSUED'
            RETURNING id
        LOOP
            v_superseded_document_id := v_old_document.id;
            INSERT INTO public.kdj_financial_document_events (
                document_id, event_type, previous_status, new_status, actor_type, actor_admin_id,
                reason, metadata
            )
            VALUES (
                v_old_document.id, 'SUPERSEDED', 'ISSUED', 'SUPERSEDED', 'ADMIN', NEW.actor_admin_id,
                'Invoice digantikan setelah invoice pendaftaran dibuka kembali.',
                pg_catalog.jsonb_build_object('replacement_payment_event_id', NEW.id)
            );
        END LOOP;

        v_snapshot := pg_catalog.jsonb_build_object(
            'customer', pg_catalog.jsonb_build_object(
                'pendaftar_id', v_student.id,
                'name', COALESCE(v_student.nama_lengkap, 'Calon Mahasiswa'),
                'whatsapp', v_recipient
            ),
            'line_items', pg_catalog.jsonb_build_array(
                pg_catalog.jsonb_build_object(
                    'description', 'Tagihan ulang biaya pendaftaran KDJ',
                    'quantity', 1,
                    'unit_amount_idr', v_payment.amount_idr,
                    'total_amount_idr', v_payment.amount_idr
                )
            ),
            'amount_idr', v_payment.amount_idr,
            'due_at', v_payment.deadline_at,
            'payment_instructions', 'Transfer ke rekening BSI atas nama Yayasan Generasi Cerdas Akhlakul Karimah.',
            'notes', 'Invoice pengganti; invoice sebelumnya tetap tersimpan sebagai histori.'
        );

        PERFORM public.kdj_create_financial_document(
            'INVOICE', 'REGISTRATION_PAYMENT_EVENT', NEW.id,
            'REGISTRATION:' || v_payment.id::text || ':REOPENED_INVOICE:' || v_payment.deadline_at::text,
            v_student.id, v_payment.id, NULL, v_payment.amount_idr,
            v_payment.deadline_at, v_snapshot, v_recipient, v_superseded_document_id
        );
    END IF;

    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_kdj_registration_financial_document_event
    ON public.kdj_registration_payment_events;
CREATE TRIGGER trg_kdj_registration_financial_document_event
AFTER INSERT ON public.kdj_registration_payment_events
FOR EACH ROW
EXECUTE FUNCTION public.kdj_on_registration_financial_document_event();

-- Create package invoices and installment receipts from the departure payment ledger.
CREATE OR REPLACE FUNCTION public.kdj_on_departure_financial_document_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_order public.kdj_departure_orders%ROWTYPE;
    v_student public.pendaftar%ROWTYPE;
    v_installment public.kdj_departure_installments%ROWTYPE;
    v_recipient text;
    v_snapshot jsonb;
    v_superseded record;
BEGIN
    SELECT * INTO v_order
    FROM public.kdj_departure_orders
    WHERE id = NEW.order_id;
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    SELECT * INTO v_student
    FROM public.pendaftar
    WHERE id = NEW.pendaftar_id;
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    v_recipient := public.kdj_normalize_financial_document_phone(v_student.no_wa);

    IF NEW.event_type = 'PACKAGE_SELECTED' THEN
        -- A retried selection of the same package does not issue another invoice.
        IF EXISTS (
            SELECT 1
            FROM public.kdj_financial_documents d
            WHERE d.departure_order_id = v_order.id
              AND d.document_type = 'INVOICE'
              AND d.status = 'ISSUED'
              AND d.amount_idr = v_order.total_amount_idr
              AND d.document_snapshot #>> '{package,package_id}' = v_order.package_id
        ) THEN
            RETURN NEW;
        END IF;

        FOR v_superseded IN
            UPDATE public.kdj_financial_documents
            SET status = 'SUPERSEDED', updated_at = pg_catalog.now()
            WHERE departure_order_id = v_order.id
              AND document_type = 'INVOICE'
              AND status = 'ISSUED'
            RETURNING id
        LOOP
            INSERT INTO public.kdj_financial_document_events (
                document_id, event_type, previous_status, new_status, actor_type, reason
            )
            VALUES (
                v_superseded.id, 'SUPERSEDED', 'ISSUED', 'SUPERSEDED', 'SYSTEM',
                'Invoice paket digantikan setelah pemilihan paket terbaru.'
            );
        END LOOP;

        v_snapshot := pg_catalog.jsonb_build_object(
            'customer', pg_catalog.jsonb_build_object(
                'pendaftar_id', v_student.id,
                'name', COALESCE(v_student.nama_lengkap, 'Calon Mahasiswa'),
                'whatsapp', v_recipient
            ),
            'package', pg_catalog.jsonb_build_object(
                'package_id', v_order.package_id,
                'package_name', v_order.package_name
            ),
            'line_items', pg_catalog.jsonb_build_array(
                pg_catalog.jsonb_build_object(
                    'description', 'Tagihan paket keberangkatan - ' || v_order.package_name,
                    'quantity', 1,
                    'unit_amount_idr', v_order.total_amount_idr,
                    'total_amount_idr', v_order.total_amount_idr
                )
            ),
            'amount_idr', v_order.total_amount_idr,
            'total_amount_idr', v_order.total_amount_idr,
            'paid_amount_idr', v_order.paid_amount_idr,
            'remaining_amount_idr', v_order.remaining_amount_idr,
            'payment_instructions', 'Pembayaran dapat dilakukan sekaligus atau dicicil dengan nominal sesuai kemampuan sampai lunas.',
            'notes', 'H-45 adalah trigger follow-up pelunasan, bukan batas pembayaran. Pembayaran parsial tetap diterima setelah H-45 sampai lunas.'
        );

        PERFORM public.kdj_create_financial_document(
            'INVOICE', 'DEPARTURE_PAYMENT_EVENT', NEW.id,
            'DEPARTURE:' || v_order.id::text || ':PACKAGE_INVOICE:' || NEW.id::text,
            v_student.id, NULL, v_order.id, v_order.total_amount_idr,
            NULL, v_snapshot, v_recipient, NULL
        );

    ELSIF NEW.event_type = 'INSTALLMENT_VERIFIED' THEN
        -- A duplicate verification event for the same installment cannot emit
        -- a second receipt or a second replacement invoice.
        IF EXISTS (
            SELECT 1
            FROM public.kdj_financial_documents d
            WHERE d.source_key = 'DEPARTURE:' || v_order.id::text ||
                ':INSTALLMENT_RECEIPT:' || NEW.installment_id::text
        ) THEN
            RETURN NEW;
        END IF;

        SELECT * INTO v_installment
        FROM public.kdj_departure_installments
        WHERE id = NEW.installment_id;

        IF NOT FOUND OR v_installment.status <> 'VERIFIED' THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'VERIFIED_INSTALLMENT_NOT_FOUND_FOR_RECEIPT';
        END IF;

        v_snapshot := pg_catalog.jsonb_build_object(
            'customer', pg_catalog.jsonb_build_object(
                'pendaftar_id', v_student.id,
                'name', COALESCE(v_student.nama_lengkap, 'Calon Mahasiswa'),
                'whatsapp', v_recipient
            ),
            'package', pg_catalog.jsonb_build_object(
                'package_id', v_order.package_id,
                'package_name', v_order.package_name
            ),
            'line_items', pg_catalog.jsonb_build_array(
                pg_catalog.jsonb_build_object(
                    'description', 'Pembayaran cicilan paket keberangkatan - ' || v_order.package_name,
                    'quantity', 1,
                    'unit_amount_idr', v_installment.amount_idr,
                    'total_amount_idr', v_installment.amount_idr
                )
            ),
            'amount_idr', v_installment.amount_idr,
            'payment_entries', pg_catalog.jsonb_build_array(
                pg_catalog.jsonb_build_object(
                    'description', 'Pembayaran ' || v_installment.installment_no,
                    'amount_idr', v_installment.amount_idr,
                    'paid_at', COALESCE(v_installment.verified_at, NEW.created_at),
                    'method', 'Transfer via BSI',
                    'status', 'Lunas'
                )
            ),
            'package_items', pg_catalog.jsonb_build_array(
                pg_catalog.jsonb_build_object(
                    'quantity', 1,
                    'description', v_order.package_name,
                    'amount_idr', v_order.total_amount_idr
                )
            ),
            'package_total_amount_idr', v_order.total_amount_idr,
            'total_paid_amount_idr', NEW.new_paid_amount_idr,
            'remaining_amount_idr', NEW.remaining_amount_idr,
            'payment_received_at', v_installment.verified_at,
            'payment_method', 'TRANSFER BANK BSI',
            'installment_no', v_installment.installment_no,
            'total_amount_idr', v_order.total_amount_idr,
            'total_paid_after_transaction_idr', NEW.new_paid_amount_idr,
            'remaining_after_transaction_idr', NEW.remaining_amount_idr,
            'notes', 'Kuitansi untuk nominal pembayaran yang telah diverifikasi Admin KDJ. H-45 hanya trigger follow-up dan tidak membatasi cicilan.'
        );

        PERFORM public.kdj_create_financial_document(
            'RECEIPT', 'DEPARTURE_PAYMENT_EVENT', NEW.id,
            'DEPARTURE:' || v_order.id::text || ':INSTALLMENT_RECEIPT:' || v_installment.id::text,
            v_student.id, NULL, v_order.id, v_installment.amount_idr,
            NULL, v_snapshot, v_recipient, NULL
        );

        IF NEW.remaining_amount_idr = 0 THEN
            FOR v_superseded IN
                UPDATE public.kdj_financial_documents
                SET status = 'PAID',
                    paid_at = COALESCE(v_order.fully_paid_at, pg_catalog.now()),
                    updated_at = pg_catalog.now()
                WHERE departure_order_id = v_order.id
                  AND document_type = 'INVOICE'
                  AND status = 'ISSUED'
                RETURNING id
            LOOP
                INSERT INTO public.kdj_financial_document_events (
                    document_id, event_type, previous_status, new_status, actor_type,
                    reason, metadata
                )
                VALUES (
                    v_superseded.id, 'PAID', 'ISSUED', 'PAID', 'SYSTEM',
                    'Seluruh sisa tagihan paket telah diverifikasi lunas.',
                    pg_catalog.jsonb_build_object('payment_event_id', NEW.id)
                );
            END LOOP;
        ELSE
            FOR v_superseded IN
                UPDATE public.kdj_financial_documents
                SET status = 'SUPERSEDED', updated_at = pg_catalog.now()
                WHERE departure_order_id = v_order.id
                  AND document_type = 'INVOICE'
                  AND status = 'ISSUED'
                RETURNING id
            LOOP
                INSERT INTO public.kdj_financial_document_events (
                    document_id, event_type, previous_status, new_status, actor_type,
                    reason, metadata
                )
                VALUES (
                    v_superseded.id, 'SUPERSEDED', 'ISSUED', 'SUPERSEDED', 'SYSTEM',
                    'Invoice lama digantikan dengan invoice seluruh sisa tagihan setelah pembayaran terverifikasi.',
                    pg_catalog.jsonb_build_object('payment_event_id', NEW.id)
                );
            END LOOP;

            v_snapshot := pg_catalog.jsonb_build_object(
                'customer', pg_catalog.jsonb_build_object(
                    'pendaftar_id', v_student.id,
                    'name', COALESCE(v_student.nama_lengkap, 'Calon Mahasiswa'),
                    'whatsapp', v_recipient
                ),
                'package', pg_catalog.jsonb_build_object(
                    'package_id', v_order.package_id,
                    'package_name', v_order.package_name
                ),
                'line_items', pg_catalog.jsonb_build_array(
                    pg_catalog.jsonb_build_object(
                        'description', 'Sisa tagihan paket keberangkatan - ' || v_order.package_name,
                        'quantity', 1,
                        'unit_amount_idr', NEW.remaining_amount_idr,
                        'total_amount_idr', NEW.remaining_amount_idr
                    )
                ),
                'amount_idr', NEW.remaining_amount_idr,
                'total_amount_idr', v_order.total_amount_idr,
                'total_paid_idr', NEW.new_paid_amount_idr,
                'remaining_amount_idr', NEW.remaining_amount_idr,
                'payment_instructions', 'Pembayaran dapat dilakukan sekaligus atau dicicil dengan nominal sesuai kemampuan sampai lunas.',
                'notes', 'Invoice ini menagih seluruh sisa tagihan. H-45 hanya trigger follow-up; pembayaran parsial tetap diterima sampai lunas.'
            );

            PERFORM public.kdj_create_financial_document(
                'INVOICE', 'DEPARTURE_PAYMENT_EVENT', NEW.id,
                'DEPARTURE:' || v_order.id::text || ':REMAINING_INVOICE:' || NEW.id::text,
                v_student.id, NULL, v_order.id, NEW.remaining_amount_idr,
                NULL, v_snapshot, v_recipient,
                (SELECT id FROM public.kdj_financial_documents
                 WHERE departure_order_id = v_order.id
                   AND document_type = 'INVOICE'
                   AND status = 'SUPERSEDED'
                 ORDER BY issued_at DESC LIMIT 1)
            );
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_kdj_departure_financial_document_event
    ON public.kdj_departure_payment_events;
CREATE TRIGGER trg_kdj_departure_financial_document_event
AFTER INSERT ON public.kdj_departure_payment_events
FOR EACH ROW
EXECUTE FUNCTION public.kdj_on_departure_financial_document_event();

-- Store rendered PDF metadata. The Portal calls this only after private Storage upload succeeds.
CREATE OR REPLACE FUNCTION public.kdj_financial_document_mark_rendered(
    p_document_id uuid,
    p_storage_path text,
    p_sha256 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_document public.kdj_financial_documents%ROWTYPE;
BEGIN
    IF p_document_id IS NULL
       OR p_storage_path IS NULL
       OR p_storage_path !~ '^[0-9a-f-]{36}/[A-Z]{3}/[0-9]{4}/[A-Z0-9_-]+[.]pdf$'
       OR p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_RENDERED_DOCUMENT_METADATA';
    END IF;

    SELECT * INTO v_document
    FROM public.kdj_financial_documents
    WHERE id = p_document_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'FINANCIAL_DOCUMENT_NOT_FOUND';
    END IF;

    IF pg_catalog.split_part(p_storage_path, '/', 1) <> v_document.pendaftar_id::text THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'FINANCIAL_DOCUMENT_STORAGE_OWNER_MISMATCH';
    END IF;

    IF (v_document.document_type = 'INVOICE' AND pg_catalog.split_part(p_storage_path, '/', 2) <> 'INV')
       OR (v_document.document_type = 'RECEIPT' AND pg_catalog.split_part(p_storage_path, '/', 2) <> 'KWT') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'FINANCIAL_DOCUMENT_STORAGE_TYPE_MISMATCH';
    END IF;

    IF v_document.storage_path IS NOT NULL
       AND (v_document.storage_path <> p_storage_path OR v_document.sha256 <> p_sha256) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'FINANCIAL_DOCUMENT_PDF_IS_IMMUTABLE';
    END IF;

    UPDATE public.kdj_financial_documents
    SET storage_path = p_storage_path,
        sha256 = p_sha256,
        rendered_at = COALESCE(rendered_at, pg_catalog.now()),
        updated_at = pg_catalog.now()
    WHERE id = p_document_id
    RETURNING * INTO v_document;

    INSERT INTO public.kdj_financial_document_events (
        document_id, event_type, new_status, actor_type, metadata
    )
    SELECT p_document_id, 'RENDERED', v_document.status, 'SYSTEM',
           pg_catalog.jsonb_build_object('sha256', p_sha256)
    WHERE NOT EXISTS (
        SELECT 1 FROM public.kdj_financial_document_events
        WHERE document_id = p_document_id AND event_type = 'RENDERED'
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'document_id', v_document.id,
        'storage_path', v_document.storage_path,
        'sha256', v_document.sha256
    );
END;
$function$;

-- Durable worker claim. An expired in-flight delivery is UNKNOWN, never auto-retried.
CREATE OR REPLACE FUNCTION public.kdj_financial_document_claim_outbox_batch(
    p_batch_size integer DEFAULT 5
)
RETURNS TABLE (
    outbox_id uuid,
    document_id uuid,
    recipient_phone text,
    claim_token uuid,
    document_number text,
    document_type text,
    storage_path text,
    attempt_no integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    IF p_batch_size IS NULL OR p_batch_size < 1 OR p_batch_size > 50 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_FINANCIAL_OUTBOX_BATCH_SIZE';
    END IF;

    WITH expired AS (
        UPDATE public.kdj_financial_document_outbox o
        SET status = 'UNKNOWN',
            claim_token = NULL,
            lease_until = NULL,
            last_error_code = 'LEASE_EXPIRED',
            last_error_message = 'Worker lease expired before a definitive provider acknowledgement.',
            updated_at = pg_catalog.now()
        WHERE o.status = 'PROCESSING'
          AND o.lease_until <= pg_catalog.now()
        RETURNING o.id, o.document_id
    )
    INSERT INTO public.kdj_financial_document_events (
        document_id, event_type, actor_type, reason, metadata
    )
    SELECT e.document_id, 'DELIVERY_UNKNOWN', 'BOT',
           'Lease pengiriman habis; hasil WhatsApp perlu direkonsiliasi.',
           pg_catalog.jsonb_build_object('outbox_id', e.id, 'error_code', 'LEASE_EXPIRED')
    FROM expired e;

    RETURN QUERY
    WITH picked AS (
        SELECT o.id
        FROM public.kdj_financial_document_outbox o
        WHERE o.status = 'PENDING'
        ORDER BY o.queued_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT p_batch_size
    ),
    claimed AS (
        UPDATE public.kdj_financial_document_outbox o
        SET status = 'PROCESSING',
            claim_token = gen_random_uuid(),
            lease_until = pg_catalog.now() + interval '3 minutes',
            attempts = o.attempts + 1,
            updated_at = pg_catalog.now()
        FROM picked
        WHERE o.id = picked.id
        RETURNING o.*
    )
    SELECT c.id, c.document_id, c.recipient_phone, c.claim_token,
           d.document_number, d.document_type, d.storage_path, c.attempts
    FROM claimed c
    JOIN public.kdj_financial_documents d ON d.id = c.document_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.kdj_financial_document_finish_outbox(
    p_outbox_id uuid,
    p_claim_token uuid,
    p_outcome text,
    p_provider_message_id text DEFAULT NULL,
    p_error_code text DEFAULT NULL,
    p_error_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_row public.kdj_financial_document_outbox%ROWTYPE;
    v_event_type text;
BEGIN
        IF p_outbox_id IS NULL OR p_claim_token IS NULL
       OR p_outcome NOT IN ('SENT', 'FAILED', 'UNKNOWN')
       OR (p_outcome = 'SENT' AND NULLIF(pg_catalog.btrim(p_provider_message_id), '') IS NULL) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_FINANCIAL_OUTBOX_FINISH';
    END IF;

    SELECT * INTO v_row
    FROM public.kdj_financial_document_outbox
    WHERE id = p_outbox_id
    FOR UPDATE;

    IF NOT FOUND OR v_row.status <> 'PROCESSING' OR v_row.claim_token <> p_claim_token THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'FINANCIAL_OUTBOX_CLAIM_MISMATCH';
    END IF;

    UPDATE public.kdj_financial_document_outbox
    SET status = p_outcome,
        claim_token = NULL,
        lease_until = NULL,
        provider_message_id = CASE WHEN p_outcome = 'SENT' THEN p_provider_message_id ELSE provider_message_id END,
        sent_at = CASE WHEN p_outcome = 'SENT' THEN pg_catalog.now() ELSE sent_at END,
        last_error_code = CASE WHEN p_outcome = 'SENT' THEN NULL ELSE left(COALESCE(p_error_code, p_outcome), 80) END,
        last_error_message = CASE WHEN p_outcome = 'SENT' THEN NULL ELSE left(COALESCE(p_error_message, p_outcome), 1000) END,
        updated_at = pg_catalog.now()
    WHERE id = p_outbox_id
    RETURNING * INTO v_row;

    v_event_type := CASE
        WHEN p_outcome = 'SENT' THEN 'DELIVERY_SENT'
        WHEN p_outcome = 'FAILED' THEN 'DELIVERY_FAILED'
        ELSE 'DELIVERY_UNKNOWN'
    END;

    INSERT INTO public.kdj_financial_document_events (
        document_id, event_type, actor_type, reason, metadata
    )
    VALUES (
        v_row.document_id, v_event_type, 'BOT',
        CASE WHEN p_outcome = 'SENT' THEN 'Dokumen dikirim melalui WhatsApp.' ELSE left(COALESCE(p_error_message, p_outcome), 1000) END,
        pg_catalog.jsonb_build_object(
            'outbox_id', v_row.id,
            'provider_message_id', v_row.provider_message_id,
            'attempts', v_row.attempts,
            'error_code', v_row.last_error_code
        )
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', true, 'outbox_id', v_row.id, 'status', v_row.status
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.kdj_admin_resend_financial_document(
    p_outbox_id uuid,
    p_actor_admin_id uuid,
    p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_admin public.admins%ROWTYPE;
    v_row public.kdj_financial_document_outbox%ROWTYPE;
BEGIN
    IF p_outbox_id IS NULL OR p_actor_admin_id IS NULL
       OR p_reason IS NULL OR length(pg_catalog.btrim(p_reason)) < 3 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_FINANCIAL_DOCUMENT_RESEND';
    END IF;

    SELECT * INTO v_admin
    FROM public.admins
    WHERE id = p_actor_admin_id
      AND is_active IS TRUE
      AND disabled_at IS NULL
      AND role = 'Super Admin'
    FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'FINANCIAL_DOCUMENT_SUPER_ADMIN_REQUIRED';
    END IF;

    SELECT * INTO v_row
    FROM public.kdj_financial_document_outbox
    WHERE id = p_outbox_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'FINANCIAL_DOCUMENT_OUTBOX_NOT_FOUND';
    END IF;
    IF v_row.status = 'UNKNOWN' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UNKNOWN_DELIVERY_REQUIRES_RECONCILIATION';
    END IF;
    IF v_row.status NOT IN ('FAILED', 'SENT') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'FINANCIAL_DOCUMENT_NOT_RESENDABLE';
    END IF;

    UPDATE public.kdj_financial_document_outbox
    SET status = 'PENDING',
        claim_token = NULL,
        lease_until = NULL,
        last_error_code = NULL,
        last_error_message = NULL,
        queued_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    WHERE id = p_outbox_id
    RETURNING * INTO v_row;

    INSERT INTO public.kdj_financial_document_events (
        document_id, event_type, previous_status, new_status, actor_type, actor_admin_id,
        reason, metadata
    )
    VALUES (
        v_row.document_id, 'RESEND_REQUESTED', CASE WHEN v_row.sent_at IS NOT NULL THEN 'SENT' ELSE 'FAILED' END,
        'PENDING', 'ADMIN', v_admin.id, pg_catalog.btrim(p_reason),
        pg_catalog.jsonb_build_object('outbox_id', v_row.id, 'same_document', true)
    );

    RETURN pg_catalog.jsonb_build_object('success', true, 'status', v_row.status);
END;
$function$;

CREATE OR REPLACE FUNCTION public.kdj_admin_reconcile_financial_document_unknown(
    p_outbox_id uuid,
    p_resolution text,
    p_provider_message_id text,
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
    v_row public.kdj_financial_document_outbox%ROWTYPE;
    v_new_status text;
BEGIN
    IF p_outbox_id IS NULL
       OR p_resolution NOT IN ('CONFIRMED_SENT', 'CONFIRMED_NOT_SENT')
       OR p_reason IS NULL OR length(pg_catalog.btrim(p_reason)) < 3
       OR p_actor_admin_id IS NULL
       OR (p_resolution = 'CONFIRMED_SENT' AND COALESCE(length(pg_catalog.btrim(p_provider_message_id)), 0) = 0)
    THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_UNKNOWN_RECONCILIATION';
    END IF;

    SELECT * INTO v_admin
    FROM public.admins
    WHERE id = p_actor_admin_id
      AND is_active IS TRUE
      AND disabled_at IS NULL
      AND role = 'Super Admin'
    FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'FINANCIAL_DOCUMENT_SUPER_ADMIN_REQUIRED';
    END IF;

    SELECT * INTO v_row
    FROM public.kdj_financial_document_outbox
    WHERE id = p_outbox_id
    FOR UPDATE;
    IF NOT FOUND OR v_row.status <> 'UNKNOWN' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'FINANCIAL_OUTBOX_NOT_UNKNOWN';
    END IF;

    v_new_status := CASE WHEN p_resolution = 'CONFIRMED_SENT' THEN 'SENT' ELSE 'PENDING' END;

    UPDATE public.kdj_financial_document_outbox
    SET status = v_new_status,
        provider_message_id = CASE WHEN p_resolution = 'CONFIRMED_SENT' THEN p_provider_message_id ELSE NULL END,
        sent_at = CASE WHEN p_resolution = 'CONFIRMED_SENT' THEN pg_catalog.now() ELSE NULL END,
        claim_token = NULL,
        lease_until = NULL,
        last_error_code = NULL,
        last_error_message = NULL,
        queued_at = CASE WHEN p_resolution = 'CONFIRMED_NOT_SENT' THEN pg_catalog.now() ELSE queued_at END,
        updated_at = pg_catalog.now()
    WHERE id = p_outbox_id
    RETURNING * INTO v_row;

    INSERT INTO public.kdj_financial_document_events (
        document_id, event_type, previous_status, new_status, actor_type, actor_admin_id,
        reason, metadata
    )
    VALUES (
        v_row.document_id, 'UNKNOWN_RECONCILED', 'UNKNOWN', v_new_status, 'ADMIN', v_admin.id,
        pg_catalog.btrim(p_reason),
        pg_catalog.jsonb_build_object(
            'outbox_id', v_row.id,
            'resolution', p_resolution,
            'provider_message_id', p_provider_message_id
        )
    );

    RETURN pg_catalog.jsonb_build_object('success', true, 'status', v_row.status);
END;
$function$;

CREATE OR REPLACE FUNCTION public.kdj_guard_financial_document_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'FINANCIAL_DOCUMENT_DELETE_FORBIDDEN';
    END IF;

    IF ROW(
        NEW.document_type, NEW.document_number, NEW.source_type, NEW.source_event_id,
        NEW.source_key, NEW.pendaftar_id, NEW.registration_payment_id, NEW.departure_order_id,
        NEW.amount_idr, NEW.currency, NEW.issued_at, NEW.due_at, NEW.supersedes_document_id,
        NEW.document_snapshot, NEW.storage_bucket
    ) IS DISTINCT FROM ROW(
        OLD.document_type, OLD.document_number, OLD.source_type, OLD.source_event_id,
        OLD.source_key, OLD.pendaftar_id, OLD.registration_payment_id, OLD.departure_order_id,
        OLD.amount_idr, OLD.currency, OLD.issued_at, OLD.due_at, OLD.supersedes_document_id,
        OLD.document_snapshot, OLD.storage_bucket
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'FINANCIAL_DOCUMENT_CONTENT_IS_IMMUTABLE';
    END IF;

    IF OLD.storage_path IS NOT NULL
       AND (NEW.storage_path IS DISTINCT FROM OLD.storage_path OR NEW.sha256 IS DISTINCT FROM OLD.sha256) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'FINANCIAL_DOCUMENT_PDF_IS_IMMUTABLE';
    END IF;

    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_kdj_financial_document_immutable
    ON public.kdj_financial_documents;
CREATE TRIGGER trg_kdj_financial_document_immutable
BEFORE UPDATE OR DELETE ON public.kdj_financial_documents
FOR EACH ROW EXECUTE FUNCTION public.kdj_guard_financial_document_immutable();

CREATE OR REPLACE FUNCTION public.kdj_guard_financial_document_event_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'FINANCIAL_DOCUMENT_EVENTS_APPEND_ONLY';
END;
$function$;

DROP TRIGGER IF EXISTS trg_kdj_financial_document_events_append_only
    ON public.kdj_financial_document_events;
CREATE TRIGGER trg_kdj_financial_document_events_append_only
BEFORE UPDATE OR DELETE ON public.kdj_financial_document_events
FOR EACH ROW EXECUTE FUNCTION public.kdj_guard_financial_document_event_append_only();
REVOKE ALL ON FUNCTION public.kdj_normalize_financial_document_phone(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_guard_financial_document_immutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_guard_financial_document_event_append_only() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_create_financial_document(text, text, uuid, text, uuid, uuid, uuid, integer, timestamptz, jsonb, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_on_registration_financial_document_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_on_departure_financial_document_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_financial_document_mark_rendered(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_financial_document_claim_outbox_batch(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_financial_document_finish_outbox(uuid, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_admin_resend_financial_document(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_admin_reconcile_financial_document_unknown(uuid, text, text, text, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.kdj_normalize_financial_document_phone(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.kdj_create_financial_document(text, text, uuid, text, uuid, uuid, uuid, integer, timestamptz, jsonb, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.kdj_financial_document_mark_rendered(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.kdj_financial_document_claim_outbox_batch(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.kdj_financial_document_finish_outbox(uuid, uuid, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.kdj_admin_resend_financial_document(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.kdj_admin_reconcile_financial_document_unknown(uuid, text, text, text, uuid) TO service_role;

COMMIT;
