-- KDJ Complete Foundation Schema (Seed 000)
-- Recreates all pre-existing tables, functions, and structures that existed
-- in Staging before git migrations began.
-- Target: Production Supabase project oudjeospzpiwkupfutow (ap-southeast-1)

BEGIN;

-- ============================================================
-- 1. EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 2. ADMINS TABLE (RBAC & multi-role operations)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.admins (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    username text UNIQUE,
    nama text,
    email text UNIQUE,
    password_hash text,
    no_wa text,
    nomor_wa text,
    role text NOT NULL DEFAULT 'admin_konsultan'
        CHECK (role IN ('super_admin', 'admin_konsultan', 'admin_verifikator')),
    is_active boolean NOT NULL DEFAULT true,
    disabled_at timestamptz,
    session_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admins FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.admins TO service_role;

-- Ensure columns exist if table was already created
ALTER TABLE public.admins ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.admins ADD COLUMN IF NOT EXISTS disabled_at timestamptz;
ALTER TABLE public.admins ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 1;
ALTER TABLE public.admins ADD COLUMN IF NOT EXISTS no_wa text;
ALTER TABLE public.admins ADD COLUMN IF NOT EXISTS nomor_wa text;
ALTER TABLE public.admins ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'admin_konsultan';

-- Unique active role index for routing
CREATE UNIQUE INDEX IF NOT EXISTS idx_admins_unique_active_role
    ON public.admins (role) WHERE (is_active = true);

-- ============================================================
-- 3. PENDAFTAR TABLE (Applicant records)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pendaftar (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    no_wa text NOT NULL UNIQUE,
    phone text,
    nama_leads text,
    nama_lengkap text,
    tempat_lahir text,
    tanggal_lahir date,
    jenis_kelamin text CHECK (jenis_kelamin IS NULL OR jenis_kelamin IN ('Laki-laki', 'Perempuan')),
    nik text,
    alamat text,
    alamat_lengkap text,
    asal_sekolah text,
    tahun_lulus integer,
    pilihan_kampus text,
    pilihan_jurusan text,
    universitas text,
    jurusan text,
    nama_wali text,
    hubungan_wali text,
    telepon_wali text,
    nomor_kontak_wali text,
    status_pendaftaran text NOT NULL DEFAULT 'Draft'
        CHECK (status_pendaftaran IN ('Draft', 'draft_berkas', 'Submitted', 'Revisi Diajukan', 'Approved', 'Rejected')),
    status_pembayaran text NOT NULL DEFAULT 'Belum Bayar'
        CHECK (status_pembayaran IN ('Belum Bayar', 'Menunggu Verifikasi', 'Lunas', 'Ditolak')),
    bukti_bayar_url text,
    nominal_tagihan bigint,
    catatan_admin text,
    catatan_pembayaran text,
    chat_handler text DEFAULT 'BOT' CHECK (chat_handler IN ('BOT', 'HUMAN')),
    no_paspor text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pendaftar ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pendaftar FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.pendaftar TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.pendaftar TO service_role;

-- Ensure columns exist if table was already created
ALTER TABLE public.pendaftar ADD COLUMN IF NOT EXISTS no_wa text;
ALTER TABLE public.pendaftar ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.pendaftar ADD COLUMN IF NOT EXISTS nama_leads text;
ALTER TABLE public.pendaftar ADD COLUMN IF NOT EXISTS nama_lengkap text;
ALTER TABLE public.pendaftar ADD COLUMN IF NOT EXISTS tempat_lahir text;
ALTER TABLE public.pendaftar ADD COLUMN IF NOT EXISTS tanggal_lahir date;
ALTER TABLE public.pendaftar ADD COLUMN IF NOT EXISTS jenis_kelamin text;
ALTER TABLE public.pendaftar ADD COLUMN IF NOT EXISTS nik text;
ALTER TABLE public.pendaftar ADD COLUMN IF NOT EXISTS alamat text;
ALTER TABLE public.pendaftar ADD COLUMN IF NOT EXISTS alamat_lengkap text;
ALTER TABLE public.pendaftar ADD COLUMN IF NOT EXISTS asal_sekolah text;
ALTER TABLE public.pendaftar ADD COLUMN IF NOT EXISTS tahun_lulus integer;
ALTER TABLE public.pendaftar ADD COLUMN IF NOT EXISTS pilihan_kampus text;
ALTER TABLE public.pendaftar ADD COLUMN IF NOT EXISTS pilihan_jurusan text;
ALTER TABLE public.pendaftar ADD COLUMN IF NOT EXISTS universitas text;
ALTER TABLE public.pendaftar ADD COLUMN IF NOT EXISTS jurusan text;
ALTER TABLE public.pendaftar ADD COLUMN IF NOT EXISTS nama_wali text;
ALTER TABLE public.pendaftar ADD COLUMN IF NOT EXISTS hubungan_wali text;
ALTER TABLE public.pendaftar ADD COLUMN IF NOT EXISTS telepon_wali text;
ALTER TABLE public.pendaftar ADD COLUMN IF NOT EXISTS nomor_kontak_wali text;
ALTER TABLE public.pendaftar ADD COLUMN IF NOT EXISTS status_pendaftaran text NOT NULL DEFAULT 'Draft';
ALTER TABLE public.pendaftar ADD COLUMN IF NOT EXISTS status_pembayaran text NOT NULL DEFAULT 'Belum Bayar';
ALTER TABLE public.pendaftar ADD COLUMN IF NOT EXISTS bukti_bayar_url text;
ALTER TABLE public.pendaftar ADD COLUMN IF NOT EXISTS nominal_tagihan bigint;
ALTER TABLE public.pendaftar ADD COLUMN IF NOT EXISTS catatan_admin text;
ALTER TABLE public.pendaftar ADD COLUMN IF NOT EXISTS catatan_pembayaran text;
ALTER TABLE public.pendaftar ADD COLUMN IF NOT EXISTS chat_handler text DEFAULT 'BOT';
ALTER TABLE public.pendaftar ADD COLUMN IF NOT EXISTS no_paspor text;
ALTER TABLE public.pendaftar ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.pendaftar ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_pendaftar_no_wa ON public.pendaftar (no_wa);
CREATE INDEX IF NOT EXISTS idx_pendaftar_status ON public.pendaftar (status_pendaftaran);

-- ============================================================
-- 4. DOKUMEN_PENDAFTAR TABLE (Applicant document uploads)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.dokumen_pendaftar (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pendaftar_id uuid NOT NULL REFERENCES public.pendaftar(id) ON DELETE CASCADE,
    jenis_dokumen text NOT NULL,
    file_url text NOT NULL,
    status_dokumen text NOT NULL DEFAULT 'Pending'
        CHECK (status_dokumen IN ('Pending', 'Verified', 'Rejected', 'Revisi')),
    status_verifikasi text DEFAULT 'Pending',
    catatan text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dokumen_pendaftar ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.dokumen_pendaftar FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.dokumen_pendaftar TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.dokumen_pendaftar TO service_role;

-- Ensure columns exist if table was already created
ALTER TABLE public.dokumen_pendaftar ADD COLUMN IF NOT EXISTS status_dokumen text NOT NULL DEFAULT 'Pending';
ALTER TABLE public.dokumen_pendaftar ADD COLUMN IF NOT EXISTS status_verifikasi text DEFAULT 'Pending';
ALTER TABLE public.dokumen_pendaftar ADD COLUMN IF NOT EXISTS catatan text;
ALTER TABLE public.dokumen_pendaftar ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_dokumen_pendaftar_pendaftar ON public.dokumen_pendaftar (pendaftar_id);

-- ============================================================
-- 5. JADWAL_KONSULTASI TABLE (Consultation schedules)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.jadwal_konsultasi (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nama_customer text NOT NULL,
    no_wa text NOT NULL,
    nomor_wa text,
    tanggal date,
    jam_mulai time,
    jam_selesai time,
    jadwal_pilihan timestamptz,
    blokir_sampai timestamptz,
    metode text NOT NULL DEFAULT 'Zoom' CHECK (metode IN ('Zoom', 'Offline', 'WhatsApp')),
    topik text,
    status text NOT NULL DEFAULT 'Dijadwalkan'
        CHECK (status IN ('Dijadwalkan', 'Selesai', 'Dibatalkan', 'Tidak Hadir', 'MENUNGGU')),
    catatan text,
    created_by text,
    admin_id uuid REFERENCES public.admins(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.jadwal_konsultasi ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.jadwal_konsultasi FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.jadwal_konsultasi TO service_role;

-- Ensure columns exist if table was already created
ALTER TABLE public.jadwal_konsultasi ADD COLUMN IF NOT EXISTS no_wa text;
ALTER TABLE public.jadwal_konsultasi ADD COLUMN IF NOT EXISTS nomor_wa text;
ALTER TABLE public.jadwal_konsultasi ADD COLUMN IF NOT EXISTS jadwal_pilihan timestamptz;
ALTER TABLE public.jadwal_konsultasi ADD COLUMN IF NOT EXISTS blokir_sampai timestamptz;
ALTER TABLE public.jadwal_konsultasi ADD COLUMN IF NOT EXISTS admin_id uuid REFERENCES public.admins(id);
ALTER TABLE public.jadwal_konsultasi ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'Dijadwalkan';

CREATE INDEX IF NOT EXISTS idx_jadwal_konsultasi_no_wa ON public.jadwal_konsultasi (no_wa);

-- ============================================================
-- 6. OTP_AUTH TABLE (Phone OTP authentication)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.otp_auth (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    no_wa text NOT NULL,
    kode_otp text NOT NULL,
    expires_at timestamptz NOT NULL,
    is_used boolean NOT NULL DEFAULT false,
    attempts integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.otp_auth ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.otp_auth FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.otp_auth TO service_role;

CREATE INDEX IF NOT EXISTS idx_otp_auth_no_wa ON public.otp_auth (no_wa, expires_at DESC);

-- ============================================================
-- 7. BOOKING_NOTIFICATION_OUTBOX TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.booking_notification_outbox (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id uuid REFERENCES public.jadwal_konsultasi(id) ON DELETE CASCADE,
    phone_local text NOT NULL,
    event_type text NOT NULL,
    status text NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'UNKNOWN')),
    provider_message_id text,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    attempt_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.booking_notification_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.booking_notification_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.booking_notification_outbox TO service_role;

-- ============================================================
-- 8. PREREQUISITE FUNCTIONS
-- ============================================================
CREATE OR REPLACE FUNCTION public.kdj_create_booking(
    p_customer_name text,
    p_customer_phone text,
    p_topic text,
    p_booking_time timestamptz,
    p_method text DEFAULT 'Zoom'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_booking_id uuid;
BEGIN
    INSERT INTO public.jadwal_konsultasi (
        nama_customer, no_wa, topik, jadwal_pilihan, metode, status
    ) VALUES (
        p_customer_name, p_customer_phone, p_topic, p_booking_time, p_method, 'Dijadwalkan'
    ) RETURNING id INTO v_booking_id;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'booking_id', v_booking_id,
        'jadwal_pilihan', p_booking_time
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.kdj_find_booking_alternatives(
    p_requested_time timestamptz,
    p_count integer DEFAULT 3,
    p_interval_minutes integer DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    RETURN pg_catalog.jsonb_build_array(
        p_requested_time + interval '1 hour',
        p_requested_time + interval '2 hours',
        p_requested_time + interval '1 day'
    );
END;
$function$;

COMMIT;
