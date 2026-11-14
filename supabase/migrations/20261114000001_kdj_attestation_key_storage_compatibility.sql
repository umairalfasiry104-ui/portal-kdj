-- Forward compatibility repair for private HMAC key custody.
-- Existing project state uses hmac_secret (hex text); RT04/Admin verifier
-- migrations expect key_bytes (bytea). Retain the original value, derive the
-- binary representation once, and keep both columns synchronized on bootstrap.

BEGIN;

ALTER TABLE private.kdj_admin_booking_attestation_keys
  ADD COLUMN IF NOT EXISTS key_bytes bytea;

UPDATE private.kdj_admin_booking_attestation_keys
SET key_bytes = pg_catalog.decode(hmac_secret, 'hex')
WHERE key_bytes IS NULL
  AND hmac_secret ~ '^[a-fA-F0-9]+$'
  AND pg_catalog.length(hmac_secret) BETWEEN 64 AND 512
  AND pg_catalog.length(hmac_secret) % 2 = 0;

ALTER TABLE private.kdj_admin_booking_attestation_keys
  ALTER COLUMN key_bytes SET NOT NULL;

ALTER TABLE private.kdj_bot_attestation_keys
  ADD COLUMN IF NOT EXISTS key_bytes bytea;

ALTER TABLE private.kdj_bot_attestation_keys
  ADD COLUMN IF NOT EXISTS valid_from timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp();

ALTER TABLE private.kdj_bot_attestation_keys
  ADD COLUMN IF NOT EXISTS valid_until timestamptz;

UPDATE private.kdj_bot_attestation_keys
SET key_bytes = pg_catalog.decode(hmac_secret, 'hex')
WHERE key_bytes IS NULL
  AND hmac_secret ~ '^[a-fA-F0-9]+$'
  AND pg_catalog.length(hmac_secret) BETWEEN 64 AND 512
  AND pg_catalog.length(hmac_secret) % 2 = 0;

ALTER TABLE private.kdj_bot_attestation_keys
  ALTER COLUMN key_bytes SET NOT NULL;

DO $verify_key_material$
BEGIN
  IF EXISTS (
    SELECT 1 FROM private.kdj_admin_booking_attestation_keys
    WHERE pg_catalog.octet_length(key_bytes) < 32
       OR key_bytes IS DISTINCT FROM pg_catalog.decode(hmac_secret, 'hex')
  ) THEN
    RAISE EXCEPTION 'ADMIN_HMAC_KEY_STORAGE_ALIGNMENT_FAILED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM private.kdj_bot_attestation_keys
    WHERE pg_catalog.octet_length(key_bytes) < 32
       OR key_bytes IS DISTINCT FROM pg_catalog.decode(hmac_secret, 'hex')
       OR valid_from IS NULL
       OR (valid_until IS NOT NULL AND valid_until <= valid_from)
  ) THEN
    RAISE EXCEPTION 'BOT_HMAC_KEY_STORAGE_ALIGNMENT_FAILED';
  END IF;
END;
$verify_key_material$;

CREATE OR REPLACE FUNCTION public.kdj_bootstrap_admin_booking_attestation_key(
  p_key_id text,
  p_secret_hex text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_existing_key bytea;
  v_new_key bytea;
BEGIN
  IF p_key_id IS NULL
     OR p_key_id !~ '^[A-Za-z0-9._-]{1,80}$'
     OR p_secret_hex IS NULL
     OR p_secret_hex !~ '^[a-fA-F0-9]+$'
     OR pg_catalog.length(p_secret_hex) < 64
     OR pg_catalog.length(p_secret_hex) > 512
     OR pg_catalog.length(p_secret_hex) % 2 <> 0 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'INVALID_KEY_MATERIAL');
  END IF;

  v_new_key := pg_catalog.decode(p_secret_hex, 'hex');
  PERFORM pg_catalog.pg_advisory_xact_lock(82026, 4101);

  SELECT key_bytes INTO v_existing_key
  FROM private.kdj_admin_booking_attestation_keys
  WHERE key_id = p_key_id;

  IF FOUND THEN
    IF v_existing_key = v_new_key THEN
      RETURN pg_catalog.jsonb_build_object('ok', true, 'code', 'KEY_ALREADY_MATCHES');
    END IF;
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'KEY_ALREADY_PROVISIONED');
  END IF;

  IF EXISTS (SELECT 1 FROM private.kdj_admin_booking_attestation_keys) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'BOOTSTRAP_ALREADY_COMPLETED');
  END IF;

  INSERT INTO private.kdj_admin_booking_attestation_keys (
    key_id, hmac_secret, key_bytes, status
  )
  VALUES (
    p_key_id, pg_catalog.lower(p_secret_hex), v_new_key, 'ACTIVE'
  );

  RETURN pg_catalog.jsonb_build_object('ok', true, 'code', 'KEY_PROVISIONED');
EXCEPTION
  WHEN unique_violation THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'BOOTSTRAP_ALREADY_COMPLETED');
END;
$function$;

CREATE OR REPLACE FUNCTION public.kdj_bootstrap_rt04_bot_attestation_key(
  p_key_id text,
  p_secret_hex text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_existing_key bytea;
  v_new_key bytea;
BEGIN
  IF p_key_id IS NULL
     OR p_key_id !~ '^[A-Za-z0-9._-]{1,80}$'
     OR p_secret_hex IS NULL
     OR p_secret_hex !~ '^[a-fA-F0-9]+$'
     OR pg_catalog.length(p_secret_hex) < 64
     OR pg_catalog.length(p_secret_hex) > 512
     OR pg_catalog.length(p_secret_hex) % 2 <> 0 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'INVALID_KEY_MATERIAL');
  END IF;

  v_new_key := pg_catalog.decode(p_secret_hex, 'hex');
  PERFORM pg_catalog.pg_advisory_xact_lock(82026, 4102);

  SELECT key_bytes INTO v_existing_key
  FROM private.kdj_bot_attestation_keys
  WHERE key_id = p_key_id;

  IF FOUND THEN
    IF v_existing_key = v_new_key THEN
      RETURN pg_catalog.jsonb_build_object('ok', true, 'code', 'KEY_ALREADY_MATCHES');
    END IF;
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'KEY_ALREADY_PROVISIONED');
  END IF;

  IF EXISTS (SELECT 1 FROM private.kdj_bot_attestation_keys) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'BOOTSTRAP_ALREADY_COMPLETED');
  END IF;

  INSERT INTO private.kdj_bot_attestation_keys (
    key_id, hmac_secret, key_bytes, status
  )
  VALUES (
    p_key_id, pg_catalog.lower(p_secret_hex), v_new_key, 'ACTIVE'
  );

  RETURN pg_catalog.jsonb_build_object('ok', true, 'code', 'KEY_PROVISIONED');
EXCEPTION
  WHEN unique_violation THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'BOOTSTRAP_ALREADY_COMPLETED');
END;
$function$;

REVOKE ALL ON FUNCTION public.kdj_bootstrap_admin_booking_attestation_key(text,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_bootstrap_rt04_bot_attestation_key(text,text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.kdj_bootstrap_admin_booking_attestation_key(text,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.kdj_bootstrap_rt04_bot_attestation_key(text,text)
  TO service_role;

COMMIT;
