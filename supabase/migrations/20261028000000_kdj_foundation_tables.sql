-- KDJ Clean Project Foundation
-- Target: faoxkegwhpcuubtiserj (KDJ Portal, Singapore)
-- Replaces the historical foundation that incorrectly named Production as target.
-- Source of truth: current Portal + WA Bot source contracts.
-- Test data is intentionally not migrated. Admin identity shells are restored
-- from private.kdj_admin_seed_backup; password hashes are deliberately reset.

BEGIN;

-- Remove only application-owned objects from public. Supabase-managed schemas
-- (auth, storage, realtime, extensions, vault, etc.) are not touched.
DO $cleanup$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT e.evtname
    FROM pg_catalog.pg_event_trigger e
    JOIN pg_catalog.pg_proc p ON p.oid = e.evtfoid
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  LOOP
    EXECUTE pg_catalog.format('DROP EVENT TRIGGER IF EXISTS %I', r.evtname);
  END LOOP;

  FOR r IN
    SELECT c.relname, c.relkind
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r','p','v','m','f')
  LOOP
    EXECUTE CASE r.relkind
      WHEN 'v' THEN pg_catalog.format('DROP VIEW IF EXISTS public.%I CASCADE', r.relname)
      WHEN 'm' THEN pg_catalog.format('DROP MATERIALIZED VIEW IF EXISTS public.%I CASCADE', r.relname)
      WHEN 'f' THEN pg_catalog.format('DROP FOREIGN TABLE IF EXISTS public.%I CASCADE', r.relname)
      ELSE pg_catalog.format('DROP TABLE IF EXISTS public.%I CASCADE', r.relname)
    END;
  END LOOP;

  FOR r IN
    SELECT p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid) AS args,
           CASE WHEN p.prokind = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END AS object_kind
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind IN ('f','p')
  LOOP
    EXECUTE pg_catalog.format('DROP %s IF EXISTS public.%I(%s) CASCADE',
      r.object_kind, r.proname, r.args);
  END LOOP;

  FOR r IN
    SELECT t.typname
    FROM pg_catalog.pg_type t
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typtype IN ('e','d')
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.reltype = t.oid)
  LOOP
    EXECUTE pg_catalog.format('DROP TYPE IF EXISTS public.%I CASCADE', r.typname);
  END LOOP;
END;
$cleanup$;

-- Core Admin/RBAC table. Roles match lib/security.js exactly.
CREATE TABLE public.admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  email text UNIQUE,
  password_hash text,
  nama_admin text NOT NULL,
  no_wa text,
  role text NOT NULL DEFAULT 'Admin Konsultan'
    CHECK (role IN ('Super Admin','Admin Verifikator','Admin Konsultan','Admin Viewer')),
  is_active boolean NOT NULL DEFAULT true,
  disabled_at timestamptz,
  disabled_by uuid REFERENCES public.admins(id) ON DELETE SET NULL,
  session_version integer NOT NULL DEFAULT 1 CHECK (session_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX admins_unique_active_role_idx
  ON public.admins(role) WHERE is_active IS TRUE;
CREATE INDEX admins_email_lower_idx ON public.admins (lower(email));
CREATE INDEX admins_username_lower_idx ON public.admins (lower(username));

-- Applicant master record. Parent/guardian fields are added by the dedicated
-- 20261111032449 migration to preserve the approved migration sequence.
CREATE TABLE public.pendaftar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  no_wa text NOT NULL UNIQUE,
  phone text,
  nama_leads text,
  nama_lengkap text,
  tempat_lahir text,
  tanggal_lahir date,
  jenis_kelamin text CHECK (jenis_kelamin IS NULL OR jenis_kelamin IN ('Laki-laki','Perempuan')),
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
  status_pendaftaran text NOT NULL DEFAULT 'Leads Baru',
  status_pembayaran text NOT NULL DEFAULT 'Belum Bayar',
  bukti_bayar_url text,
  nominal_tagihan numeric(14,2) NOT NULL DEFAULT 1500000,
  catatan_admin text,
  catatan_pembayaran text,
  chat_handler text NOT NULL DEFAULT 'BOT' CHECK (chat_handler IN ('BOT','HUMAN')),
  no_paspor text,
  followup_consent boolean NOT NULL DEFAULT false,
  followup_consent_updated_at timestamptz,
  student_progress jsonb NOT NULL DEFAULT '{"progress_status":"TRANSLATION_AND_CAMPUS_REGISTRATION"}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pendaftar_status_idx ON public.pendaftar(status_pendaftaran);
CREATE INDEX pendaftar_created_idx ON public.pendaftar(created_at DESC);

-- Document metadata only. Binary files live in the private Storage bucket.
CREATE TABLE public.dokumen_pendaftar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pendaftar_id uuid NOT NULL REFERENCES public.pendaftar(id) ON DELETE CASCADE,
  jenis_dokumen text NOT NULL,
  file_path text NOT NULL,
  status_dokumen text NOT NULL DEFAULT 'Pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pendaftar_id, jenis_dokumen, file_path)
);
CREATE INDEX dokumen_pendaftar_profile_idx ON public.dokumen_pendaftar(pendaftar_id);

