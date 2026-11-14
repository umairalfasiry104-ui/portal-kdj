-- ==============================================================================
-- KDJ DEPARTURE PACKAGES & INSTALLMENT PAYMENT LEDGER
-- ==============================================================================

BEGIN;

-- 1. Master Paket Keberangkatan Resmi
CREATE TABLE IF NOT EXISTS public.kdj_departure_packages (
    id text PRIMARY KEY, -- 'SIAP_KULIAH', 'SIAP_KULIAH_PLUS', 'PLATINUM_SYARIAH', 'PLATINUM_EKONOMI'
    name text NOT NULL,
    base_price_idr integer NOT NULL CHECK (base_price_idr > 0),
    description text NOT NULL,
    includes_ticket_visa boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Seed Paket Resmi jika belum ada
INSERT INTO public.kdj_departure_packages (id, name, base_price_idr, description, includes_ticket_visa)
VALUES
    ('SIAP_KULIAH', 'Paket Siap Kuliah', 18900000, 'Registrasi kampus, penerjemahan & legalisir dokumen, penjemputan bandara Amman, pencarian apartemen, orientasi, seragam, kelas persiapan bahasa & pembinaan. (Belum termasuk tiket pesawat & visa).', false),
    ('SIAP_KULIAH_PLUS', 'Paket Siap Kuliah+', 29900000, 'Seluruh fasilitas Paket Siap Kuliah ditambah Tiket Pesawat One-Way Jakarta–Amman dan Visa Belajar Yordania.', true),
    ('PLATINUM_SYARIAH', 'Paket Platinum (Syariah / Sastra Arab)', 50500000, 'Seluruh fasilitas Paket Siap Kuliah+ ditambah Kursus Bahasa Arab 3 bulan, sewa apartemen 1 bulan pertama, uang pangkal universitas, UKT semester 1, Medical Check-Up, koper 28 inci, dan asuransi kesehatan.', true),
    ('PLATINUM_EKONOMI', 'Paket Platinum (Ekonomi Syariah)', 54500000, 'Seluruh fasilitas Paket Siap Kuliah+ ditambah Kursus Bahasa Arab 3 bulan, sewa apartemen 1 bulan pertama, uang pangkal universitas, UKT semester 1, Medical Check-Up, koper 28 inci, dan asuransi kesehatan.', true)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    base_price_idr = EXCLUDED.base_price_idr,
    description = EXCLUDED.description,
    includes_ticket_visa = EXCLUDED.includes_ticket_visa;

-- 2. Pesanan Paket Keberangkatan Calon Mahasiswa (1 Mahasiswa = 1 Paket Aktif)
CREATE TABLE IF NOT EXISTS public.kdj_departure_orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pendaftar_id uuid NOT NULL UNIQUE REFERENCES public.pendaftar(id) ON DELETE RESTRICT,
    package_id text NOT NULL REFERENCES public.kdj_departure_packages(id) ON DELETE RESTRICT,
    package_name text NOT NULL,
    total_amount_idr integer NOT NULL CHECK (total_amount_idr > 0),
    paid_amount_idr integer NOT NULL DEFAULT 0 CHECK (paid_amount_idr >= 0),
    remaining_amount_idr integer NOT NULL CHECK (remaining_amount_idr >= 0),
    payment_status text NOT NULL DEFAULT 'UNPAID'
        CHECK (payment_status IN ('UNPAID', 'PARTIALLY_PAID', 'PAID')),
    is_locked boolean NOT NULL DEFAULT false, -- Terkunci setelah cicilan pertama approved
    first_paid_at timestamptz,
    fully_paid_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT kdj_departure_order_amounts_check CHECK (paid_amount_idr + remaining_amount_idr = total_amount_idr),
    CONSTRAINT kdj_departure_order_paid_status_check CHECK (
        (payment_status = 'PAID' AND remaining_amount_idr = 0 AND fully_paid_at IS NOT NULL) OR
        (payment_status = 'PARTIALLY_PAID' AND paid_amount_idr > 0 AND remaining_amount_idr > 0) OR
        (payment_status = 'UNPAID' AND paid_amount_idr = 0)
    )
);

