-- Reconcile one pre-existing Bot key shell to the current local Bot runtime key.
-- Safe only before any RT04 nonce or booking approval has been recorded.
-- This never returns or logs HMAC material.

BEGIN;

CREATE TABLE IF NOT EXISTS private.kdj_bot_attestation_key_reconcile_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('REPLACED_UNUSED_KEY')),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
REVOKE ALL ON TABLE private.kdj_bot_attestation_key_reconcile_audit
  FROM PUBLIC, anon, authenticated, service_role;

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

  SELECT key_bytes
    INTO v_existing_key
    FROM private.kdj_bot_attestation_keys
   WHERE key_id = p_key_id
   FOR UPDATE;

  IF FOUND THEN
    IF v_existing_key = v_new_key THEN
      RETURN pg_catalog.jsonb_build_object('ok', true, 'code', 'KEY_ALREADY_MATCHES');
    END IF;

    -- Replacing a key is allowed only before any Bot RT04 use is recorded.
    IF EXISTS (SELECT 1 FROM private.kdj_booking_attestation_nonces)
       OR EXISTS (SELECT 1 FROM private.booking_customer_approvals) THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'KEY_IN_USE_ROTATION_BLOCKED');
    END IF;

    UPDATE private.kdj_bot_attestation_keys
       SET hmac_secret = pg_catalog.lower(p_secret_hex),
           key_bytes = v_new_key,
           status = 'ACTIVE',
           valid_from = pg_catalog.clock_timestamp(),
           valid_until = NULL
     WHERE key_id = p_key_id;

    INSERT INTO private.kdj_bot_attestation_key_reconcile_audit(key_id, action, reason)
    VALUES (p_key_id, 'REPLACED_UNUSED_KEY',
            'Initial clean-project provisioning; old key had no RT04 nonce or approval use.');

    RETURN pg_catalog.jsonb_build_object('ok', true, 'code', 'KEY_REPLACED_UNUSED');
  END IF;

  IF EXISTS (SELECT 1 FROM private.kdj_bot_attestation_keys) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'BOOTSTRAP_ALREADY_COMPLETED');
  END IF;

  INSERT INTO private.kdj_bot_attestation_keys (
    key_id, hmac_secret, key_bytes, status, valid_from, valid_until
  )
  VALUES (
    p_key_id, pg_catalog.lower(p_secret_hex), v_new_key, 'ACTIVE',
    pg_catalog.clock_timestamp(), NULL
  );

  RETURN pg_catalog.jsonb_build_object('ok', true, 'code', 'KEY_PROVISIONED');
EXCEPTION
  WHEN unique_violation THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'BOOTSTRAP_ALREADY_COMPLETED');
END;
$function$;

REVOKE ALL ON FUNCTION public.kdj_bootstrap_rt04_bot_attestation_key(text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kdj_bootstrap_rt04_bot_attestation_key(text,text)
  TO service_role;

COMMIT;