-- Durable OTP records consumed only by server-side atomic RPCs.
CREATE TABLE public.otp_auth (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  no_wa text NOT NULL,
  kode_otp text NOT NULL,
  expires_at timestamptz NOT NULL,
  is_used boolean NOT NULL DEFAULT false,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_auth_phone_expiry_idx ON public.otp_auth(no_wa, expires_at DESC);

-- Scheduling V2 canonical booking table.
CREATE TABLE public.jadwal_konsultasi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nama_leads text NOT NULL,
  no_wa text NOT NULL,
  metode text NOT NULL DEFAULT 'Zoom' CHECK (metode IN ('Zoom','Offline')),
  jadwal_pilihan timestamptz NOT NULL,
  waktu_selesai timestamptz,
  blokir_sampai timestamptz,
  tanggal date,
  jam_mulai time,
  jam_selesai time,
  status text NOT NULL DEFAULT 'Terjadwal' CHECK (status IN ('Terjadwal','Selesai','Batal')),
  topik text,
  catatan text,
  created_by text,
  admin_id uuid REFERENCES public.admins(id) ON DELETE SET NULL,
  idempotency_key text UNIQUE,
  notification_status text,
  notification_sent_at timestamptz,
  notification_error text,
  latest_notification_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jadwal_konsultasi_phone_idx ON public.jadwal_konsultasi(no_wa);
CREATE INDEX jadwal_konsultasi_schedule_idx ON public.jadwal_konsultasi(jadwal_pilihan DESC);
CREATE INDEX jadwal_konsultasi_status_schedule_idx
  ON public.jadwal_konsultasi(status, jadwal_pilihan);

-- Transactional notification queue. UNKNOWN is explicit and never auto-retried.
CREATE TABLE public.booking_notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.jadwal_konsultasi(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN (
    'BOOKING_CREATED','BOOKING_RESCHEDULED','BOOKING_METHOD_UPDATED',
    'BOOKING_CANCELLED','BOOKING_STATUS_UPDATED'
  )),
  recipient_phone text NOT NULL,
  recipient_name text NOT NULL DEFAULT 'Calon Mahasiswa',
  booking_status text,
  previous_jadwal_pilihan timestamptz,
  jadwal_pilihan timestamptz NOT NULL,
  previous_metode text,
  metode text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','PROCESSING','SENT','FAILED','UNKNOWN','SUPERSEDED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  manual_retry_count integer NOT NULL DEFAULT 0 CHECK (manual_retry_count >= 0),
  last_manual_retry_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  claim_token uuid,
  last_error text,
  provider_message_id text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_outbox_queue_idx
  ON public.booking_notification_outbox(status, next_attempt_at, created_at);
CREATE INDEX booking_outbox_booking_idx
  ON public.booking_notification_outbox(booking_id, created_at DESC);

ALTER TABLE public.jadwal_konsultasi
  ADD CONSTRAINT jadwal_latest_notification_fk
  FOREIGN KEY (latest_notification_id)
  REFERENCES public.booking_notification_outbox(id) ON DELETE SET NULL;

-- Bot identity resolution cache (phone <-> WhatsApp c.us/LID chat identity).
CREATE TABLE public.wa_contact_identity_map (
  phone_local text PRIMARY KEY CHECK (phone_local ~ '^08[0-9]{8,13}$'),
  chat_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Legacy audit table retained as an append-only Admin lifecycle ledger.
CREATE TABLE public.admin_lifecycle_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_admin_id uuid,
  actor_admin_id uuid,
  action text NOT NULL,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_lifecycle_audit_target_idx
  ON public.admin_lifecycle_audit(target_admin_id, created_at DESC);

-- Keep existing Admin identity/role records; credentials are intentionally reset.
DO $restore_admins$
BEGIN
  IF pg_catalog.to_regclass('private.kdj_admin_seed_backup') IS NOT NULL THEN
    INSERT INTO public.admins (
      id, username, nama_admin, email, no_wa, role, password_hash,
      is_active, session_version, created_at, updated_at
    )
    SELECT
      id, username, COALESCE(nama_admin, username), email, no_wa, role,
      NULL, COALESCE(is_active, true), GREATEST(COALESCE(session_version,1),1),
      COALESCE(created_at, now()), COALESCE(updated_at, now())
    FROM private.kdj_admin_seed_backup
    WHERE username IS NOT NULL
      AND role IN ('Super Admin','Admin Verifikator','Admin Konsultan','Admin Viewer')
    ON CONFLICT (id) DO NOTHING;
    DROP TABLE private.kdj_admin_seed_backup;
  END IF;
END;
$restore_admins$;

-- Secure password hashing/normalization. A password must be reset after rebuild.
CREATE OR REPLACE FUNCTION public.kdj_hash_password(
  p_plain_password text,
  p_salt text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_salt text;
  v_hash text;
  v_i integer;
BEGIN
  IF p_plain_password IS NULL OR pg_catalog.length(pg_catalog.btrim(p_plain_password)) < 6 THEN
    RAISE EXCEPTION 'Password minimal 6 karakter' USING ERRCODE = '22023';
  END IF;
  v_salt := COALESCE(
    NULLIF(pg_catalog.lower(pg_catalog.btrim(p_salt)), ''),
    pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '')
  );
  v_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(v_salt || ':' || p_plain_password, 'UTF8')),
    'hex'
  );
  FOR v_i IN 1..1000 LOOP
    v_hash := pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(v_hash || ':' || v_salt, 'UTF8')),
      'hex'
    );
  END LOOP;
  RETURN 'kdj$sha256$1000$' || v_salt || '$' || v_hash;
END;
$function$;

REVOKE ALL ON FUNCTION public.kdj_hash_password(text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.kdj_hash_password(text,text) TO postgres;

CREATE OR REPLACE FUNCTION public.kdj_admins_before_write_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  NEW.username := pg_catalog.lower(pg_catalog.btrim(COALESCE(NEW.username, '')));
  IF NEW.username = '' THEN
    RAISE EXCEPTION 'Username Admin wajib diisi' USING ERRCODE = '22023';
  END IF;
  NEW.email := NULLIF(pg_catalog.lower(pg_catalog.btrim(COALESCE(NEW.email, ''))), '');
  NEW.no_wa := NULLIF(pg_catalog.btrim(COALESCE(NEW.no_wa, '')), '');
  IF NEW.password_hash IS NOT NULL
     AND pg_catalog.btrim(NEW.password_hash) <> ''
     AND NEW.password_hash NOT LIKE 'kdj$sha256$%' THEN
    NEW.password_hash := public.kdj_hash_password(pg_catalog.btrim(NEW.password_hash));
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.password_hash IS DISTINCT FROM OLD.password_hash
        OR NEW.role IS DISTINCT FROM OLD.role
        OR NEW.username IS DISTINCT FROM OLD.username)
       AND NEW.session_version = OLD.session_version THEN
      NEW.session_version := OLD.session_version + 1;
    END IF;
  END IF;
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.kdj_admins_before_write_trg() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.kdj_admins_before_write_trg() TO postgres;

CREATE TRIGGER trg_kdj_admins_before_write
BEFORE INSERT OR UPDATE ON public.admins
FOR EACH ROW EXECUTE FUNCTION public.kdj_admins_before_write_trg();

