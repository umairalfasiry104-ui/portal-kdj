-- KDJ applicant parent/guardian contact fields
-- Additive schema change. Both fields are optional; no historical data backfill.
BEGIN;

ALTER TABLE public.pendaftar
  ADD COLUMN nama_orang_tua_wali varchar(150),
  ADD COLUMN no_wa_orang_tua_wali varchar(20);

ALTER TABLE public.pendaftar
  ADD CONSTRAINT pendaftar_parent_guardian_wa_local_check
  CHECK (
    no_wa_orang_tua_wali IS NULL
    OR no_wa_orang_tua_wali ~ '^08[0-9]{8,13}$'
  );

COMMENT ON COLUMN public.pendaftar.nama_orang_tua_wali IS
  'Optional name of the applicant parent or guardian; applicant-provided.';
COMMENT ON COLUMN public.pendaftar.no_wa_orang_tua_wali IS
  'Optional parent/guardian WhatsApp number normalized to Indonesian local 08xxxxxxxxxx format; applicant-provided.';

COMMIT;