CREATE INDEX IF NOT EXISTS idx_kdj_departure_orders_pendaftar
    ON public.kdj_departure_orders(pendaftar_id);

-- 3. Transaksi & Bukti Bayar Cicilan (Installments)
CREATE TABLE IF NOT EXISTS public.kdj_departure_installments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL REFERENCES public.kdj_departure_orders(id) ON DELETE RESTRICT,
    pendaftar_id uuid NOT NULL REFERENCES public.pendaftar(id) ON DELETE RESTRICT,
    installment_no integer NOT NULL CHECK (installment_no > 0),
    amount_idr integer NOT NULL CHECK (amount_idr > 0),
    bank_name text NOT NULL DEFAULT 'BSI',
    bank_account_no text NOT NULL DEFAULT '7169735128',
    bank_account_holder text NOT NULL DEFAULT 'Yayasan Generasi Cerdas Akhlakul Karimah',
    status text NOT NULL DEFAULT 'PENDING_VERIFICATION'
        CHECK (status IN ('PENDING_VERIFICATION', 'VERIFIED', 'REJECTED')),
    object_path text NOT NULL UNIQUE,
    original_filename text NOT NULL,
    mime_type text NOT NULL CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png')),
    size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
    sha256 text,
    submitted_at timestamptz NOT NULL DEFAULT now(),
    verified_by uuid REFERENCES public.admins(id) ON DELETE RESTRICT,
    verified_at timestamptz,
    rejection_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT kdj_departure_installment_verification_consistency CHECK (
        (status = 'PENDING_VERIFICATION' AND verified_by IS NULL AND verified_at IS NULL) OR
        (status IN ('VERIFIED', 'REJECTED') AND verified_by IS NOT NULL AND verified_at IS NOT NULL)
    ),
    CONSTRAINT kdj_departure_installment_unique_step UNIQUE (order_id, installment_no)
);

CREATE INDEX IF NOT EXISTS idx_kdj_departure_installments_order
    ON public.kdj_departure_installments(order_id, installment_no DESC);

CREATE INDEX IF NOT EXISTS idx_kdj_departure_installments_status
    ON public.kdj_departure_installments(status);

-- 4. Audit Events untuk Pelacakan Cicilan Keberangkatan
CREATE TABLE IF NOT EXISTS public.kdj_departure_payment_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL REFERENCES public.kdj_departure_orders(id) ON DELETE RESTRICT,
    installment_id uuid REFERENCES public.kdj_departure_installments(id) ON DELETE RESTRICT,
    pendaftar_id uuid NOT NULL REFERENCES public.pendaftar(id) ON DELETE RESTRICT,
    event_type text NOT NULL CHECK (event_type IN (
        'PACKAGE_SELECTED',
        'INSTALLMENT_SUBMITTED',
        'INSTALLMENT_VERIFIED',
        'INSTALLMENT_REJECTED',
        'PACKAGE_FULLY_PAID'
    )),
    amount_idr integer,
    previous_paid_amount_idr integer,
    new_paid_amount_idr integer,
    remaining_amount_idr integer,
    actor_type text NOT NULL CHECK (actor_type IN ('STUDENT', 'ADMIN', 'SYSTEM')),
    actor_admin_id uuid REFERENCES public.admins(id) ON DELETE RESTRICT,
    note text,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS: Batasi akses publik, semua akses mutasi melalui server/service_role
ALTER TABLE public.kdj_departure_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kdj_departure_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kdj_departure_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kdj_departure_payment_events ENABLE ROW LEVEL SECURITY;