CREATE OR REPLACE FUNCTION public.kdj_set_booking_times()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_local_start timestamp without time zone;
  v_local_now timestamp without time zone;
  v_validate_schedule boolean := false;
  v_method_input_changed boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_method_input_changed :=
      CASE pg_catalog.upper(pg_catalog.btrim(NEW.metode))
        WHEN 'ZOOM' THEN 'Zoom'
        WHEN 'OFFLINE' THEN 'Offline'
        WHEN 'DATANG KE KANTOR' THEN 'Offline'
        ELSE NULL
      END
      IS DISTINCT FROM
      CASE pg_catalog.upper(pg_catalog.btrim(OLD.metode))
        WHEN 'ZOOM' THEN 'Zoom'
        WHEN 'OFFLINE' THEN 'Offline'
        WHEN 'DATANG KE KANTOR' THEN 'Offline'
        ELSE NULL
      END;
  END IF;
  IF NEW.jadwal_pilihan IS NULL THEN
    RAISE EXCEPTION 'jadwal_pilihan is required';
  END IF;
  NEW.metode := CASE pg_catalog.upper(pg_catalog.btrim(NEW.metode))
    WHEN 'ZOOM' THEN 'Zoom'
    WHEN 'OFFLINE' THEN 'Offline'
    WHEN 'DATANG KE KANTOR' THEN 'Offline'
    ELSE NULL
  END;
  IF NEW.metode IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Metode konsultasi harus Zoom atau Offline.';
  END IF;
  IF NEW.status IS NOT NULL AND NEW.status NOT IN ('Terjadwal','Selesai','Batal') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Status booking tidak valid.';
  END IF;
  IF TG_OP = 'INSERT' THEN
    v_validate_schedule := COALESCE(NEW.status,'Terjadwal') = 'Terjadwal';
  ELSE
    v_validate_schedule :=
      COALESCE(NEW.status,'Terjadwal') = 'Terjadwal'
      AND (
        NEW.jadwal_pilihan IS DISTINCT FROM OLD.jadwal_pilihan
        OR NEW.status IS DISTINCT FROM OLD.status
        OR v_method_input_changed
      );
  END IF;
  IF v_validate_schedule THEN
    v_local_start := NEW.jadwal_pilihan AT TIME ZONE 'Asia/Jakarta';
    IF NEW.jadwal_pilihan <= pg_catalog.now() THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='An active appointment must be scheduled in the future.';
    END IF;
    IF TG_OP='INSERT' AND COALESCE(NEW.status,'Terjadwal')='Terjadwal' THEN
      v_local_now := pg_catalog.now() AT TIME ZONE 'Asia/Jakarta';
      IF v_local_start::date <= v_local_now::date THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Booking WhatsApp harus dibuat paling lambat sehari sebelum tanggal konsultasi.';
      END IF;
    END IF;
    IF EXTRACT(isodow FROM v_local_start)::integer NOT BETWEEN 1 AND 5 THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Consultations are only available Monday through Friday.';
    END IF;
    IF v_local_start < (v_local_start::date + TIME '09:00')
       OR v_local_start + INTERVAL '120 minutes' > (v_local_start::date + TIME '17:00') THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Consultations must start between 09:00 and 15:00 WIB.';
    END IF;
  END IF;
  NEW.waktu_selesai := NEW.jadwal_pilihan + INTERVAL '120 minutes';
  NEW.blokir_sampai := NEW.jadwal_pilihan + INTERVAL '150 minutes';
  NEW.tanggal := (NEW.jadwal_pilihan AT TIME ZONE 'Asia/Jakarta')::date;
  NEW.jam_mulai := (NEW.jadwal_pilihan AT TIME ZONE 'Asia/Jakarta')::time;
  NEW.jam_selesai := (NEW.waktu_selesai AT TIME ZONE 'Asia/Jakarta')::time;
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.kdj_set_booking_times() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.kdj_set_booking_times() TO postgres;
CREATE TRIGGER trg_kdj_set_booking_times
BEFORE INSERT OR UPDATE ON public.jadwal_konsultasi
FOR EACH ROW EXECUTE FUNCTION public.kdj_set_booking_times();

