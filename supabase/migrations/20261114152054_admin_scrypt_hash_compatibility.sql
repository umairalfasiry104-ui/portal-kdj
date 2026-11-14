-- Preserve validated scrypt hashes written by the Portal password manager.
-- The previous trigger wrapped unknown password-hash formats with the legacy
-- SHA-256 helper, which made adaptive scrypt hashes impossible to verify.
CREATE OR REPLACE FUNCTION public.kdj_admins_before_write_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
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
     AND NOT (
       NEW.password_hash ~ '^kdj\\$sha256\\$[0-9]+\\$[0-9a-f]{16,64}\\$[0-9a-f]{64}$'
       OR
       NEW.password_hash ~ '^kdj\\$scrypt\\$131072\\$8\\$1\\$[0-9a-f]{32}\\$[0-9a-f]{128}$'
     ) THEN
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

COMMENT ON FUNCTION public.kdj_admins_before_write_trg() IS
  'Normalizes Admin identity fields, preserves validated KDJ SHA-256 legacy and scrypt password hashes, and revokes stale sessions on credential/role/username changes.';
