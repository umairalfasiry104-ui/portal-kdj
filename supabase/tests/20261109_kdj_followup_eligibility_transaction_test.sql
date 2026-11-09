-- Transactional integration test. Run only on LOCAL RESTORE or STAGING.
-- All inserted rows are rolled back. No WhatsApp dispatch is invoked.
BEGIN;
DO $$
DECLARE
  v_phone text := '08' || pg_catalog.lpad(pg_catalog.floor(pg_catalog.random()*10000000000)::bigint::text,10,'0');
  v_phone_registered text := '08' || pg_catalog.lpad(pg_catalog.floor(pg_catalog.random()*10000000000)::bigint::text,10,'0');
  v_admin uuid;
  v_seq uuid := gen_random_uuid();
  v_result jsonb;
  v_jobs integer;
  v_state text;
BEGIN
  SELECT id INTO v_admin FROM public.admins WHERE is_active IS TRUE AND role='Super Admin' LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'TEST_BLOCKED: active Super Admin not found'; END IF;

  INSERT INTO public.kdj_followup_profiles(
    phone_local,consent_granted,consent_source,consent_text_version,consented_at,
    last_inbound_at,sequence_id,sequence_status,updated_at
  ) VALUES(v_phone,true,'PORTAL','TEST-ONLY',now(),now()-interval '61 minutes',v_seq,'AWAITING_IDLE',now());
  INSERT INTO public.pendaftar(no_wa,chat_handler,status_pendaftaran) VALUES(v_phone,'BOT',NULL);
  INSERT INTO public.kdj_lead_qualifications(
    phone_local,recommendation_category,recommendation_operational_status,
    qualification_status,confirmed_category,confirmed_operational_status,
    confirmed_by,confirmed_at,decision_reason
  ) VALUES(v_phone,'DINGIN','NORMAL','CONFIRMED','DINGIN','NORMAL',v_admin,now(),'Uji transaksi lokal');
  INSERT INTO public.kdj_followup_conversation_state(
    phone_local,conversation_status,session_snapshot,last_inbound_at,last_activity_at
  ) VALUES(v_phone,'ACTIVE','{"state":"ai_mode","history":[]}'::jsonb,now()-interval '61 minutes',now()-interval '61 minutes');

  UPDATE public.kdj_system_controls SET global_safe_mode=true WHERE id=1;
  v_result := public.kdj_evaluate_followup_eligibility(100);
  SELECT count(*) INTO v_jobs FROM public.kdj_followup_jobs WHERE phone_local=v_phone AND status='HELD_COMPLIANCE';
  IF v_jobs<>0 OR COALESCE((v_result->>'paused')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: global safe mode must pause evaluator and create no jobs';
  END IF;
  UPDATE public.kdj_system_controls SET global_safe_mode=false WHERE id=1;
  v_result := public.kdj_evaluate_followup_eligibility(100);
  SELECT count(*) INTO v_jobs FROM public.kdj_followup_jobs WHERE phone_local=v_phone AND status='HELD_COMPLIANCE';
  IF v_jobs<>3 THEN RAISE EXCEPTION 'ASSERTION_FAILED: expected 3 HELD jobs after idle+confirmed DINGIN; got %; evaluator=%',v_jobs,v_result; END IF;
  SELECT sequence_status INTO v_state FROM public.kdj_followup_profiles WHERE phone_local=v_phone;
  IF v_state<>'ACTIVE' THEN RAISE EXCEPTION 'ASSERTION_FAILED: expected ACTIVE profile after jobs; got %',v_state; END IF;

  -- A fresh inbound cancels all unsent jobs and starts a new idle cycle. No immediate jobs.
  PERFORM public.kdj_record_followup_inbound(v_phone,'test-message-2',now()-interval '31 minutes');
  SELECT count(*) INTO v_jobs FROM public.kdj_followup_jobs WHERE phone_local=v_phone AND status='CANCELLED';
  IF v_jobs<>3 THEN RAISE EXCEPTION 'ASSERTION_FAILED: expected 3 cancelled jobs after new inbound; got %',v_jobs; END IF;
  SELECT count(*) INTO v_jobs FROM public.kdj_followup_jobs WHERE phone_local=v_phone AND status='HELD_COMPLIANCE';
  IF v_jobs<>0 THEN RAISE EXCEPTION 'ASSERTION_FAILED: inbound RPC must not create jobs immediately; got %',v_jobs; END IF;
  SELECT sequence_status INTO v_state FROM public.kdj_followup_profiles WHERE phone_local=v_phone;
  IF v_state<>'AWAITING_IDLE' THEN RAISE EXCEPTION 'ASSERTION_FAILED: expected AWAITING_IDLE after inbound; got %',v_state; END IF;
  IF (SELECT session_snapshot->>'state' FROM public.kdj_followup_conversation_state WHERE phone_local=v_phone)<>'followup_state_error' THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: inbound must fail closed until Bot persists its fresh snapshot';
  END IF;

  v_result := public.kdj_record_lead_qualification_recommendation(v_phone,'test-message-1','DINGIN','NORMAL','stale recommendation test');
  IF COALESCE((v_result->>'stale')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: stale Bot recommendation must be ignored; got %',v_result;
  END IF;
  PERFORM public.kdj_save_followup_conversation_state(v_phone,'{"state":"ai_mode","history":[]}'::jsonb,'ACTIVE');

  -- A stale Portal screen cannot confirm classification against an older inbound anchor.
  BEGIN
    PERFORM public.kdj_admin_set_lead_qualification(
      (SELECT id FROM public.kdj_lead_qualifications WHERE phone_local=v_phone),
      v_admin,v_seq,'DINGIN','NORMAL','Stale decision test'
    );
    RAISE EXCEPTION 'ASSERTION_FAILED: stale Admin decision should have been rejected';
  EXCEPTION WHEN SQLSTATE '40001' THEN
    NULL;
  END;

  -- New inbound cycle must wait for explicit Admin classification confirmation.
  UPDATE public.kdj_lead_qualifications SET qualification_status='PENDING_REVIEW',confirmed_category=NULL,
    confirmed_operational_status=NULL,confirmed_by=NULL,confirmed_at=NULL WHERE phone_local=v_phone;
  v_result := public.kdj_evaluate_followup_eligibility(100);
  SELECT sequence_status INTO v_state FROM public.kdj_followup_profiles WHERE phone_local=v_phone;
  IF v_state<>'AWAITING_ADMIN_REVIEW' THEN RAISE EXCEPTION 'ASSERTION_FAILED: unconfirmed lead must await Admin review; got %',v_state; END IF;

  -- Portal OTP initializes a real registration profile as draft_berkas; it must block FU.
  INSERT INTO public.kdj_followup_profiles(
    phone_local,consent_granted,consent_source,consent_text_version,consented_at,
    last_inbound_at,sequence_id,sequence_status,updated_at
  ) VALUES(v_phone_registered,true,'PORTAL','TEST-ONLY',now(),now()-interval '61 minutes',gen_random_uuid(),'AWAITING_IDLE',now());
  INSERT INTO public.pendaftar(no_wa,chat_handler,status_pendaftaran)
  VALUES(v_phone_registered,'BOT','draft_berkas');
  SELECT sequence_status INTO v_state FROM public.kdj_followup_profiles WHERE phone_local=v_phone_registered;
  IF v_state<>'STOPPED' THEN RAISE EXCEPTION 'ASSERTION_FAILED: Portal draft_berkas must stop FU; got %',v_state; END IF;
  SELECT count(*) INTO v_jobs FROM public.kdj_followup_jobs WHERE phone_local=v_phone_registered;
  IF v_jobs<>0 THEN RAISE EXCEPTION 'ASSERTION_FAILED: registered profile must not receive FU jobs; got %',v_jobs; END IF;

  -- Consent withdrawal blocks the sequence and cancels any unsent work.
  PERFORM public.kdj_set_followup_consent(v_phone,false,'PORTAL','TEST-ONLY','Pelanggan menarik persetujuan untuk test.',jsonb_build_object('test',true));
  SELECT sequence_status INTO v_state FROM public.kdj_followup_profiles WHERE phone_local=v_phone;
  IF v_state<>'STOPPED' THEN RAISE EXCEPTION 'ASSERTION_FAILED: consent withdrawal must STOP sequence; got %',v_state; END IF;
END $$;
ROLLBACK;