-- Private storage bucket used by Portal signed upload/download routes.
INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES ('berkas_kdj','berkas_kdj',false,5242880,ARRAY['application/pdf','image/jpeg','image/png'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['application/pdf','image/jpeg','image/png'];

-- Server-only database access; RLS and GRANTs remain separate controls.
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pendaftar ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dokumen_pendaftar ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otp_auth ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jadwal_konsultasi ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_notification_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_contact_identity_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_lifecycle_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.admins, public.pendaftar, public.dokumen_pendaftar,
  public.otp_auth, public.jadwal_konsultasi, public.booking_notification_outbox,
  public.wa_contact_identity_map, public.admin_lifecycle_audit
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.admins TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pendaftar TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.dokumen_pendaftar TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.otp_auth TO service_role;
GRANT SELECT ON TABLE public.jadwal_konsultasi TO service_role;
GRANT SELECT ON TABLE public.booking_notification_outbox TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.wa_contact_identity_map TO service_role;
GRANT SELECT, INSERT ON TABLE public.admin_lifecycle_audit TO service_role;

-- Function source copied from the current generated SQL source is appended
-- below by the clean-rebuild script; historical Seed-000 definitions are not used.

-- Commit moved to the end after all extracted core RPCs.

CREATE OR REPLACE FUNCTION public.kdj_admin_update_booking(p_booking_id uuid, p_status text DEFAULT NULL::text, p_jadwal_pilihan timestamp with time zone DEFAULT NULL::timestamp with time zone, p_metode text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_current public.jadwal_konsultasi%ROWTYPE;
    v_updated public.jadwal_konsultasi%ROWTYPE;
    v_new_status text;
    v_new_start timestamptz;
    v_new_method text;
    v_current_method_canonical text;
    v_method_to_write text;
    v_local_start timestamp without time zone;
    v_schedule_changed boolean;
    v_method_changed boolean;
    v_status_changed boolean;
    v_notification_id uuid;
    v_event_type text;
BEGIN
    IF p_booking_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'INVALID_BOOKING_ID');
    END IF;

    IF p_status IS NULL AND p_jadwal_pilihan IS NULL AND p_metode IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'NO_CHANGES');
    END IF;

    SELECT *
    INTO v_current
    FROM public.jadwal_konsultasi
    WHERE id = p_booking_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'BOOKING_NOT_FOUND');
    END IF;

    IF p_status IS NOT NULL AND p_status NOT IN ('Terjadwal', 'Selesai', 'Batal') THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'INVALID_STATUS');
    END IF;

    v_new_status := COALESCE(p_status, v_current.status, 'Terjadwal');
    v_new_start := COALESCE(p_jadwal_pilihan, v_current.jadwal_pilihan);

    v_current_method_canonical := CASE pg_catalog.upper(pg_catalog.btrim(v_current.metode))
        WHEN 'ZOOM' THEN 'Zoom'
        WHEN 'OFFLINE' THEN 'Offline'
        WHEN 'DATANG KE KANTOR' THEN 'Offline'
        ELSE NULL
    END;

    IF v_current_method_canonical IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'INVALID_METHOD');
    END IF;

    IF p_metode IS NULL THEN
        v_new_method := v_current_method_canonical;
        v_method_to_write := v_current.metode;
    ELSE
        v_new_method := CASE pg_catalog.upper(pg_catalog.btrim(p_metode))
            WHEN 'ZOOM' THEN 'Zoom'
            WHEN 'OFFLINE' THEN 'Offline'
            WHEN 'DATANG KE KANTOR' THEN 'Offline'
            ELSE NULL
        END;

        IF v_new_method IS NULL THEN
            RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'INVALID_METHOD');
        END IF;

        v_method_to_write := v_new_method;
    END IF;

    v_schedule_changed := v_new_start IS DISTINCT FROM v_current.jadwal_pilihan;
    v_method_changed := v_new_method IS DISTINCT FROM v_current_method_canonical;
    v_status_changed := v_new_status IS DISTINCT FROM v_current.status;

    -- Enforce this inside the locked RPC too; a pre-read Portal check alone
    -- cannot prevent a concurrent cancellation/reschedule race.
    IF (v_schedule_changed OR v_method_changed)
       AND v_new_status <> 'Terjadwal' THEN
        RETURN pg_catalog.jsonb_build_object(
            'ok', false,
            'code', 'INACTIVE_BOOKING_CANNOT_BE_RESCHEDULED',
            'message', 'Hanya booking Terjadwal yang dapat diubah tanggal, jam, atau metodenya.'
        );
    END IF;

    IF v_new_status = 'Terjadwal' THEN
        IF v_new_start <= pg_catalog.now() THEN
            RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'ADMIN_SLOT_MUST_BE_FUTURE', 'message', 'Jadwal aktif harus berada di waktu mendatang.');
        END IF;

        v_local_start := v_new_start AT TIME ZONE 'Asia/Jakarta';

        IF EXTRACT(isodow FROM v_local_start)::integer NOT BETWEEN 1 AND 5 THEN
            RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'CLOSED_DAY', 'message', 'Konsultasi hanya tersedia Senin sampai Jumat.');
        END IF;

        IF v_local_start < (v_local_start::date + TIME '09:00')
           OR v_local_start + INTERVAL '120 minutes' > (v_local_start::date + TIME '17:00') THEN
            RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'OUTSIDE_WORKING_HOURS', 'message', 'Jam konsultasi adalah 09.00Î“Ã‡Ã´17.00 WIB; waktu mulai terakhir 15.00 WIB.');
        END IF;

        IF EXISTS (
            SELECT 1
            FROM public.jadwal_konsultasi AS other_booking
            WHERE other_booking.id <> p_booking_id
              AND COALESCE(other_booking.status, 'Terjadwal') = 'Terjadwal'
              AND pg_catalog.tstzrange(
                    other_booking.jadwal_pilihan,
                    other_booking.blokir_sampai,
                    '[)'
                  )
                  && pg_catalog.tstzrange(
                        v_new_start,
                        v_new_start + INTERVAL '150 minutes',
                        '[)'
                     )
        ) THEN
            RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'SLOT_UNAVAILABLE', 'message', 'Waktu tersebut bertabrakan dengan booking lain.');
        END IF;
    END IF;

    BEGIN
        UPDATE public.jadwal_konsultasi
        SET
            status = v_new_status,
            jadwal_pilihan = v_new_start,
            metode = v_method_to_write,
            notification_status = CASE
                WHEN (v_schedule_changed OR v_method_changed OR v_status_changed) THEN 'PENDING'
                ELSE notification_status
            END,
            notification_sent_at = CASE
                WHEN (v_schedule_changed OR v_method_changed OR v_status_changed) THEN NULL
                ELSE notification_sent_at
            END,
            notification_error = CASE
                WHEN (v_schedule_changed OR v_method_changed OR v_status_changed) THEN NULL
                ELSE notification_error
            END,
            updated_at = pg_catalog.now()
        WHERE id = p_booking_id
        RETURNING * INTO v_updated;
    EXCEPTION
        WHEN exclusion_violation THEN
            RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'SLOT_UNAVAILABLE', 'message', 'Waktu tersebut baru saja diambil booking lain.');
    END;

    IF v_schedule_changed OR v_method_changed OR v_status_changed THEN
        v_event_type := CASE
            WHEN v_new_status = 'Batal' AND v_status_changed THEN 'BOOKING_CANCELLED'
            WHEN v_schedule_changed THEN 'BOOKING_RESCHEDULED'
            WHEN v_method_changed THEN 'BOOKING_METHOD_UPDATED'
            ELSE 'BOOKING_STATUS_UPDATED'
        END;
        v_notification_id := pg_catalog.gen_random_uuid();

        -- If the Bot was offline while several admin changes were made, only
        -- the newest not-yet-claimed snapshot should be sent. Preserve history,
        -- but supersede older PENDING/FAILED events. PROCESSING/UNKNOWN are untouched
        -- because their external send outcome may already be in flight/uncertain.
        UPDATE public.booking_notification_outbox
        SET
            status = 'SUPERSEDED',
            locked_at = NULL,
            claim_token = NULL,
            last_error = 'Superseded by a newer booking change notification event.',
            updated_at = pg_catalog.now()
        WHERE booking_id = p_booking_id
          AND status IN ('PENDING', 'FAILED');

        INSERT INTO public.booking_notification_outbox (
            id,
            booking_id,
            idempotency_key,
            event_type,
            recipient_phone,
            recipient_name,
            booking_status,
            previous_jadwal_pilihan,
            jadwal_pilihan,
            previous_metode,
            metode,
            status
        ) VALUES (
            v_notification_id,
            p_booking_id,
            'booking-change:' || v_notification_id::text,
            v_event_type,
            v_updated.no_wa,
            COALESCE(NULLIF(pg_catalog.btrim(v_updated.nama_leads), ''), 'Calon Mahasiswa'),
            COALESCE(v_updated.status, 'Terjadwal'),
            v_current.jadwal_pilihan,
            v_updated.jadwal_pilihan,
            v_current_method_canonical,
            v_new_method,
            'PENDING'
        );

        UPDATE public.jadwal_konsultasi
        SET latest_notification_id = v_notification_id
        WHERE id = p_booking_id;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'ok', true,
        'code', 'BOOKING_UPDATED',
        'booking_id', p_booking_id,
        'schedule_changed', v_schedule_changed,
        'method_changed', v_method_changed,
        'status_changed', v_status_changed,
        'notification_required', (v_schedule_changed OR v_method_changed OR v_status_changed),
        'notification_event_id', v_notification_id,
        'previous_jadwal_pilihan', v_current.jadwal_pilihan,
        'jadwal_pilihan', v_updated.jadwal_pilihan,
        'waktu_selesai', v_updated.waktu_selesai,
        'blokir_sampai', v_updated.blokir_sampai,
        'previous_metode', v_current_method_canonical,
        'status', COALESCE(v_updated.status, 'Terjadwal'),
        'metode', v_new_method
    );