-- 5. FUNCTION: Pilih atau Ganti Paket (Hanya jika belum locked / belum ada cicilan verified)
CREATE OR REPLACE FUNCTION public.kdj_select_departure_package(
    p_pendaftar_id uuid,
    p_package_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_pendaftar public.pendaftar%ROWTYPE;
    v_pkg public.kdj_departure_packages%ROWTYPE;
    v_order public.kdj_departure_orders%ROWTYPE;
BEGIN
    SELECT * INTO v_pendaftar
    FROM public.pendaftar
    WHERE id = p_pendaftar_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'PENDAFTAR_NOT_FOUND';
    END IF;

    IF v_pendaftar.status_pendaftaran <> 'Approved' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'APPLICATION_NOT_APPROVED';
    END IF;

    SELECT * INTO v_pkg
    FROM public.kdj_departure_packages
    WHERE id = p_package_id AND is_active IS TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PACKAGE_NOT_FOUND_OR_INACTIVE';
    END IF;

    SELECT * INTO v_order
    FROM public.kdj_departure_orders
    WHERE pendaftar_id = p_pendaftar_id
    FOR UPDATE;

    IF FOUND THEN
        IF v_order.is_locked IS TRUE OR v_order.paid_amount_idr > 0 THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PACKAGE_ALREADY_LOCKED_CANNOT_CHANGE';
        END IF;

        UPDATE public.kdj_departure_orders
        SET package_id = v_pkg.id,
            package_name = v_pkg.name,
            total_amount_idr = v_pkg.base_price_idr,
            remaining_amount_idr = v_pkg.base_price_idr,
            updated_at = pg_catalog.now()
        WHERE id = v_order.id
        RETURNING * INTO v_order;
    ELSE
        INSERT INTO public.kdj_departure_orders (
            pendaftar_id,
            package_id,
            package_name,
            total_amount_idr,
            paid_amount_idr,
            remaining_amount_idr,
            payment_status,
            is_locked
        )
        VALUES (
            p_pendaftar_id,
            v_pkg.id,
            v_pkg.name,
            v_pkg.base_price_idr,
            0,
            v_pkg.base_price_idr,
            'UNPAID',
            false
        )
        RETURNING * INTO v_order;
    END IF;

    INSERT INTO public.kdj_departure_payment_events (
        order_id, pendaftar_id, event_type, amount_idr,
        previous_paid_amount_idr, new_paid_amount_idr, remaining_amount_idr,
        actor_type, note
    )
    VALUES (
        v_order.id, p_pendaftar_id, 'PACKAGE_SELECTED', v_order.total_amount_idr,
        0, 0, v_order.remaining_amount_idr,
        'STUDENT', 'pendaftar memilih ' || v_pkg.name
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'order', pg_catalog.to_jsonb(v_order)
    );
END;
$function$;

-- 6. FUNCTION: Catat Pengajuan Bukti Bayar Cicilan oleh pendaftar
CREATE OR REPLACE FUNCTION public.kdj_submit_departure_installment(
    p_pendaftar_id uuid,
    p_amount_idr integer,
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
    v_order public.kdj_departure_orders%ROWTYPE;
    v_has_pending boolean;
    v_next_no integer;
    v_inst public.kdj_departure_installments%ROWTYPE;
BEGIN
    IF p_amount_idr IS NULL OR p_amount_idr <= 0 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_INSTALLMENT_AMOUNT';
    END IF;

    SELECT * INTO v_order
    FROM public.kdj_departure_orders
    WHERE pendaftar_id = p_pendaftar_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'DEPARTURE_ORDER_NOT_FOUND';
    END IF;

    IF v_order.payment_status = 'PAID' OR v_order.remaining_amount_idr <= 0 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ORDER_ALREADY_FULLY_PAID';
    END IF;

    IF p_amount_idr > v_order.remaining_amount_idr THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INSTALLMENT_EXCEEDS_REMAINING_AMOUNT';
    END IF;

    -- Batasi: Hanya boleh ada 1 bukti cicilan berstatus PENDING_VERIFICATION
    SELECT EXISTS (
        SELECT 1 FROM public.kdj_departure_installments
        WHERE order_id = v_order.id AND status = 'PENDING_VERIFICATION'
    ) INTO v_has_pending;

    IF v_has_pending IS TRUE THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'HAS_PENDING_INSTALLMENT_UNDER_REVIEW';
    END IF;

    SELECT COALESCE(MAX(installment_no), 0) + 1
    INTO v_next_no
    FROM public.kdj_departure_installments
    WHERE order_id = v_order.id;

    INSERT INTO public.kdj_departure_installments (
        order_id, pendaftar_id, installment_no, amount_idr,
        object_path, original_filename, mime_type, size_bytes, sha256,
        status, submitted_at
    )
    VALUES (
        v_order.id, p_pendaftar_id, v_next_no, p_amount_idr,
        p_object_path, p_original_filename, p_mime_type, p_size_bytes, p_sha256,
        'PENDING_VERIFICATION', pg_catalog.now()
    )
    RETURNING * INTO v_inst;

    INSERT INTO public.kdj_departure_payment_events (
        order_id, installment_id, pendaftar_id, event_type,
        amount_idr, previous_paid_amount_idr, new_paid_amount_idr, remaining_amount_idr,
        actor_type, note
    )
    VALUES (
        v_order.id, v_inst.id, p_pendaftar_id, 'INSTALLMENT_SUBMITTED',
        p_amount_idr, v_order.paid_amount_idr, v_order.paid_amount_idr, v_order.remaining_amount_idr,
        'STUDENT', 'Pengajuan cicilan ke-' || v_next_no || ' sebesar Rp ' || p_amount_idr
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'installment', pg_catalog.to_jsonb(v_inst),
        'order', pg_catalog.to_jsonb(v_order)
    );
END;
$function$;

-- 7. FUNCTION: Verifikasi Bukti Bayar Cicilan oleh Admin (Super Admin & Admin Verifikator)
CREATE OR REPLACE FUNCTION public.kdj_admin_review_departure_installment(
    p_installment_id uuid,
    p_action text, -- 'APPROVE' or 'REJECT'
    p_actor_admin_id uuid,
    p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_admin public.admins%ROWTYPE;
    v_inst public.kdj_departure_installments%ROWTYPE;
    v_order public.kdj_departure_orders%ROWTYPE;
    v_pendaftar public.pendaftar%ROWTYPE;
    v_now timestamptz := pg_catalog.now();
    v_new_paid integer;
    v_new_remaining integer;
    v_new_status text;
BEGIN
    IF p_installment_id IS NULL OR p_action NOT IN ('APPROVE', 'REJECT') OR p_actor_admin_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_REVIEW_PARAMETERS';
    END IF;

    IF p_action = 'REJECT' AND (p_reason IS NULL OR pg_catalog.length(pg_catalog.trim(p_reason)) < 3) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'REJECTION_REASON_REQUIRED';
    END IF;

    -- Validasi Peran Admin (Super Admin ATAU Admin Verifikator)
    SELECT * INTO v_admin
    FROM public.admins
    WHERE id = p_actor_admin_id
      AND is_active IS TRUE
      AND disabled_at IS NULL
      AND role IN ('Super Admin', 'Admin Verifikator')
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UNAUTHORIZED_ADMIN_ROLE_FOR_DEPARTURE_PAYMENT';
    END IF;

    SELECT * INTO v_inst
    FROM public.kdj_departure_installments
    WHERE id = p_installment_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'INSTALLMENT_NOT_FOUND';
    END IF;

    IF v_inst.status <> 'PENDING_VERIFICATION' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INSTALLMENT_ALREADY_REVIEWED';
    END IF;

    SELECT * INTO v_order
    FROM public.kdj_departure_orders
    WHERE id = v_inst.order_id
    FOR UPDATE;

    SELECT * INTO v_pendaftar
    FROM public.pendaftar
    WHERE id = v_inst.pendaftar_id
    FOR SHARE;

    IF p_action = 'APPROVE' THEN
        v_new_paid := v_order.paid_amount_idr + v_inst.amount_idr;
        v_new_remaining := v_order.total_amount_idr - v_new_paid;

        IF v_new_remaining < 0 THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PAYMENT_EXCEEDS_TOTAL_PACKAGE_AMOUNT';
        END IF;

        IF v_new_remaining = 0 THEN
            v_new_status := 'PAID';
        ELSE
            v_new_status := 'PARTIALLY_PAID';
        END IF;

        -- Update installment
        UPDATE public.kdj_departure_installments
        SET status = 'VERIFIED',
            verified_by = v_admin.id,
            verified_at = v_now,
            updated_at = v_now
        WHERE id = v_inst.id
        RETURNING * INTO v_inst;

        -- Update order & lock package
        UPDATE public.kdj_departure_orders
        SET paid_amount_idr = v_new_paid,
            remaining_amount_idr = v_new_remaining,
            payment_status = v_new_status,
            is_locked = true,
            first_paid_at = COALESCE(first_paid_at, v_now),
            fully_paid_at = CASE WHEN v_new_status = 'PAID' THEN v_now ELSE fully_paid_at END,
            updated_at = v_now
        WHERE id = v_order.id
        RETURNING * INTO v_order;

        INSERT INTO public.kdj_departure_payment_events (
            order_id, installment_id, pendaftar_id, event_type,
            amount_idr, previous_paid_amount_idr, new_paid_amount_idr, remaining_amount_idr,
            actor_type, actor_admin_id, note
        )
        VALUES (
            v_order.id, v_inst.id, v_order.pendaftar_id, 'INSTALLMENT_VERIFIED',
            v_inst.amount_idr, v_order.paid_amount_idr - v_inst.amount_idr, v_new_paid, v_new_remaining,
            'ADMIN', v_admin.id, 'Disetujui oleh ' || v_admin.nama_admin
        );

        IF v_new_status = 'PAID' THEN
            INSERT INTO public.kdj_departure_payment_events (
                order_id, installment_id, pendaftar_id, event_type,
                amount_idr, previous_paid_amount_idr, new_paid_amount_idr, remaining_amount_idr,
                actor_type, actor_admin_id, note
            )
            VALUES (
                v_order.id, v_inst.id, v_order.pendaftar_id, 'PACKAGE_FULLY_PAID',
                0, v_new_paid, v_new_paid, 0,
                'SYSTEM', NULL, 'Paket keberangkatan LUNAS 100%'
            );
        END IF;

    ELSE -- REJECT
        UPDATE public.kdj_departure_installments
        SET status = 'REJECTED',
            verified_by = v_admin.id,
            verified_at = v_now,
            rejection_reason = pg_catalog.trim(p_reason),
            updated_at = v_now
        WHERE id = v_inst.id
        RETURNING * INTO v_inst;

        INSERT INTO public.kdj_departure_payment_events (
            order_id, installment_id, pendaftar_id, event_type,
            amount_idr, previous_paid_amount_idr, new_paid_amount_idr, remaining_amount_idr,
            actor_type, actor_admin_id, note
        )
        VALUES (
            v_order.id, v_inst.id, v_order.pendaftar_id, 'INSTALLMENT_REJECTED',
            v_inst.amount_idr, v_order.paid_amount_idr, v_order.paid_amount_idr, v_order.remaining_amount_idr,
            'ADMIN', v_admin.id, 'Ditolak: ' || pg_catalog.trim(p_reason)
        );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'action', p_action,
        'installment', pg_catalog.to_jsonb(v_inst),
        'order', pg_catalog.to_jsonb(v_order),
        'student', pg_catalog.jsonb_build_object(
            'nama_lengkap', v_pendaftar.nama_lengkap,
            'no_wa', v_pendaftar.no_wa,
            'nama_orang_tua_wali', v_pendaftar.nama_orang_tua_wali,
            'no_wa_orang_tua_wali', v_pendaftar.no_wa_orang_tua_wali
        )
    );
END;
$function$;

-- REVOKE / GRANT
REVOKE ALL ON TABLE public.kdj_departure_packages FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.kdj_departure_orders FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.kdj_departure_installments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.kdj_departure_payment_events FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.kdj_departure_packages TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.kdj_departure_orders TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.kdj_departure_installments TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.kdj_departure_payment_events TO service_role;

REVOKE ALL ON FUNCTION public.kdj_select_departure_package(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_submit_departure_installment(uuid, integer, text, text, text, bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_admin_review_departure_installment(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.kdj_select_departure_package(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.kdj_submit_departure_installment(uuid, integer, text, text, text, bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.kdj_admin_review_departure_installment(uuid, text, uuid, text) TO service_role;

COMMIT;
