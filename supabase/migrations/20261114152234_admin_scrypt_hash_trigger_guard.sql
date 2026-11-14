-- Corrected validator for legacy SHA-256 and the Portal's validated scrypt hash format.
CREATE OR REPLACE FUNCTION public.kdj_admins_before_write_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  password_parts text[];
  is_legacy_sha256 boolean;
  is_valid_scrypt boolean;
BEGIN
  NEW.username := pg_catalog.lower(pg_catalog.btrim(COALESCE(NEW.username, '')));
  IF NEW.username = '' THEN
    RAISE EXCEPTION 'Username Admin wajib diisi' USING ERRCODE = '22023';
  END IF;

  NEW.email := NULLIF(pg_catalog.lower(pg_catalog.btrim(COALESCE(NEW.email, ''))), '');
  NEW.no_wa := NULLIF(pg_catalog.btrim(COALESCE(NEW.no_wa, '')), '');

  IF NEW.password_hash IS NOT NULL AND pg_catalog.btrim(NEW.password_hash) <> '' THEN
    password_parts := pg_catalog.string_to_array(NEW.password_hash, '$');

    is_legacy_sha256 :=
      pg_catalog.array_length(password_parts, 1) = 5
      AND password_parts[1] = 'kdj'
      AND password_parts[2] = 'sha256'
      AND password_parts[3] ~ '^[0-9]+$'
      AND password_parts[4] ~ '^[0-9a-f]{16,64}$'
      AND password_parts[5] ~ '^[0-9a-f]{64}$';

    is_valid_scrypt :=
      pg_catalog.array_length(password_parts, 1) = 7
      AND password_parts[1] = 'kdj'
      AND password_parts[2] = 'scrypt'
      AND password_parts[3] = '131072'
      AND password_parts[4] = '8'
      AND password_parts[5] = '1'
      AND password_parts[6] ~ '^[0-9a-f]{32}$'
      AND password_parts[7] ~ '^[0-9a-f]{128}$';

    IF NOT (COALESCE(is_legacy_sha256, false) OR COALESCE(is_valid_scrypt, false)) THEN
      NEW.password_hash := public.kdj_hash_password(pg_catalog.btrim(NEW.password_hash));
    END IF;
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