END;
$function$

;


CREATE OR REPLACE FUNCTION public.kdj_create_booking(p_no_wa text, p_nama_leads text, p_metode text, p_jadwal_pilihan timestamp with time zone, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_no_wa text;
    v_nama text;
    v_metode text;
    v_idempotency_key text;
    v_local_start timestamp without time zone;
    v_local_now timestamp without time zone;
    v_booking_id uuid;
    v_notification_id uuid;
    v_existing public.jadwal_konsultasi%ROWTYPE;
    v_alternatives jsonb := '[]'::jsonb;
BEGIN
    v_no_wa := pg_catalog.btrim(p_no_wa);
    v_nama := pg_catalog.btrim(p_nama_leads);
    v_idempotency_key := pg_catalog.btrim(p_idempotency_key);

    IF v_no_wa IS NULL OR pg_catalog.length(v_no_wa) < 8 OR pg_catalog.length(v_no_wa) > 40 THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'INVALID_PHONE', 'message', 'Nomor WhatsApp tidak valid.');
    END IF;

    IF v_nama IS NULL OR pg_catalog.length(v_nama) < 1 OR pg_catalog.length(v_nama) > 120 THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'INVALID_NAME', 'message', 'Nama wajib diisi.');
    END IF;

    v_metode := CASE pg_catalog.upper(pg_catalog.btrim(p_metode))
        WHEN 'ZOOM' THEN 'Zoom'
        WHEN 'OFFLINE' THEN 'Offline'
        WHEN 'DATANG KE KANTOR' THEN 'Offline'
        ELSE NULL
    END;

    IF v_metode IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'INVALID_METHOD', 'message', 'Metode konsultasi harus Zoom atau Offline.');
    END IF;

    IF p_jadwal_pilihan IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'INVALID_DATETIME', 'message', 'Tanggal dan jam konsultasi wajib diisi.');
    END IF;

    IF v_idempotency_key IS NULL OR pg_catalog.length(v_idempotency_key) < 8 OR pg_catalog.length(v_idempotency_key) > 200 THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'INVALID_IDEMPOTENCY_KEY', 'message', 'Kunci permintaan booking tidak valid.');
    END IF;

    -- Check an existing key before date policy so a legitimate retry of an
    -- already-created booking still returns the original result.
    SELECT *
    INTO v_existing
    FROM public.jadwal_konsultasi
    WHERE idempotency_key = v_idempotency_key;

    IF FOUND THEN
        IF v_existing.no_wa IS DISTINCT FROM v_no_wa
           OR v_existing.nama_leads IS DISTINCT FROM v_nama
           OR v_existing.metode IS DISTINCT FROM v_metode
           OR v_existing.jadwal_pilihan IS DISTINCT FROM p_jadwal_pilihan THEN
            RETURN pg_catalog.jsonb_build_object(
                'ok', false,
                'code', 'IDEMPOTENCY_KEY_REUSED',
                'message', 'Kunci permintaan sudah digunakan untuk data booking yang berbeda.'
            );
        END IF;

        RETURN pg_catalog.jsonb_build_object(
            'ok', true,
            'code', 'IDEMPOTENT_REPLAY',
            'booking_id', v_existing.id,
            'jadwal_pilihan', v_existing.jadwal_pilihan,
            'waktu_selesai', v_existing.waktu_selesai,
            'blokir_sampai', v_existing.blokir_sampai,
            'status', v_existing.status,
            'notification_status', v_existing.notification_status,
            'notification_event_id', v_existing.latest_notification_id,
            'notification_event_status', (
                SELECT o.status
                FROM public.booking_notification_outbox AS o
                WHERE o.id = v_existing.latest_notification_id
            )
        );
    END IF;

    v_local_start := p_jadwal_pilihan AT TIME ZONE 'Asia/Jakarta';
    v_local_now := pg_catalog.now() AT TIME ZONE 'Asia/Jakarta';

    IF v_local_start::date <= v_local_now::date THEN
        RETURN pg_catalog.jsonb_build_object(
            'ok', false,
            'code', 'BOOKING_REQUIRES_PREVIOUS_DAY',
            'message', 'Booking WhatsApp harus dibuat paling lambat sehari sebelum tanggal konsultasi.'
        );
    END IF;

    IF EXTRACT(isodow FROM v_local_start)::integer NOT BETWEEN 1 AND 5 THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'CLOSED_DAY', 'message', 'Konsultasi hanya tersedia Senin sampai Jumat.');
    END IF;

    IF v_local_start < (v_local_start::date + TIME '09:00')
       OR v_local_start + INTERVAL '120 minutes' > (v_local_start::date + TIME '17:00') THEN
        RETURN pg_catalog.jsonb_build_object(
            'ok', false,
            'code', 'OUTSIDE_WORKING_HOURS',
            'message', 'Jam konsultasi adalah 09.00Î“Ã‡Ã´17.00 WIB. Waktu mulai terakhir untuk sesi 120 menit adalah 15.00 WIB.'
        );
    END IF;

    BEGIN
        INSERT INTO public.jadwal_konsultasi (
            no_wa,
            nama_leads,
            metode,
            jadwal_pilihan,
            status,
            idempotency_key,
            notification_status,
            updated_at
        )
        VALUES (
            v_no_wa,
            v_nama,
            v_metode,
            p_jadwal_pilihan,
            'Terjadwal',
            v_idempotency_key,
            'PENDING',
            pg_catalog.now()
        )
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id INTO v_booking_id;

        IF v_booking_id IS NULL THEN
            SELECT *
            INTO v_existing
            FROM public.jadwal_konsultasi
            WHERE idempotency_key = v_idempotency_key;

            IF NOT FOUND THEN
                RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_RETRY_REQUIRED');
            END IF;

            IF v_existing.no_wa IS DISTINCT FROM v_no_wa
               OR v_existing.nama_leads IS DISTINCT FROM v_nama
               OR v_existing.metode IS DISTINCT FROM v_metode
               OR v_existing.jadwal_pilihan IS DISTINCT FROM p_jadwal_pilihan THEN
                RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_KEY_REUSED');
            END IF;

            RETURN pg_catalog.jsonb_build_object(
                'ok', true,
                'code', 'IDEMPOTENT_REPLAY',
                'booking_id', v_existing.id,
                'jadwal_pilihan', v_existing.jadwal_pilihan,
                'waktu_selesai', v_existing.waktu_selesai,
                'blokir_sampai', v_existing.blokir_sampai,
                'status', v_existing.status,
                'notification_status', v_existing.notification_status,
                'notification_event_id', v_existing.latest_notification_id,
                'notification_event_status', (
                    SELECT o.status
                    FROM public.booking_notification_outbox AS o
                    WHERE o.id = v_existing.latest_notification_id
                )
            );
        END IF;

        -- The client confirmation is part of the same DB transaction as
        -- booking creation. A process crash after this function returns cannot
        -- lose the confirmation event; Bot workers will claim it from outbox.
        v_notification_id := pg_catalog.gen_random_uuid();

        INSERT INTO public.booking_notification_outbox (
            id,
            booking_id,
            idempotency_key,
            event_type,
            recipient_phone,
            recipient_name,
            booking_status,
            previous_jadwal_pilihan,
            jadwal_pilihan,
            previous_metode,
            metode,
            status
        ) VALUES (
            v_notification_id,
            v_booking_id,
            'booking-created:' || v_booking_id::text,
            'BOOKING_CREATED',
            v_no_wa,
            v_nama,
            'Terjadwal',
            NULL,
            p_jadwal_pilihan,
            NULL,
            v_metode,
            'PENDING'
        );

        UPDATE public.jadwal_konsultasi
        SET
            latest_notification_id = v_notification_id,
            notification_status = 'PENDING',
            notification_sent_at = NULL,
            notification_error = NULL,
            updated_at = pg_catalog.now()
        WHERE id = v_booking_id;

        RETURN pg_catalog.jsonb_build_object(
            'ok', true,
            'code', 'BOOKING_CREATED',
            'booking_id', v_booking_id,
            'jadwal_pilihan', p_jadwal_pilihan,
            'waktu_selesai', p_jadwal_pilihan + INTERVAL '120 minutes',
            'blokir_sampai', p_jadwal_pilihan + INTERVAL '150 minutes',
            'status', 'Terjadwal',
            'notification_status', 'PENDING',
            'notification_event_id', v_notification_id,
            'notification_event_status', 'PENDING'
        );
    EXCEPTION
        WHEN exclusion_violation THEN
            SELECT COALESCE(
                pg_catalog.jsonb_agg(
                    pg_catalog.jsonb_build_object('jadwal_pilihan', alternatives.jadwal_pilihan)
                    ORDER BY pg_catalog.abs(
                        EXTRACT(epoch FROM (alternatives.jadwal_pilihan - p_jadwal_pilihan))
                    ), alternatives.jadwal_pilihan
                ),
                '[]'::jsonb
            )
            INTO v_alternatives
            FROM public.kdj_find_booking_alternatives(p_jadwal_pilihan, 3, 45) AS alternatives;

            RETURN pg_catalog.jsonb_build_object(
                'ok', false,
                'code', 'SLOT_UNAVAILABLE',
                'message', 'Waktu tersebut sudah terisi. Silakan pilih salah satu waktu alternatif.',
                'alternatives', v_alternatives
            );
    END;
