-- KDJ durable OTP and shared authentication throttling
-- Scope: Staging + release candidate. Uses HMAC identifiers; no raw phone/IP stored here.
-- Request policy: 4 OTP requests / 10 minutes + 60-second per-phone cooldown.
-- Verification policy: 5 failed OTP attempts / 10 minutes, then 10-minute lockout.
-- Admin login policy: shared IP limiter + durable account lockout.
BEGIN;

CREATE TABLE IF NOT EXISTS public.kdj_auth_throttle_state (
  key_hash text PRIMARY KEY CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  request_window_started_at timestamptz,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  last_otp_requested_at timestamptz,
  failure_window_started_at timestamptz,
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kdj_auth_throttle_state_updated_at
  ON public.kdj_auth_throttle_state (updated_at ASC);

ALTER TABLE public.kdj_auth_throttle_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.kdj_auth_throttle_state FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE public.kdj_auth_throttle_state IS
  'Server-only durable auth throttling state. key_hash is HMAC-SHA256(scope + identifier); raw phone/IP/username is not stored.';

CREATE OR REPLACE FUNCTION public.kdj_otp_request_atomic(
  p_phone_local text,
  p_otp text,
  p_expires_at timestamptz,
  p_key_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_state public.kdj_auth_throttle_state%ROWTYPE;
  v_candidates text[];
  v_window_started_at timestamptz;
  v_request_count integer;
  v_retry_after integer;
  v_otp_id uuid;
BEGIN
  IF p_phone_local IS NULL OR p_phone_local !~ '^08[0-9]{8,13}$'
     OR p_otp IS NULL OR p_otp !~ '^[0-9]{6}$'
     OR p_key_hash IS NULL OR p_key_hash !~ '^[0-9a-f]{64}$'
     OR p_expires_at IS NULL OR p_expires_at <= now()
     OR p_expires_at > now() + interval '6 minutes'
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_OTP_REQUEST';
  END IF;

  -- A single per-phone lock serializes OTP request and verification RPCs.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('kdj-otp:' || p_phone_local, 0)
  );

  INSERT INTO public.kdj_auth_throttle_state (key_hash)
  VALUES (p_key_hash)
  ON CONFLICT (key_hash) DO NOTHING;

  SELECT * INTO v_state
  FROM public.kdj_auth_throttle_state
  WHERE key_hash = p_key_hash
  FOR UPDATE;

  -- A lockout expires after its fixed duration. A stale failure window is reset too.
  IF (v_state.locked_until IS NOT NULL AND v_state.locked_until <= now())
     OR (v_state.failure_window_started_at IS NOT NULL
         AND v_state.failure_window_started_at <= now() - interval '10 minutes')
  THEN
    UPDATE public.kdj_auth_throttle_state
    SET failure_window_started_at = NULL,
        failure_count = 0,
        locked_until = NULL,
        updated_at = now()
    WHERE key_hash = p_key_hash;

    SELECT * INTO v_state
    FROM public.kdj_auth_throttle_state
    WHERE key_hash = p_key_hash
    FOR UPDATE;
  END IF;

  IF v_state.locked_until IS NOT NULL AND v_state.locked_until > now() THEN
    v_retry_after := GREATEST(
      1,
      pg_catalog.ceil(EXTRACT(epoch FROM (v_state.locked_until - now())))::integer
    );
    RETURN pg_catalog.jsonb_build_object(
      'allowed', false, 'status', 429, 'reason', 'LOCKED',
      'retry_after_sec', v_retry_after
    );
  END IF;

  IF v_state.last_otp_requested_at IS NOT NULL
     AND v_state.last_otp_requested_at > now() - interval '60 seconds'
  THEN
    v_retry_after := GREATEST(
      1,
      pg_catalog.ceil(
        EXTRACT(epoch FROM (v_state.last_otp_requested_at + interval '60 seconds' - now()))
      )::integer
    );
    RETURN pg_catalog.jsonb_build_object(
      'allowed', false, 'status', 429, 'reason', 'COOLDOWN',
      'retry_after_sec', v_retry_after
    );
  END IF;

  IF v_state.request_window_started_at IS NULL
     OR v_state.request_window_started_at <= now() - interval '10 minutes'
  THEN
    v_window_started_at := now();
    v_request_count := 0;
  ELSE
    v_window_started_at := v_state.request_window_started_at;
    v_request_count := v_state.request_count;
  END IF;

  IF v_request_count >= 4 THEN
    v_retry_after := GREATEST(
      1,
      pg_catalog.ceil(
        EXTRACT(epoch FROM (v_window_started_at + interval '10 minutes' - now()))
      )::integer
    );
    RETURN pg_catalog.jsonb_build_object(
      'allowed', false, 'status', 429, 'reason', 'RATE_LIMITED',
      'retry_after_sec', v_retry_after
    );
  END IF;

  UPDATE public.kdj_auth_throttle_state
  SET request_window_started_at = v_window_started_at,
      request_count = v_request_count + 1,
      last_otp_requested_at = now(),
      updated_at = now()
  WHERE key_hash = p_key_hash;

  v_candidates := ARRAY[
    p_phone_local,
    '62' || pg_catalog.substr(p_phone_local, 2),
    '+62' || pg_catalog.substr(p_phone_local, 2)
  ];

  -- Invalidate previous active OTPs and create the new one in the same transaction.
  UPDATE public.otp_auth
  SET is_used = true
  WHERE no_wa = ANY(v_candidates)
    AND is_used = false;

  INSERT INTO public.otp_auth (no_wa, kode_otp, expires_at, is_used)
  VALUES (p_phone_local, p_otp, p_expires_at, false)
  RETURNING id INTO v_otp_id;

  RETURN pg_catalog.jsonb_build_object(
    'allowed', true, 'otp_id', v_otp_id,
    'retry_after_sec', 0
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.kdj_otp_verify_atomic(
  p_phone_local text,
  p_otp text,
  p_key_hash text,
  p_max_failures integer DEFAULT 5,
  p_failure_window_seconds integer DEFAULT 600
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_state public.kdj_auth_throttle_state%ROWTYPE;
  v_target public.otp_auth%ROWTYPE;
  v_candidates text[];
  v_failure_window_started_at timestamptz;
  v_failure_count integer;
  v_locked_until timestamptz;
  v_retry_after integer;
  v_rows integer;
BEGIN
  IF p_phone_local IS NULL OR p_phone_local !~ '^08[0-9]{8,13}$'
     OR p_otp IS NULL OR p_otp !~ '^[0-9]{6}$'
     OR p_key_hash IS NULL OR p_key_hash !~ '^[0-9a-f]{64}$'
     OR p_max_failures IS NULL OR p_max_failures < 1 OR p_max_failures > 20
     OR p_failure_window_seconds IS NULL OR p_failure_window_seconds < 60
     OR p_failure_window_seconds > 3600
  THEN
    RETURN pg_catalog.jsonb_build_object(
      'valid', false, 'status', 400,
      'message', 'Format nomor WhatsApp atau kode OTP tidak valid.'
    );
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('kdj-otp:' || p_phone_local, 0)
  );

  INSERT INTO public.kdj_auth_throttle_state (key_hash)
  VALUES (p_key_hash)
  ON CONFLICT (key_hash) DO NOTHING;

  SELECT * INTO v_state
  FROM public.kdj_auth_throttle_state
  WHERE key_hash = p_key_hash
  FOR UPDATE;

  v_failure_window_started_at := v_state.failure_window_started_at;
  v_failure_count := v_state.failure_count;
  v_locked_until := v_state.locked_until;

  IF (v_locked_until IS NOT NULL AND v_locked_until <= now())
     OR (v_failure_window_started_at IS NOT NULL
         AND v_failure_window_started_at <= now() - pg_catalog.make_interval(secs => p_failure_window_seconds))
  THEN
    v_failure_window_started_at := NULL;
    v_failure_count := 0;
    v_locked_until := NULL;
  END IF;

  IF v_locked_until IS NOT NULL AND v_locked_until > now() THEN
    v_retry_after := GREATEST(
      1,
      pg_catalog.ceil(EXTRACT(epoch FROM (v_locked_until - now())))::integer
    );
    RETURN pg_catalog.jsonb_build_object(
      'valid', false, 'status', 429,
      'message', 'Terlalu banyak percobaan OTP yang salah. Silakan tunggu sebelum mencoba lagi.',
      'retry_after_sec', v_retry_after
    );
  END IF;

  v_candidates := ARRAY[
    p_phone_local,
    '62' || pg_catalog.substr(p_phone_local, 2),
    '+62' || pg_catalog.substr(p_phone_local, 2)
  ];

  SELECT * INTO v_target
  FROM public.otp_auth
  WHERE no_wa = ANY(v_candidates)
    AND is_used = false
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND OR COALESCE(v_target.kode_otp, '') <> p_otp THEN
    IF v_failure_window_started_at IS NULL THEN
      v_failure_window_started_at := now();
      v_failure_count := 0;
    END IF;

    v_failure_count := v_failure_count + 1;

    IF v_failure_count >= p_max_failures THEN
      v_locked_until := now() + pg_catalog.make_interval(secs => p_failure_window_seconds);
    ELSE
      v_locked_until := NULL;
    END IF;

    UPDATE public.kdj_auth_throttle_state
    SET failure_window_started_at = v_failure_window_started_at,
        failure_count = v_failure_count,
        locked_until = v_locked_until,
        updated_at = now()
    WHERE key_hash = p_key_hash;

    IF v_locked_until IS NOT NULL THEN
      UPDATE public.otp_auth
      SET is_used = true
      WHERE no_wa = ANY(v_candidates)
        AND is_used = false;

      RETURN pg_catalog.jsonb_build_object(
        'valid', false, 'status', 429,
        'message', 'Terlalu banyak percobaan OTP yang salah. Silakan tunggu sebelum mencoba lagi.',
        'retry_after_sec', p_failure_window_seconds
      );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'valid', false, 'status', 400,
      'message', 'Kode OTP salah atau telah kedaluwarsa!',
      'remaining_attempts', p_max_failures - v_failure_count
    );
  END IF;

  UPDATE public.otp_auth
  SET is_used = true
  WHERE id = v_target.id
    AND is_used = false
    AND expires_at > now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RETURN pg_catalog.jsonb_build_object(
      'valid', false, 'status', 400,
      'message', 'Kode OTP sudah digunakan atau kedaluwarsa!'
    );
  END IF;

  UPDATE public.otp_auth
  SET is_used = true
  WHERE no_wa = ANY(v_candidates)
    AND is_used = false;

  UPDATE public.kdj_auth_throttle_state
  SET failure_window_started_at = NULL,
      failure_count = 0,
      locked_until = NULL,
      updated_at = now()
  WHERE key_hash = p_key_hash;

  RETURN pg_catalog.jsonb_build_object(
    'valid', true,
    'normalized_phone', p_phone_local
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.kdj_auth_rate_limit_consume(
  p_key_hash text,
  p_max_requests integer,
  p_window_seconds integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_state public.kdj_auth_throttle_state%ROWTYPE;
  v_window_started_at timestamptz;
  v_request_count integer;
  v_retry_after integer;
BEGIN
  IF p_key_hash IS NULL OR p_key_hash !~ '^[0-9a-f]{64}$'
     OR p_max_requests IS NULL OR p_max_requests < 1 OR p_max_requests > 10000
     OR p_window_seconds IS NULL OR p_window_seconds < 1 OR p_window_seconds > 86400
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_AUTH_RATE_LIMIT_ARGUMENT';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('kdj-auth-rate:' || p_key_hash, 0)
  );

  INSERT INTO public.kdj_auth_throttle_state (key_hash)
  VALUES (p_key_hash)
  ON CONFLICT (key_hash) DO NOTHING;

  SELECT * INTO v_state
  FROM public.kdj_auth_throttle_state
  WHERE key_hash = p_key_hash
  FOR UPDATE;

  IF v_state.request_window_started_at IS NULL
     OR v_state.request_window_started_at <= now() - pg_catalog.make_interval(secs => p_window_seconds)
  THEN
    v_window_started_at := now();
    v_request_count := 0;
  ELSE
    v_window_started_at := v_state.request_window_started_at;
    v_request_count := v_state.request_count;
  END IF;

  IF v_request_count >= p_max_requests THEN
    v_retry_after := GREATEST(
      1,
      pg_catalog.ceil(
        EXTRACT(epoch FROM (
          v_window_started_at + pg_catalog.make_interval(secs => p_window_seconds) - now()
        ))
      )::integer
    );
    RETURN pg_catalog.jsonb_build_object(
      'allowed', false, 'retry_after_sec', v_retry_after
    );
  END IF;

  UPDATE public.kdj_auth_throttle_state
  SET request_window_started_at = v_window_started_at,
      request_count = v_request_count + 1,
      updated_at = now()
  WHERE key_hash = p_key_hash;

  -- Bound stale per-IP / per-account state growth without requiring a scheduler.
  DELETE FROM public.kdj_auth_throttle_state
  WHERE key_hash IN (
    SELECT key_hash
    FROM public.kdj_auth_throttle_state
    WHERE updated_at < now() - interval '30 days'
    ORDER BY updated_at ASC
    LIMIT 100
  );

  RETURN pg_catalog.jsonb_build_object(
    'allowed', true, 'retry_after_sec', 0
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.kdj_auth_lock_check(
  p_key_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_locked_until timestamptz;
  v_retry_after integer;
BEGIN
  IF p_key_hash IS NULL OR p_key_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_AUTH_LOCK_KEY';
  END IF;

  SELECT locked_until INTO v_locked_until
  FROM public.kdj_auth_throttle_state
  WHERE key_hash = p_key_hash;

  IF v_locked_until IS NOT NULL AND v_locked_until > now() THEN
    v_retry_after := GREATEST(
      1,
      pg_catalog.ceil(EXTRACT(epoch FROM (v_locked_until - now())))::integer
    );
    RETURN pg_catalog.jsonb_build_object(
      'locked', true, 'retry_after_sec', v_retry_after
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'locked', false, 'retry_after_sec', 0
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.kdj_auth_lock_record_failure(
  p_key_hash text,
  p_max_failures integer,
  p_window_seconds integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_state public.kdj_auth_throttle_state%ROWTYPE;
  v_window_started_at timestamptz;
  v_failure_count integer;
  v_locked_until timestamptz;
  v_retry_after integer;
BEGIN
  IF p_key_hash IS NULL OR p_key_hash !~ '^[0-9a-f]{64}$'
     OR p_max_failures IS NULL OR p_max_failures < 1 OR p_max_failures > 100
     OR p_window_seconds IS NULL OR p_window_seconds < 1 OR p_window_seconds > 86400
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_AUTH_FAILURE_ARGUMENT';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('kdj-auth-failure:' || p_key_hash, 0)
  );

  INSERT INTO public.kdj_auth_throttle_state (key_hash)
  VALUES (p_key_hash)
  ON CONFLICT (key_hash) DO NOTHING;

  SELECT * INTO v_state
  FROM public.kdj_auth_throttle_state
  WHERE key_hash = p_key_hash
  FOR UPDATE;

  IF (v_state.locked_until IS NOT NULL AND v_state.locked_until <= now())
     OR (v_state.failure_window_started_at IS NULL)
     OR (v_state.failure_window_started_at <= now() - pg_catalog.make_interval(secs => p_window_seconds))
  THEN
    v_window_started_at := now();
    v_failure_count := 0;
  ELSE
    v_window_started_at := v_state.failure_window_started_at;
    v_failure_count := v_state.failure_count;
  END IF;

  v_failure_count := v_failure_count + 1;
  IF v_failure_count >= p_max_failures THEN
    v_locked_until := now() + pg_catalog.make_interval(secs => p_window_seconds);
  ELSE
    v_locked_until := NULL;
  END IF;

  UPDATE public.kdj_auth_throttle_state
  SET failure_window_started_at = v_window_started_at,
      failure_count = v_failure_count,
      locked_until = v_locked_until,
      updated_at = now()
  WHERE key_hash = p_key_hash;

  v_retry_after := CASE
    WHEN v_locked_until IS NULL THEN 0
    ELSE GREATEST(
      1,
      pg_catalog.ceil(EXTRACT(epoch FROM (v_locked_until - now())))::integer
    )
  END;

  RETURN pg_catalog.jsonb_build_object(
    'failures', v_failure_count,
    'locked', v_locked_until IS NOT NULL,
    'retry_after_sec', v_retry_after
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.kdj_auth_lock_clear(
  p_key_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_key_hash IS NULL OR p_key_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_AUTH_LOCK_KEY';
  END IF;

  UPDATE public.kdj_auth_throttle_state
  SET failure_window_started_at = NULL,
      failure_count = 0,
      locked_until = NULL,
      updated_at = now()
  WHERE key_hash = p_key_hash;

  RETURN pg_catalog.jsonb_build_object('cleared', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.kdj_otp_request_atomic(text,text,timestamptz,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_otp_verify_atomic(text,text,text,integer,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_auth_rate_limit_consume(text,integer,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_auth_lock_check(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_auth_lock_record_failure(text,integer,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kdj_auth_lock_clear(text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.kdj_otp_request_atomic(text,text,timestamptz,text) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.kdj_otp_verify_atomic(text,text,text,integer,integer) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.kdj_auth_rate_limit_consume(text,integer,integer) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.kdj_auth_lock_check(text) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.kdj_auth_lock_record_failure(text,integer,integer) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.kdj_auth_lock_clear(text) TO postgres, service_role;

COMMENT ON FUNCTION public.kdj_otp_request_atomic(text,text,timestamptz,text) IS
  'Atomically enforces OTP cooldown and request quota, invalidates prior OTPs, and inserts a new OTP.';
COMMENT ON FUNCTION public.kdj_otp_verify_atomic(text,text,text,integer,integer) IS
  'Atomically verifies/consumes an OTP and persists failed-attempt lockout state.';
COMMENT ON FUNCTION public.kdj_auth_rate_limit_consume(text,integer,integer) IS
  'Shared database-backed fixed-window rate limiter for server authentication endpoints.';

COMMIT;
