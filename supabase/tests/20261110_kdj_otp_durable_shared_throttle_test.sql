-- Transactional tests for 20261110123155_otp_durable_shared_throttle.sql
-- Transactional regression for migration 20261110123155.
-- Uses synthetic phone numbers and HMAC key hashes; rolls back all test rows.
BEGIN;
DO $test$
DECLARE
  v_phone text := '08' || pg_catalog.lpad((pg_catalog.floor(pg_catalog.random() * 10000000000))::bigint::text, 10, '0');
  v_phone_lock text := '08' || pg_catalog.lpad((pg_catalog.floor(pg_catalog.random() * 10000000000))::bigint::text, 10, '0');
  v_phone_success text := '08' || pg_catalog.lpad((pg_catalog.floor(pg_catalog.random() * 10000000000))::bigint::text, 10, '0');
  v_key_request text := pg_catalog.repeat('a',64);
  v_key_lock text := pg_catalog.repeat('b',64);
  v_key_success text := pg_catalog.repeat('c',64);
  v_result jsonb;
  v_first_otp_id uuid;
  v_first_otp_used boolean;
  v_i integer;
BEGIN
  -- OTP request: first issue succeeds; immediate second issue must be cooled down.
  v_result := public.kdj_otp_request_atomic(
    v_phone,'111111',now()+interval '5 minutes',v_key_request
  );
  IF (v_result->>'allowed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'OTP request first issue did not pass: %',v_result;
  END IF;
  v_first_otp_id := (v_result->>'otp_id')::uuid;

  v_result := public.kdj_otp_request_atomic(
    v_phone,'222222',now()+interval '5 minutes',v_key_request
  );
  IF v_result->>'reason' <> 'COOLDOWN' OR (v_result->>'retry_after_sec')::integer < 1 THEN
    RAISE EXCEPTION 'OTP cooldown was not enforced: %',v_result;
  END IF;

  -- Simulate elapsed cooldown while keeping this test fast, then confirm 4/10m quota.
  UPDATE public.kdj_auth_throttle_state
  SET last_otp_requested_at=now()-interval '61 seconds'
  WHERE key_hash=v_key_request;

  FOR v_i IN 2..4 LOOP
    v_result := public.kdj_otp_request_atomic(
      v_phone,'22222' || v_i::text,now()+interval '5 minutes',v_key_request
    );
    IF (v_result->>'allowed')::boolean IS NOT TRUE THEN
      RAISE EXCEPTION 'OTP request % should be allowed: %',v_i,v_result;
    END IF;
    IF v_i = 2 THEN
      SELECT is_used INTO v_first_otp_used
      FROM public.otp_auth
      WHERE id = v_first_otp_id;
      IF v_first_otp_used IS NOT TRUE THEN
        RAISE EXCEPTION 'A newly issued OTP did not invalidate the previous active OTP.';
      END IF;
    END IF;
    UPDATE public.kdj_auth_throttle_state
    SET last_otp_requested_at=now()-interval '61 seconds'
    WHERE key_hash=v_key_request;
  END LOOP;

  v_result := public.kdj_otp_request_atomic(
    v_phone,'555555',now()+interval '5 minutes',v_key_request
  );
  IF v_result->>'reason' <> 'RATE_LIMITED' THEN
    RAISE EXCEPTION 'OTP 4/10m quota was not enforced: %',v_result;
  END IF;

  -- Five wrong OTP attempts create a durable 10-minute lockout.
  v_result := public.kdj_otp_request_atomic(
    v_phone_lock,'654321',now()+interval '5 minutes',v_key_lock
  );
  IF (v_result->>'allowed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Lockout test OTP creation failed: %',v_result;
  END IF;

  FOR v_i IN 1..5 LOOP
    v_result := public.kdj_otp_verify_atomic(
      v_phone_lock,'000000',v_key_lock,5,600
    );
    IF v_i < 5 AND (v_result->>'status')::integer <> 400 THEN
      RAISE EXCEPTION 'OTP wrong-attempt % unexpected result: %',v_i,v_result;
    END IF;
  END LOOP;

  IF (v_result->>'status')::integer <> 429 THEN
    RAISE EXCEPTION 'Fifth wrong OTP attempt did not lock: %',v_result;
  END IF;

  v_result := public.kdj_otp_verify_atomic(
    v_phone_lock,'654321',v_key_lock,5,600
  );
  IF (v_result->>'status')::integer <> 429 THEN
    RAISE EXCEPTION 'OTP lockout did not block a subsequent correct code: %',v_result;
  END IF;

  -- A successful OTP is consumed once and clears the durable failure state.
  v_result := public.kdj_otp_request_atomic(
    v_phone_success,'123456',now()+interval '5 minutes',v_key_success
  );
  IF (v_result->>'allowed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Success test OTP creation failed: %',v_result;
  END IF;

  v_result := public.kdj_otp_verify_atomic(
    v_phone_success,'123456',v_key_success,5,600
  );
  IF (v_result->>'valid')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Correct OTP did not verify: %',v_result;
  END IF;

  v_result := public.kdj_otp_verify_atomic(
    v_phone_success,'123456',v_key_success,5,600
  );
  IF (v_result->>'status')::integer <> 400 THEN
    RAISE EXCEPTION 'OTP replay was not rejected: %',v_result;
  END IF;

  -- Generic fixed-window IP limiter used by Admin login.
  v_result := public.kdj_auth_rate_limit_consume(pg_catalog.repeat('d',64),1,600);
  IF (v_result->>'allowed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'First shared rate-limiter call should pass: %',v_result;
  END IF;
  v_result := public.kdj_auth_rate_limit_consume(pg_catalog.repeat('d',64),1,600);
  IF (v_result->>'allowed')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'Shared rate-limiter quota was not enforced: %',v_result;
  END IF;

  -- Durable Admin account lockout and clear.
  FOR v_i IN 1..5 LOOP
    v_result := public.kdj_auth_lock_record_failure(pg_catalog.repeat('e',64),5,600);
  END LOOP;
  IF (v_result->>'locked')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Admin account did not lock after five failures: %',v_result;
  END IF;
  v_result := public.kdj_auth_lock_check(pg_catalog.repeat('e',64));
  IF (v_result->>'locked')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Admin lock check did not see durable lock: %',v_result;
  END IF;
  PERFORM public.kdj_auth_lock_clear(pg_catalog.repeat('e',64));
  v_result := public.kdj_auth_lock_check(pg_catalog.repeat('e',64));
  IF (v_result->>'locked')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'Admin lock clear failed: %',v_result;
  END IF;

  RAISE NOTICE 'PASS: OTP cooldown, request quota, durable failed-attempt lockout, atomic consume/replay, shared Admin IP limiter, and Admin account lock/clear.';
END;
$test$;
ROLLBACK;