END;
$function$

;


CREATE OR REPLACE FUNCTION public.kdj_claim_booking_notifications(p_limit integer DEFAULT 1, p_lease_seconds integer DEFAULT 120)
 RETURNS TABLE(notification_id uuid, booking_id uuid, event_type text, recipient_phone text, recipient_name text, booking_status text, previous_jadwal_pilihan timestamp with time zone, jadwal_pilihan timestamp with time zone, previous_metode text, metode text, idempotency_key text, attempts integer, claim_token uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    -- p_limit remains in the RPC signature for compatibility, but V6 deliberately
    -- claims exactly one row per invocation so the full lease is available to it.
    v_limit integer := 1;
    v_lease integer := GREATEST(30, LEAST(COALESCE(p_lease_seconds, 120), 600));
BEGIN
    -- Recover expired leases. Booking is locked first, then Outbox is updated.
    -- Only the event still referenced by latest_notification_id may update the
    -- compatibility summary. UNKNOWN is represented as NULL, never FAILED.
    WITH expired AS (
        SELECT o.id, o.booking_id
        FROM public.booking_notification_outbox AS o
        JOIN public.jadwal_konsultasi AS b
          ON b.id = o.booking_id
        WHERE o.status = 'PROCESSING'
          AND o.locked_at < pg_catalog.now() - pg_catalog.make_interval(secs => v_lease)
        ORDER BY o.locked_at, o.id
        FOR UPDATE OF b SKIP LOCKED
    ), marked_unknown AS (
        UPDATE public.booking_notification_outbox AS o
        SET
            status = 'UNKNOWN',
            claim_token = NULL,
            locked_at = NULL,
            last_error = 'UNKNOWN: Lease worker kedaluwarsa; hasil pengiriman WhatsApp belum dapat dipastikan. Periksa chat penerima dan lakukan rekonsiliasi sebelum retry.',
            updated_at = pg_catalog.now()
        FROM expired AS e
        WHERE o.id = e.id
          AND o.booking_id = e.booking_id
          AND o.status = 'PROCESSING'
        RETURNING o.id, o.booking_id
    )
    UPDATE public.jadwal_konsultasi AS b
    SET
        notification_status = NULL,
        notification_sent_at = NULL,
        notification_error = 'UNKNOWN: Lease worker kedaluwarsa; hasil pengiriman WhatsApp belum dapat dipastikan. Periksa chat penerima dan lakukan rekonsiliasi sebelum retry.',
        updated_at = pg_catalog.now()
    FROM marked_unknown AS u
    WHERE b.id = u.booking_id
      AND b.latest_notification_id = u.id;

    RETURN QUERY
    WITH candidates AS (
        SELECT o.id
        FROM public.booking_notification_outbox AS o
        JOIN public.jadwal_konsultasi AS b
          ON b.id = o.booking_id
        WHERE o.status = 'PENDING'
          AND o.next_attempt_at <= pg_catalog.now()
          -- Lock booking first, then outbox, matching admin update/retry/finish.
          -- This prevents two Bot workers from claiming different events for
          -- the same booking while the first claim is still uncommitted.
          AND NOT EXISTS (
              SELECT 1
              FROM public.booking_notification_outbox AS in_flight
              WHERE in_flight.booking_id = o.booking_id
                AND in_flight.status = 'PROCESSING'
          )
        ORDER BY o.created_at, o.id
        FOR UPDATE OF b SKIP LOCKED
        LIMIT v_limit
    ), claimed AS (
        UPDATE public.booking_notification_outbox AS o
        SET
            status = 'PROCESSING',
            attempts = o.attempts + 1,
            locked_at = pg_catalog.now(),
            claim_token = pg_catalog.gen_random_uuid(),
            updated_at = pg_catalog.now()
        FROM candidates AS c
        WHERE o.id = c.id
        RETURNING
            o.id AS notification_id,
            o.booking_id,
            o.event_type,
            o.recipient_phone,
            o.recipient_name,
            o.booking_status,
            o.previous_jadwal_pilihan,
            o.jadwal_pilihan,
            o.previous_metode,
            o.metode,
            o.idempotency_key,
            o.attempts,
            o.claim_token
    )
    SELECT
        c.notification_id,
        c.booking_id,
        c.event_type,
        c.recipient_phone,
        c.recipient_name,
        c.booking_status,
        c.previous_jadwal_pilihan,
        c.jadwal_pilihan,
        c.previous_metode,
        c.metode,
        c.idempotency_key,
        c.attempts,
        c.claim_token
    FROM claimed AS c;
END;
$function$

;


CREATE OR REPLACE FUNCTION public.kdj_finish_booking_notification(p_notification_id uuid, p_claim_token uuid, p_outcome text, p_error text DEFAULT NULL::text, p_provider_message_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_outcome text := pg_catalog.upper(pg_catalog.btrim(p_outcome));
    v_booking_id uuid;
    v_locked_booking_id uuid;
    v_new_status text;
    v_attempts integer;
    v_error text;
BEGIN
    IF p_notification_id IS NULL OR p_claim_token IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'INVALID_CLAIM');
    END IF;
    IF v_outcome IS NULL OR v_outcome NOT IN ('SENT', 'RETRY', 'FAILED', 'UNKNOWN') THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'INVALID_OUTCOME');
    END IF;

    -- Keep a durable, explicit UNKNOWN marker in Outbox and the legacy summary.
    -- For UNKNOWN, preserve the supplied error as detail after the warning.
    v_error := CASE
        WHEN v_outcome = 'SENT' THEN NULL
        WHEN v_outcome = 'UNKNOWN' THEN
            pg_catalog.left(
                'UNKNOWN: Hasil pengiriman WhatsApp belum dapat dipastikan. Periksa chat penerima dan lakukan rekonsiliasi sebelum retry.'
                || CASE
                    WHEN NULLIF(pg_catalog.btrim(COALESCE(p_error, '')), '') IS NOT NULL
                    THEN ' Detail: ' || pg_catalog.btrim(p_error)
                    ELSE ''
                   END,
                2000
            )
        ELSE pg_catalog.left(
            COALESCE(NULLIF(pg_catalog.btrim(COALESCE(p_error, '')), ''), 'Notification processing failed.'),
            2000
        )
    END;

    -- Global lock order: booking first, then outbox. Admin update and manual
    -- retry already follow this order; finish must do the same to avoid cycles.
    SELECT o.booking_id
    INTO v_booking_id
    FROM public.booking_notification_outbox AS o
    WHERE o.id = p_notification_id;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'CLAIM_NOT_FOUND_OR_EXPIRED');
    END IF;

    SELECT b.id
    INTO v_locked_booking_id
    FROM public.jadwal_konsultasi AS b
    WHERE b.id = v_booking_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'BOOKING_NOT_FOUND');
    END IF;

    UPDATE public.booking_notification_outbox AS o
    SET
        status = CASE
            WHEN v_outcome = 'SENT' THEN 'SENT'
            WHEN v_outcome = 'UNKNOWN' THEN 'UNKNOWN'
            WHEN v_outcome = 'FAILED' THEN 'FAILED'
            WHEN o.attempts >= 5 THEN 'FAILED'
            ELSE 'PENDING'
        END,
        next_attempt_at = CASE
            WHEN v_outcome = 'RETRY' AND o.attempts < 5 THEN
                pg_catalog.now() + CASE o.attempts
                    WHEN 1 THEN INTERVAL '1 minute'
                    WHEN 2 THEN INTERVAL '5 minutes'
                    WHEN 3 THEN INTERVAL '15 minutes'
                    WHEN 4 THEN INTERVAL '60 minutes'
                    ELSE INTERVAL '180 minutes'
                END
            ELSE o.next_attempt_at
        END,
        locked_at = NULL,
        claim_token = NULL,
        sent_at = CASE WHEN v_outcome = 'SENT' THEN pg_catalog.now() ELSE o.sent_at END,
        provider_message_id = CASE
            WHEN v_outcome = 'SENT' THEN NULLIF(pg_catalog.left(COALESCE(p_provider_message_id, ''), 500), '')
            ELSE o.provider_message_id
        END,
        last_error = v_error,
        updated_at = pg_catalog.now()
    WHERE o.id = p_notification_id
      AND o.booking_id = v_booking_id
      AND o.status = 'PROCESSING'
      AND o.claim_token = p_claim_token
    RETURNING o.booking_id, o.status, o.attempts
    INTO v_booking_id, v_new_status, v_attempts;

    IF v_booking_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'CLAIM_NOT_FOUND_OR_EXPIRED');
    END IF;

    -- Only the event still referenced by latest_notification_id may update the
    -- compatibility summary. PENDING/PROCESSING stay coarse PENDING; UNKNOWN
    -- becomes NULL plus an explicit warning, never a false definitive FAILED.
    UPDATE public.jadwal_konsultasi AS b
    SET
        notification_status = CASE
            WHEN v_new_status = 'PENDING' THEN 'PENDING'
            WHEN v_new_status IN ('SENT', 'FAILED') THEN v_new_status
            WHEN v_new_status = 'UNKNOWN' THEN NULL
            ELSE b.notification_status
        END,
        notification_sent_at = CASE
            WHEN v_new_status = 'SENT' THEN pg_catalog.now()
            WHEN v_new_status IN ('PENDING', 'FAILED', 'UNKNOWN') THEN NULL
            ELSE b.notification_sent_at
        END,
        notification_error = CASE
            WHEN v_new_status IN ('SENT', 'PENDING') THEN NULL
            ELSE v_error
        END,
        updated_at = pg_catalog.now()
    WHERE b.id = v_booking_id
      AND b.latest_notification_id = p_notification_id;

    RETURN pg_catalog.jsonb_build_object(
        'ok', true,
        'code', 'NOTIFICATION_' || v_new_status,
        'notification_id', p_notification_id,
        'booking_id', v_booking_id,
        'status', v_new_status,
        'attempts', v_attempts
    );
END;
$function$

;


CREATE OR REPLACE FUNCTION public.kdj_retry_booking_notification(p_notification_id uuid, p_confirm_unknown boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_current_status text;
    v_booking_id uuid;
    v_latest_notification_id uuid;
BEGIN
    IF p_notification_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'INVALID_NOTIFICATION_ID');
    END IF;

    -- Keep the lock order consistent with kdj_admin_update_booking:
    -- booking row first, then its outbox event. This serializes retry against
    -- a concurrent newer admin change so an obsolete snapshot cannot be
    -- changed back to PENDING after a newer event was committed.
    SELECT o.booking_id
    INTO v_booking_id
    FROM public.booking_notification_outbox AS o
    WHERE o.id = p_notification_id;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'NOTIFICATION_NOT_FOUND');
    END IF;

    SELECT b.latest_notification_id
    INTO v_latest_notification_id
    FROM public.jadwal_konsultasi AS b
    WHERE b.id = v_booking_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'BOOKING_NOT_FOUND');
    END IF;

    SELECT o.status
    INTO v_current_status
    FROM public.booking_notification_outbox AS o
    WHERE o.id = p_notification_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'NOTIFICATION_NOT_FOUND');
    END IF;

    -- An older uncertain event must never be resent after a newer booking
    -- change has become the current notification snapshot. It may have been
    -- delivered already, and retrying it could send stale schedule details.
    IF v_latest_notification_id IS DISTINCT FROM p_notification_id THEN
        RETURN pg_catalog.jsonb_build_object(
            'ok', false,
            'code', 'NOTIFICATION_SUPERSEDED',
            'message', 'Notifikasi ini sudah digantikan perubahan jadwal yang lebih baru dan tidak boleh dikirim ulang.'
        );
    END IF;

    IF v_current_status = 'UNKNOWN' AND COALESCE(p_confirm_unknown, false) IS NOT TRUE THEN
        RETURN pg_catalog.jsonb_build_object(
            'ok', false,
            'code', 'UNKNOWN_REQUIRES_CONFIRMATION',
            'message', 'Periksa chat WhatsApp penerima terlebih dahulu. Pengiriman sebelumnya mungkin sudah berhasil.'
        );
    END IF;

    IF v_current_status NOT IN ('FAILED', 'UNKNOWN') THEN
        RETURN pg_catalog.jsonb_build_object(
            'ok', false,
            'code', 'NOTIFICATION_NOT_RETRYABLE',
            'status', v_current_status
        );
    END IF;

    UPDATE public.booking_notification_outbox
    SET
        status = 'PENDING',
        attempts = 0,
        manual_retry_count = manual_retry_count + 1,
        last_manual_retry_at = pg_catalog.now(),
        next_attempt_at = pg_catalog.now(),
        locked_at = NULL,
        claim_token = NULL,
        last_error = NULL,
        updated_at = pg_catalog.now()
    WHERE id = p_notification_id;

    UPDATE public.jadwal_konsultasi AS b
    SET
        notification_status = 'PENDING',
        notification_sent_at = NULL,
        notification_error = NULL,
        updated_at = pg_catalog.now()
    WHERE b.id = v_booking_id
      AND b.latest_notification_id = p_notification_id;

    RETURN pg_catalog.jsonb_build_object(
        'ok', true,
        'code', 'NOTIFICATION_REQUEUED',
        'notification_id', p_notification_id,
        'booking_id', v_booking_id,
        'status', 'PENDING'
    );
END;
$function$

;


CREATE OR REPLACE FUNCTION public.kdj_update_booking_notification(p_booking_id uuid, p_notification_status text, p_error text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_status text := pg_catalog.upper(pg_catalog.btrim(p_notification_status));
    v_updated_id uuid;
BEGIN
    IF p_booking_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'INVALID_BOOKING_ID');
    END IF;

    IF v_status IS NULL OR v_status NOT IN ('PENDING', 'SENT', 'FAILED') THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'INVALID_NOTIFICATION_STATUS');
    END IF;

    UPDATE public.jadwal_konsultasi
    SET
        notification_status = v_status,
        notification_sent_at = CASE
            WHEN v_status = 'SENT' THEN pg_catalog.now()
            WHEN v_status = 'PENDING' THEN NULL
            ELSE notification_sent_at
        END,
        notification_error = CASE
            WHEN v_status = 'FAILED' THEN pg_catalog.left(COALESCE(p_error, 'Notification failed'), 2000)
            ELSE NULL
        END,
        updated_at = pg_catalog.now()
    WHERE id = p_booking_id
      AND latest_notification_id IS NULL
    RETURNING id INTO v_updated_id;

    IF v_updated_id IS NULL THEN
        IF EXISTS (SELECT 1 FROM public.jadwal_konsultasi WHERE id = p_booking_id) THEN
            RETURN pg_catalog.jsonb_build_object(
                'ok', true,
                'code', 'LEGACY_NOTIFICATION_SUPERSEDED',
                'message', 'Status booking dikelola oleh outbox event terbaru.'
            );
        END IF;
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'BOOKING_NOT_FOUND');
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'ok', true,
        'code', 'NOTIFICATION_STATUS_UPDATED',
        'booking_id', v_updated_id,
        'notification_status', v_status
    );
END;
$function$

;

REVOKE ALL ON FUNCTION public.kdj_create_booking(text,text,text,timestamp with time zone,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kdj_create_booking(text,text,text,timestamp with time zone,text) TO service_role;
REVOKE ALL ON FUNCTION public.kdj_admin_update_booking(uuid,text,timestamp with time zone,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kdj_admin_update_booking(uuid,text,timestamp with time zone,text) TO service_role;
REVOKE ALL ON FUNCTION public.kdj_claim_booking_notifications(integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kdj_claim_booking_notifications(integer,integer) TO service_role;
REVOKE ALL ON FUNCTION public.kdj_finish_booking_notification(uuid,uuid,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kdj_finish_booking_notification(uuid,uuid,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.kdj_retry_booking_notification(uuid,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kdj_retry_booking_notification(uuid,boolean) TO service_role;
REVOKE ALL ON FUNCTION public.kdj_update_booking_notification(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kdj_update_booking_notification(uuid,text,text) TO service_role;

COMMIT;

