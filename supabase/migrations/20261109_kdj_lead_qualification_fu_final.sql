-- KDJ Lead Qualification + durable Follow-up lifecycle
-- Version: 2026-11-09 final implementation package v1.3
-- Target: Staging/local restore only. Does not enable outbound delivery.

BEGIN;

-- Durable lead qualification. Temperature and operational status are separate dimensions.
CREATE TABLE IF NOT EXISTS public.kdj_lead_qualifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_local text NOT NULL UNIQUE REFERENCES public.kdj_followup_profiles(phone_local) ON DELETE CASCADE,
    recommendation_category text NOT NULL DEFAULT 'UNCLASSIFIED'
      CHECK (recommendation_category IN ('PROSPEK','DINGIN','BIMBANG','UNCLASSIFIED')),
    recommendation_operational_status text NOT NULL DEFAULT 'NORMAL'
      CHECK (recommendation_operational_status IN ('NORMAL','MASIH_BERTANYA')),
    recommendation_rationale text,
    recommendation_message_id text,
    recommended_at timestamptz,
    qualification_status text NOT NULL DEFAULT 'PENDING_REVIEW'
      CHECK (qualification_status IN ('PENDING_REVIEW','CONFIRMED')),
    confirmed_category text
      CHECK (confirmed_category IS NULL OR confirmed_category IN ('PROSPEK','DINGIN','BIMBANG')),
    confirmed_operational_status text
      CHECK (confirmed_operational_status IS NULL OR confirmed_operational_status IN ('NORMAL','MASIH_BERTANYA')),
    confirmed_by uuid REFERENCES public.admins(id) ON DELETE RESTRICT,
    confirmed_at timestamptz,
    decision_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT kdj_lead_qualification_confirmation_consistency CHECK (
      (qualification_status = 'PENDING_REVIEW' AND confirmed_category IS NULL AND confirmed_by IS NULL AND confirmed_at IS NULL)
      OR
      (qualification_status = 'CONFIRMED' AND confirmed_category IS NOT NULL AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)
    )
);
CREATE INDEX IF NOT EXISTS idx_kdj_lead_qualifications_review
  ON public.kdj_lead_qualifications (qualification_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_kdj_lead_qualifications_category
  ON public.kdj_lead_qualifications (confirmed_category, confirmed_operational_status);

-- Existing follow-up profiles appear in the Admin review queue as UNCLASSIFIED.
INSERT INTO public.kdj_lead_qualifications(phone_local)
SELECT phone_local FROM public.kdj_followup_profiles
ON CONFLICT(phone_local) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.kdj_lead_qualification_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    qualification_id uuid NOT NULL REFERENCES public.kdj_lead_qualifications(id) ON DELETE RESTRICT,
    phone_local text NOT NULL CHECK (phone_local ~ '^08[0-9]{8,11}$'),
    actor_type text NOT NULL CHECK (actor_type IN ('BOT','ADMIN','SYSTEM')),
    actor_admin_id uuid REFERENCES public.admins(id) ON DELETE RESTRICT,
    action text NOT NULL CHECK (action IN ('BOT_RECOMMENDATION','ADMIN_CONFIRMED','ADMIN_REVISED','INVALIDATED_BY_INBOUND')),
    previous_category text CHECK (previous_category IS NULL OR previous_category IN ('PROSPEK','DINGIN','BIMBANG','UNCLASSIFIED')),
    previous_operational_status text CHECK (previous_operational_status IS NULL OR previous_operational_status IN ('NORMAL','MASIH_BERTANYA')),
    category text NOT NULL CHECK (category IN ('PROSPEK','DINGIN','BIMBANG','UNCLASSIFIED')),
    operational_status text NOT NULL CHECK (operational_status IN ('NORMAL','MASIH_BERTANYA')),
    rationale text,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kdj_lead_qualification_events_qualification_created
  ON public.kdj_lead_qualification_events (qualification_id, created_at DESC);

-- Durable, minimal Bot session snapshot. Only the last six message parts are retained,
-- matching the current in-memory cap. Service role only; no browser access.
CREATE TABLE IF NOT EXISTS public.kdj_followup_conversation_state (
    phone_local text PRIMARY KEY REFERENCES public.kdj_followup_profiles(phone_local) ON DELETE CASCADE,
    conversation_status text NOT NULL DEFAULT 'ACTIVE'
      CHECK (conversation_status IN ('ACTIVE','IDLE','HUMAN','CLOSED')),
    session_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
    last_inbound_at timestamptz,
    last_inbound_message_id text,
    last_activity_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT kdj_followup_conversation_snapshot_object CHECK (jsonb_typeof(session_snapshot) = 'object')
);
CREATE INDEX IF NOT EXISTS idx_kdj_followup_conversation_idle
  ON public.kdj_followup_conversation_state (conversation_status, last_inbound_at);

-- Extend the state machine without rewriting historical jobs.
ALTER TABLE public.kdj_followup_profiles
  DROP CONSTRAINT IF EXISTS kdj_followup_profiles_sequence_status_check;
ALTER TABLE public.kdj_followup_profiles
  ADD CONSTRAINT kdj_followup_profiles_sequence_status_check
  CHECK (sequence_status IN (
    'AWAITING_CONSENT','AWAITING_INBOUND','AWAITING_IDLE',
    'AWAITING_ADMIN_REVIEW','ACTIVE','STOPPED','COMPLETED'
  ));

-- Legacy Batch 01 created HELD jobs before the 30-minute/Admin qualification gate existed.
-- Cancel only those unsent legacy jobs and rotate the cycle id, preserving their audit rows.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.kdj_followup_jobs WHERE status IN ('PROCESSING','UNKNOWN')) THEN
    RAISE EXCEPTION 'MIGRATION_BLOCKED: PROCESSING/UNKNOWN FU jobs require reconciliation before lifecycle cutover.';
  END IF;
END $$;

UPDATE public.kdj_followup_jobs
SET status='CANCELLED',stop_reason='LEGACY_PRE_ELIGIBILITY_CYCLE',updated_at=now()
WHERE status IN ('HELD_COMPLIANCE','SCHEDULED');

UPDATE public.kdj_followup_profiles p
SET sequence_id=gen_random_uuid(),
    sequence_status=CASE
      WHEN p.admin_stopped_at IS NOT NULL THEN 'STOPPED'
      WHEN p.opted_out_at IS NOT NULL THEN 'STOPPED'
      WHEN p.consent_granted IS NOT TRUE THEN 'AWAITING_CONSENT'
      WHEN p.last_inbound_at IS NOT NULL THEN 'AWAITING_IDLE'
      ELSE 'AWAITING_INBOUND' END,
    stop_reason=CASE
      WHEN p.admin_stopped_at IS NOT NULL THEN 'ADMIN_STOP'
      WHEN p.opted_out_at IS NOT NULL THEN 'CONSENT_WITHDRAWN'
      ELSE NULL END,
    updated_at=now()
WHERE EXISTS (
  SELECT 1 FROM public.kdj_followup_jobs j
  WHERE j.phone_local=p.phone_local AND j.stop_reason='LEGACY_PRE_ELIGIBILITY_CYCLE'
);

ALTER TABLE public.kdj_followup_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kdj_followup_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kdj_followup_consent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kdj_followup_control_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kdj_lead_qualifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kdj_lead_qualification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kdj_followup_conversation_state ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.kdj_lead_qualifications,
  public.kdj_lead_qualification_events,
  public.kdj_followup_conversation_state FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.kdj_lead_qualifications TO service_role;
GRANT SELECT, INSERT ON TABLE public.kdj_lead_qualification_events TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.kdj_followup_conversation_state TO service_role;

-- Consent grant after an earlier inbound must return to the 30-minute evaluator,
-- not wait for an additional inbound. Withdrawal always cancels unsent work.
CREATE OR REPLACE FUNCTION public.kdj_set_followup_consent(
    p_phone_local text,
    p_consented boolean,
    p_source text,
    p_text_version text,
    p_consent_text text,
    p_evidence jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_event_id uuid; v_status text;
BEGIN
    IF p_phone_local IS NULL OR p_phone_local !~ '^08[0-9]{8,11}$'
       OR p_consented IS NULL OR p_source IS NULL OR p_source NOT IN ('PORTAL','WHATSAPP')
       OR p_text_version IS NULL OR length(p_text_version) NOT BETWEEN 1 AND 80
       OR p_consent_text IS NULL OR length(p_consent_text) NOT BETWEEN 10 AND 1000
       OR pg_catalog.jsonb_typeof(COALESCE(p_evidence,'{}'::jsonb)) <> 'object'
    THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='INVALID_FOLLOWUP_CONSENT_PAYLOAD'; END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_phone_local,0));
    INSERT INTO public.kdj_followup_consent_events(phone_local,action,source,text_version,consent_text,evidence)
    VALUES(p_phone_local,CASE WHEN p_consented THEN 'GRANTED' ELSE 'WITHDRAWN' END,
      p_source,p_text_version,p_consent_text,pg_catalog.jsonb_strip_nulls(COALESCE(p_evidence,'{}'::jsonb)))
    RETURNING id INTO v_event_id;

    INSERT INTO public.kdj_followup_profiles(
      phone_local,consent_granted,consent_source,consent_text_version,consented_at,
      consent_evidence,opted_out_at,sequence_status,stop_reason,updated_at
    ) VALUES (
      p_phone_local,p_consented,CASE WHEN p_consented THEN p_source ELSE NULL END,
      CASE WHEN p_consented THEN p_text_version ELSE NULL END,
      CASE WHEN p_consented THEN now() ELSE NULL END,
      CASE WHEN p_consented THEN COALESCE(p_evidence,'{}'::jsonb) ELSE '{}'::jsonb END,
      CASE WHEN p_consented THEN NULL ELSE now() END,
      CASE WHEN p_consented THEN 'AWAITING_INBOUND' ELSE 'STOPPED' END,
      CASE WHEN p_consented THEN NULL ELSE 'CONSENT_WITHDRAWN' END,now()
    ) ON CONFLICT(phone_local) DO UPDATE SET
      consent_granted=EXCLUDED.consent_granted,
      consent_source=EXCLUDED.consent_source,
      consent_text_version=EXCLUDED.consent_text_version,
      consented_at=EXCLUDED.consented_at,
      consent_evidence=EXCLUDED.consent_evidence,
      opted_out_at=EXCLUDED.opted_out_at,
      sequence_status=CASE
        WHEN public.kdj_followup_profiles.admin_stopped_at IS NOT NULL THEN 'STOPPED'
        WHEN NOT EXCLUDED.consent_granted THEN 'STOPPED'
        WHEN public.kdj_followup_profiles.last_inbound_at IS NOT NULL THEN 'AWAITING_IDLE'
        ELSE 'AWAITING_INBOUND' END,
      stop_reason=CASE
        WHEN public.kdj_followup_profiles.admin_stopped_at IS NOT NULL THEN 'ADMIN_STOP'
        WHEN NOT EXCLUDED.consent_granted THEN 'CONSENT_WITHDRAWN'
        ELSE NULL END,
      updated_at=now();

    IF NOT p_consented THEN
      UPDATE public.kdj_followup_jobs SET status='CANCELLED',stop_reason='CONSENT_WITHDRAWN',updated_at=now()
      WHERE phone_local=p_phone_local AND status IN ('HELD_COMPLIANCE','SCHEDULED','PROCESSING');
      UPDATE public.kdj_followup_conversation_state SET conversation_status='CLOSED',updated_at=now()
      WHERE phone_local=p_phone_local;
    END IF;
    SELECT sequence_status INTO v_status FROM public.kdj_followup_profiles WHERE phone_local=p_phone_local;
    RETURN pg_catalog.jsonb_build_object('success',true,'consent_granted',p_consented,
      'consent_event_id',v_event_id,'sequence_status',v_status);
END; $function$;

-- Inbound no longer creates FU jobs. It starts/resets a durable idle cycle only.
CREATE OR REPLACE FUNCTION public.kdj_record_followup_inbound(
    p_phone_local text,
    p_message_id text,
    p_received_at timestamptz DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_received_at timestamptz := COALESCE(p_received_at,now());
  v_profile public.kdj_followup_profiles%ROWTYPE;
  v_sequence_id uuid := gen_random_uuid();
  v_qualification public.kdj_lead_qualifications%ROWTYPE;
BEGIN
  IF p_phone_local IS NULL OR p_phone_local !~ '^08[0-9]{8,11}$'
     OR (p_message_id IS NOT NULL AND length(p_message_id)>200)
     OR v_received_at>now()+interval '5 minutes'
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_FOLLOWUP_INBOUND_PAYLOAD'; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_phone_local,0));
  SELECT * INTO v_profile FROM public.kdj_followup_profiles WHERE phone_local=p_phone_local FOR UPDATE;
  IF FOUND AND p_message_id IS NOT NULL AND v_profile.last_inbound_message_id=p_message_id THEN
    RETURN pg_catalog.jsonb_build_object('success',true,'duplicate',true,'jobs_created',0,'sequence_status',v_profile.sequence_status);
  END IF;
  IF FOUND AND v_profile.last_inbound_at IS NOT NULL AND v_received_at<v_profile.last_inbound_at THEN
    RETURN pg_catalog.jsonb_build_object('success',true,'stale_inbound',true,'jobs_created',0,'sequence_status',v_profile.sequence_status);
  END IF;

  INSERT INTO public.kdj_followup_profiles(
    phone_local,last_inbound_at,last_inbound_message_id,sequence_id,sequence_status,updated_at
  ) VALUES(
    p_phone_local,v_received_at,p_message_id,v_sequence_id,'AWAITING_CONSENT',now()
  ) ON CONFLICT(phone_local) DO UPDATE SET
    last_inbound_at=EXCLUDED.last_inbound_at,
    last_inbound_message_id=EXCLUDED.last_inbound_message_id,
    sequence_id=v_sequence_id,
    sequence_status=CASE
      WHEN public.kdj_followup_profiles.admin_stopped_at IS NOT NULL THEN 'STOPPED'
      WHEN public.kdj_followup_profiles.opted_out_at IS NOT NULL THEN 'STOPPED'
      WHEN public.kdj_followup_profiles.consent_granted THEN 'AWAITING_IDLE'
      ELSE 'AWAITING_CONSENT' END,
    stop_reason=CASE
      WHEN public.kdj_followup_profiles.admin_stopped_at IS NOT NULL THEN 'ADMIN_STOP'
      WHEN public.kdj_followup_profiles.opted_out_at IS NOT NULL THEN 'CONSENT_WITHDRAWN'
      ELSE NULL END,
    updated_at=now()
  RETURNING * INTO v_profile;

  UPDATE public.kdj_followup_jobs SET status='CANCELLED',stop_reason='NEW_INBOUND',updated_at=now()
  WHERE phone_local=p_phone_local AND status IN ('HELD_COMPLIANCE','SCHEDULED','PROCESSING');

  INSERT INTO public.kdj_lead_qualifications(phone_local)
  VALUES(p_phone_local) ON CONFLICT(phone_local) DO NOTHING;
  SELECT * INTO v_qualification FROM public.kdj_lead_qualifications
  WHERE phone_local=p_phone_local FOR UPDATE;
  IF v_qualification.qualification_status='CONFIRMED'
     OR v_qualification.recommended_at IS NOT NULL THEN
    INSERT INTO public.kdj_lead_qualification_events(
      qualification_id,phone_local,actor_type,action,previous_category,previous_operational_status,category,operational_status,rationale,evidence
    ) VALUES(
      v_qualification.id,p_phone_local,'SYSTEM','INVALIDATED_BY_INBOUND',
      COALESCE(v_qualification.confirmed_category,v_qualification.recommendation_category,'UNCLASSIFIED'),
      COALESCE(v_qualification.confirmed_operational_status,v_qualification.recommendation_operational_status,'NORMAL'),
      'UNCLASSIFIED','NORMAL',
      'Klasifikasi/rekomendasi lama kedaluwarsa karena inbound baru.',
      jsonb_build_object('previous_recommendation_message_id',v_qualification.recommendation_message_id,'new_message_id',p_message_id)
    );
  END IF;
  UPDATE public.kdj_lead_qualifications SET
    recommendation_category='UNCLASSIFIED',recommendation_operational_status='NORMAL',
    recommendation_rationale=NULL,recommendation_message_id=NULL,recommended_at=NULL,
    qualification_status='PENDING_REVIEW',confirmed_category=NULL,confirmed_operational_status=NULL,
    confirmed_by=NULL,confirmed_at=NULL,decision_reason=NULL,updated_at=now()
  WHERE phone_local=p_phone_local;

  INSERT INTO public.kdj_followup_conversation_state(
    phone_local,conversation_status,session_snapshot,last_inbound_at,last_inbound_message_id,last_activity_at,updated_at
  ) VALUES(p_phone_local,'ACTIVE',jsonb_build_object('state','followup_state_error','reason','AWAITING_BOT_SNAPSHOT'),v_received_at,p_message_id,v_received_at,now())
  ON CONFLICT(phone_local) DO UPDATE SET
    conversation_status='ACTIVE',session_snapshot=EXCLUDED.session_snapshot,
    last_inbound_at=EXCLUDED.last_inbound_at,last_inbound_message_id=EXCLUDED.last_inbound_message_id,
    last_activity_at=EXCLUDED.last_activity_at,updated_at=now();

  RETURN pg_catalog.jsonb_build_object(
    'success',true,'jobs_created',0,'sequence_id',v_profile.sequence_id,
    'sequence_status',v_profile.sequence_status,
    'eligibility_after',v_received_at+interval '30 minutes',
    'delivery_status','NOT_DISPATCHED'
  );
END; $function$;

-- Bot may only suggest; confirmed Admin decision is stored separately and is never overwritten.
CREATE OR REPLACE FUNCTION public.kdj_record_lead_qualification_recommendation(
  p_phone_local text,p_message_id text,p_category text,p_operational_status text,p_rationale text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_qualification_id uuid; v_current_message_id text; v_previous_category text; v_previous_operational_status text;
BEGIN
  IF p_phone_local IS NULL OR p_phone_local !~ '^08[0-9]{8,11}$'
    OR p_message_id IS NULL OR length(p_message_id) NOT BETWEEN 1 AND 200
    OR p_category IS NULL OR p_category NOT IN ('PROSPEK','DINGIN','BIMBANG','UNCLASSIFIED')
    OR p_operational_status IS NULL OR p_operational_status NOT IN ('NORMAL','MASIH_BERTANYA')
    OR p_rationale IS NULL OR length(pg_catalog.btrim(p_rationale)) NOT BETWEEN 5 AND 500
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_LEAD_QUALIFICATION_RECOMMENDATION'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_phone_local,0));
  SELECT last_inbound_message_id INTO v_current_message_id
  FROM public.kdj_followup_profiles WHERE phone_local=p_phone_local FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='FOLLOWUP_PROFILE_NOT_FOUND'; END IF;
  IF v_current_message_id IS DISTINCT FROM p_message_id THEN
    RETURN jsonb_build_object('success',false,'stale',true,'reason','RECOMMENDATION_FOR_OLDER_INBOUND');
  END IF;
  SELECT recommendation_category,recommendation_operational_status
  INTO v_previous_category,v_previous_operational_status
  FROM public.kdj_lead_qualifications WHERE phone_local=p_phone_local FOR UPDATE;
  INSERT INTO public.kdj_lead_qualifications(phone_local,recommendation_category,recommendation_operational_status,
    recommendation_rationale,recommendation_message_id,recommended_at,updated_at)
  VALUES(p_phone_local,p_category,p_operational_status,pg_catalog.left(p_rationale,500),p_message_id,now(),now())
  ON CONFLICT(phone_local) DO UPDATE SET
    recommendation_category=EXCLUDED.recommendation_category,
    recommendation_operational_status=EXCLUDED.recommendation_operational_status,
    recommendation_rationale=EXCLUDED.recommendation_rationale,
    recommendation_message_id=EXCLUDED.recommendation_message_id,
    recommended_at=now(),updated_at=now()
  RETURNING id INTO v_qualification_id;
  INSERT INTO public.kdj_lead_qualification_events(
    qualification_id,phone_local,actor_type,action,previous_category,previous_operational_status,category,operational_status,rationale,evidence
  ) VALUES(v_qualification_id,p_phone_local,'BOT','BOT_RECOMMENDATION',v_previous_category,v_previous_operational_status,p_category,p_operational_status,
    pg_catalog.left(p_rationale,500),jsonb_build_object('source','GEMINI_RECOMMENDATION','message_id',p_message_id));
  RETURN jsonb_build_object('success',true,'qualification_id',v_qualification_id,'authority','RECOMMENDATION_ONLY');
END; $function$;

CREATE OR REPLACE FUNCTION public.kdj_admin_set_lead_qualification(
  p_qualification_id uuid,p_actor_admin_id uuid,p_expected_sequence_id uuid,
  p_category text,p_operational_status text,p_reason text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_q public.kdj_lead_qualifications%ROWTYPE; v_admin public.admins%ROWTYPE; v_action text; v_phone text; v_current_sequence_id uuid;
BEGIN
  IF p_qualification_id IS NULL OR p_actor_admin_id IS NULL
    OR p_category IS NULL OR p_category NOT IN ('PROSPEK','DINGIN','BIMBANG')
    OR p_operational_status IS NULL OR p_operational_status NOT IN ('NORMAL','MASIH_BERTANYA')
    OR p_reason IS NULL OR length(pg_catalog.btrim(p_reason)) NOT BETWEEN 5 AND 500
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_ADMIN_LEAD_QUALIFICATION'; END IF;
  SELECT * INTO v_admin FROM public.admins WHERE id=p_actor_admin_id AND is_active IS TRUE FOR SHARE;
  IF NOT FOUND OR v_admin.role NOT IN ('Super Admin','Admin Konsultan') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='LEAD_QUALIFICATION_FORBIDDEN';
  END IF;
  SELECT q.phone_local,p.sequence_id INTO v_phone,v_current_sequence_id
  FROM public.kdj_lead_qualifications q
  LEFT JOIN public.kdj_followup_profiles p ON p.phone_local=q.phone_local
  WHERE q.id=p_qualification_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='LEAD_QUALIFICATION_NOT_FOUND'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_phone,0));
  SELECT p.sequence_id INTO v_current_sequence_id FROM public.kdj_followup_profiles p WHERE p.phone_local=v_phone FOR UPDATE;
  IF v_current_sequence_id IS DISTINCT FROM p_expected_sequence_id THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='LEAD_QUALIFICATION_STALE_INBOUND';
  END IF;
  SELECT * INTO v_q FROM public.kdj_lead_qualifications WHERE id=p_qualification_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='LEAD_QUALIFICATION_NOT_FOUND'; END IF;
  v_action := CASE WHEN v_q.qualification_status='CONFIRMED' THEN 'ADMIN_REVISED' ELSE 'ADMIN_CONFIRMED' END;
  UPDATE public.kdj_lead_qualifications SET
    qualification_status='CONFIRMED',confirmed_category=p_category,
    confirmed_operational_status=p_operational_status,confirmed_by=p_actor_admin_id,
    confirmed_at=now(),decision_reason=pg_catalog.btrim(p_reason),updated_at=now()
  WHERE id=p_qualification_id;
  INSERT INTO public.kdj_lead_qualification_events(
    qualification_id,phone_local,actor_type,actor_admin_id,action,previous_category,previous_operational_status,category,operational_status,rationale
  ) VALUES(p_qualification_id,v_q.phone_local,'ADMIN',p_actor_admin_id,v_action,v_q.confirmed_category,
    v_q.confirmed_operational_status,p_category,p_operational_status,pg_catalog.btrim(p_reason));

  UPDATE public.kdj_followup_profiles SET
    sequence_status=CASE
      WHEN admin_stopped_at IS NOT NULL THEN 'STOPPED'
      WHEN opted_out_at IS NOT NULL OR NOT consent_granted THEN CASE WHEN opted_out_at IS NOT NULL THEN 'STOPPED' ELSE 'AWAITING_CONSENT' END
      WHEN last_inbound_at IS NULL THEN 'AWAITING_INBOUND'
      WHEN p_category='DINGIN' AND p_operational_status='MASIH_BERTANYA' THEN 'AWAITING_ADMIN_REVIEW'
      WHEN p_category='DINGIN' AND p_operational_status='NORMAL' THEN 'AWAITING_IDLE'
      ELSE 'STOPPED' END,
    stop_reason=CASE
      WHEN admin_stopped_at IS NOT NULL THEN 'ADMIN_STOP'
      WHEN opted_out_at IS NOT NULL THEN 'CONSENT_WITHDRAWN'
      WHEN p_category<>'DINGIN' THEN 'LEAD_NOT_DINGIN'
      WHEN p_operational_status='MASIH_BERTANYA' THEN 'ACTIVE_CONVERSATION'
      ELSE NULL END,
    updated_at=now()
  WHERE phone_local=v_q.phone_local;
  IF p_category<>'DINGIN' OR p_operational_status<>'NORMAL' THEN
    UPDATE public.kdj_followup_jobs SET status='CANCELLED',stop_reason=CASE
      WHEN p_category<>'DINGIN' THEN 'LEAD_NOT_DINGIN' ELSE 'ACTIVE_CONVERSATION' END,updated_at=now()
    WHERE phone_local=v_q.phone_local AND status IN ('HELD_COMPLIANCE','SCHEDULED','PROCESSING');
  END IF;
  RETURN jsonb_build_object('success',true,'qualification_id',p_qualification_id,
    'confirmed_category',p_category,'sequence_status',(SELECT sequence_status FROM public.kdj_followup_profiles WHERE phone_local=v_q.phone_local));
END; $function$;

-- Durable snapshot stores the current small Bot context, but not credentials or WA auth state.
CREATE OR REPLACE FUNCTION public.kdj_save_followup_conversation_state(
  p_phone_local text,p_session_snapshot jsonb,p_conversation_status text DEFAULT 'ACTIVE'
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_state text;
BEGIN
  IF p_phone_local IS NULL OR p_phone_local !~ '^08[0-9]{8,11}$'
    OR p_session_snapshot IS NULL OR jsonb_typeof(p_session_snapshot)<>'object'
    OR pg_column_size(p_session_snapshot)>32768
    OR p_conversation_status IS NULL OR p_conversation_status NOT IN ('ACTIVE','HUMAN','CLOSED')
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_FOLLOWUP_CONVERSATION_STATE'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_phone_local,0));
  v_state := COALESCE(p_session_snapshot->>'state','ai_mode');
  INSERT INTO public.kdj_followup_conversation_state(phone_local,conversation_status,session_snapshot,last_activity_at,updated_at)
  VALUES(p_phone_local,p_conversation_status,p_session_snapshot,now(),now())
  ON CONFLICT(phone_local) DO UPDATE SET
    conversation_status=EXCLUDED.conversation_status,
    session_snapshot=EXCLUDED.session_snapshot,
    last_activity_at=now(),updated_at=now();
  IF v_state='ai_mode' AND p_conversation_status='ACTIVE' THEN
    UPDATE public.kdj_followup_profiles SET sequence_status='AWAITING_IDLE',stop_reason=NULL,updated_at=now()
    WHERE phone_local=p_phone_local AND sequence_status='AWAITING_ADMIN_REVIEW'
      AND stop_reason='ACTIVE_CONVERSATION' AND consent_granted AND opted_out_at IS NULL
      AND admin_stopped_at IS NULL AND last_inbound_at IS NOT NULL;
  END IF;
  RETURN jsonb_build_object('success',true,'conversation_status',p_conversation_status);
END; $function$;

-- Durable evaluator. It only creates HELD_COMPLIANCE rows; it contains no dispatch path.
CREATE OR REPLACE FUNCTION public.kdj_evaluate_followup_eligibility(p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_profile public.kdj_followup_profiles%ROWTYPE;
  v_candidate_phone text;
  v_q public.kdj_lead_qualifications%ROWTYPE;
  v_conv public.kdj_followup_conversation_state%ROWTYPE;
  v_reason text;
  v_processed integer:=0; v_created integer:=0; v_held integer:=0;
  v_rows integer;
BEGIN
  IF p_limit IS NULL OR p_limit<1 OR p_limit>1000 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_FOLLOWUP_EVALUATOR_LIMIT';
  END IF;
  -- Respect the existing global safety controls. Missing control row is fail-closed.
  IF NOT EXISTS (SELECT 1 FROM public.kdj_system_controls WHERE id=1)
     OR EXISTS (
       SELECT 1 FROM public.kdj_system_controls c
       WHERE c.id=1 AND (
         c.global_safe_mode IS TRUE
         OR EXISTS (
           SELECT 1 FROM pg_catalog.unnest(COALESCE(c.paused_modules,ARRAY[]::text[])) AS u(module_name)
           WHERE pg_catalog.lower(pg_catalog.btrim(u.module_name)) IN ('followup','followups','fu','bot','whatsapp')
         )
       )
     ) THEN
    RETURN pg_catalog.jsonb_build_object('success',true,'paused',true,'reason','GLOBAL_SAFE_MODE_OR_FOLLOWUP_MODULE_PAUSED',
      'profiles_processed',0,'jobs_created',0,'sequences_held',0,'delivery_enabled',false);
  END IF;
  FOR v_candidate_phone IN
    SELECT phone_local FROM public.kdj_followup_profiles
    WHERE sequence_status='AWAITING_IDLE'
      AND consent_granted IS TRUE AND opted_out_at IS NULL
      AND admin_stopped_at IS NULL
      AND last_inbound_at IS NOT NULL
      AND last_inbound_at<=now()-interval '30 minutes'
    ORDER BY last_inbound_at
    LIMIT p_limit
  LOOP
    -- Read cross-domain stop evidence before taking the per-phone/profile lock.
    -- Their AFTER triggers acquire the same phone lock after the source row is changed;
    -- this ordering avoids profile->pendaftar/booking lock inversion during concurrent UAT.
    v_reason:=NULL;
    IF EXISTS (
      SELECT 1 FROM public.pendaftar p
      WHERE p.no_wa IN (v_candidate_phone,'62'||pg_catalog.substr(v_candidate_phone,2))
        AND p.chat_handler='HUMAN'
    ) THEN v_reason:='HUMAN_HANDOVER'; END IF;
    IF v_reason IS NULL AND EXISTS (
      SELECT 1 FROM public.pendaftar p
      WHERE p.no_wa IN (v_candidate_phone,'62'||pg_catalog.substr(v_candidate_phone,2))
        AND (
          (COALESCE(pg_catalog.btrim(p.status_pendaftaran),'')<>'' AND pg_catalog.lower(pg_catalog.btrim(p.status_pendaftaran)) NOT IN ('draft'))
          OR COALESCE(pg_catalog.btrim(p.nama_lengkap),'')<>''
          OR COALESCE(pg_catalog.btrim(p.pilihan_kampus),'')<>''
          OR COALESCE(pg_catalog.btrim(p.pilihan_jurusan),'')<>''
          OR COALESCE(pg_catalog.btrim(p.no_paspor),'')<>''
          OR COALESCE(pg_catalog.btrim(p.tempat_lahir),'')<>''
          OR p.tanggal_lahir IS NOT NULL
          OR COALESCE(pg_catalog.btrim(p.alamat_lengkap),'')<>''
          OR COALESCE(pg_catalog.btrim(p.asal_sekolah),'')<>''
          OR p.tahun_lulus IS NOT NULL
          OR EXISTS (SELECT 1 FROM public.dokumen_pendaftar d WHERE d.pendaftar_id=p.id)
        )
    ) THEN v_reason:='REGISTRATION_IN_PROGRESS'; END IF;
    IF v_reason IS NULL AND EXISTS (
      SELECT 1 FROM public.jadwal_konsultasi j
      WHERE j.no_wa IN (v_candidate_phone,'62'||pg_catalog.substr(v_candidate_phone,2))
        AND j.status='Terjadwal' AND j.jadwal_pilihan>=now()
    ) THEN v_reason:='ACTIVE_BOOKING'; END IF;

    -- Same per-phone lock order as inbound/consent/snapshot/admin qualification RPCs.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_candidate_phone,0));
    SELECT * INTO v_profile FROM public.kdj_followup_profiles
    WHERE phone_local=v_candidate_phone FOR UPDATE;
    IF NOT FOUND OR v_profile.sequence_status<>'AWAITING_IDLE'
      OR v_profile.consent_granted IS NOT TRUE OR v_profile.opted_out_at IS NOT NULL
      OR v_profile.admin_stopped_at IS NOT NULL OR v_profile.last_inbound_at IS NULL
      OR v_profile.last_inbound_at>now()-interval '30 minutes'
    THEN CONTINUE; END IF;

    v_processed:=v_processed+1;
    SELECT * INTO v_q FROM public.kdj_lead_qualifications WHERE phone_local=v_profile.phone_local;

    IF v_reason IS NULL THEN
      SELECT * INTO v_conv FROM public.kdj_followup_conversation_state WHERE phone_local=v_profile.phone_local FOR UPDATE;
      IF NOT FOUND OR v_conv.last_inbound_at IS NULL OR v_conv.last_inbound_at<v_profile.last_inbound_at THEN
        v_reason:='CONVERSATION_STATE_MISSING';
      ELSE
        UPDATE public.kdj_followup_conversation_state SET conversation_status='IDLE',updated_at=now()
        WHERE phone_local=v_profile.phone_local AND conversation_status='ACTIVE'
          AND last_inbound_at<=now()-interval '30 minutes';
        IF v_conv.session_snapshot->>'state'='followup_state_error' THEN
          v_reason:='INBOUND_PERSISTENCE_FAILED';
        ELSIF v_conv.conversation_status='HUMAN' OR v_conv.session_snapshot->>'state'='human_handover' THEN
          v_reason:='HUMAN_HANDOVER';
        ELSIF COALESCE(v_conv.session_snapshot->>'state','')<>'ai_mode' THEN
          v_reason:='ACTIVE_CONVERSATION';
        END IF;
      END IF;
    END IF;

    IF v_reason IS NULL AND (v_profile.consent_granted IS NOT TRUE OR v_profile.opted_out_at IS NOT NULL) THEN
      v_reason:='CONSENT_NOT_ACTIVE';
    END IF;
    IF v_reason IS NULL AND v_profile.admin_stopped_at IS NOT NULL THEN v_reason:='ADMIN_STOP'; END IF;

    IF v_reason IS NULL AND (v_q.id IS NULL OR v_q.qualification_status<>'CONFIRMED' OR v_q.confirmed_category IS NULL) THEN
      UPDATE public.kdj_followup_profiles SET sequence_status='AWAITING_ADMIN_REVIEW',stop_reason='CLASSIFICATION_REVIEW_REQUIRED',updated_at=now()
      WHERE phone_local=v_profile.phone_local;
      CONTINUE;
    ELSIF v_reason IS NULL AND v_q.confirmed_category<>'DINGIN' THEN
      UPDATE public.kdj_followup_profiles SET sequence_status='STOPPED',stop_reason='LEAD_NOT_DINGIN',updated_at=now()
      WHERE phone_local=v_profile.phone_local;
      CONTINUE;
    ELSIF v_reason IS NULL AND v_q.confirmed_operational_status='MASIH_BERTANYA' THEN
      UPDATE public.kdj_followup_profiles SET sequence_status='AWAITING_ADMIN_REVIEW',stop_reason='ACTIVE_CONVERSATION',updated_at=now()
      WHERE phone_local=v_profile.phone_local;
      CONTINUE;
    END IF;

    IF v_reason IS NOT NULL THEN
      UPDATE public.kdj_followup_profiles SET
        sequence_status=CASE WHEN v_reason='ACTIVE_CONVERSATION' THEN 'AWAITING_ADMIN_REVIEW' ELSE 'STOPPED' END,
        stop_reason=v_reason,updated_at=now()
      WHERE phone_local=v_profile.phone_local;
      CONTINUE;
    END IF;

    INSERT INTO public.kdj_followup_jobs(phone_local,sequence_id,step,due_at,status,held_reason,idempotency_key)
    VALUES
      (v_profile.phone_local,v_profile.sequence_id,1,v_profile.last_inbound_at+interval '1 day','HELD_COMPLIANCE','WHATSAPP_COMPLIANCE_GATE',md5(v_profile.phone_local||':'||v_profile.sequence_id::text||':1')),
      (v_profile.phone_local,v_profile.sequence_id,2,v_profile.last_inbound_at+interval '3 days','HELD_COMPLIANCE','WHATSAPP_COMPLIANCE_GATE',md5(v_profile.phone_local||':'||v_profile.sequence_id::text||':2')),
      (v_profile.phone_local,v_profile.sequence_id,3,v_profile.last_inbound_at+interval '7 days','HELD_COMPLIANCE','WHATSAPP_COMPLIANCE_GATE',md5(v_profile.phone_local||':'||v_profile.sequence_id::text||':3'))
    ON CONFLICT(sequence_id,step) DO NOTHING;
    GET DIAGNOSTICS v_rows=ROW_COUNT; v_created:=v_created+v_rows;
    UPDATE public.kdj_followup_profiles SET sequence_status='ACTIVE',stop_reason=NULL,updated_at=now()
    WHERE phone_local=v_profile.phone_local;
    v_held:=v_held+1;
  END LOOP;
  RETURN jsonb_build_object('success',true,'profiles_processed',v_processed,
    'jobs_created',v_created,'sequences_held',v_held,'delivery_enabled',false);
END; $function$;

-- Immediate stop propagation when a lead enters registration or a human operator takes over.
CREATE OR REPLACE FUNCTION public.kdj_followup_stop_from_pendaftar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_phone_local text; v_reason text;
BEGIN
  IF NEW.no_wa ~ '^08[0-9]{8,11}$' THEN
    v_phone_local := NEW.no_wa;
  ELSIF NEW.no_wa ~ '^62[0-9]{8,11}$' THEN
    v_phone_local := '0' || pg_catalog.substr(NEW.no_wa,3);
  ELSE
    RETURN NEW;
  END IF;
  IF NEW.chat_handler='HUMAN' THEN
    v_reason := 'HUMAN_HANDOVER';
  ELSIF (
    (COALESCE(pg_catalog.btrim(NEW.status_pendaftaran),'')<>'' AND pg_catalog.lower(pg_catalog.btrim(NEW.status_pendaftaran)) NOT IN ('draft'))
    OR COALESCE(pg_catalog.btrim(NEW.nama_lengkap),'')<>''
    OR COALESCE(pg_catalog.btrim(NEW.pilihan_kampus),'')<>''
    OR COALESCE(pg_catalog.btrim(NEW.pilihan_jurusan),'')<>''
    OR COALESCE(pg_catalog.btrim(NEW.no_paspor),'')<>''
    OR COALESCE(pg_catalog.btrim(NEW.tempat_lahir),'')<>''
    OR NEW.tanggal_lahir IS NOT NULL
    OR COALESCE(pg_catalog.btrim(NEW.alamat_lengkap),'')<>''
    OR COALESCE(pg_catalog.btrim(NEW.asal_sekolah),'')<>''
    OR NEW.tahun_lulus IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.dokumen_pendaftar d WHERE d.pendaftar_id=NEW.id)
  ) THEN
    v_reason := 'REGISTRATION_IN_PROGRESS';
  END IF;
  IF v_reason IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_phone_local,0));
    UPDATE public.kdj_followup_profiles SET sequence_status='STOPPED',stop_reason=v_reason,updated_at=now()
    WHERE phone_local=v_phone_local AND admin_stopped_at IS NULL AND opted_out_at IS NULL;
    UPDATE public.kdj_followup_jobs SET status='CANCELLED',stop_reason=v_reason,updated_at=now()
    WHERE phone_local=v_phone_local AND status IN ('HELD_COMPLIANCE','SCHEDULED','PROCESSING');
  END IF;
  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS trg_kdj_followup_stop_from_pendaftar ON public.pendaftar;
CREATE TRIGGER trg_kdj_followup_stop_from_pendaftar
AFTER INSERT OR UPDATE OF no_wa,chat_handler,status_pendaftaran,nama_lengkap,pilihan_kampus,pilihan_jurusan,no_paspor,tempat_lahir,tanggal_lahir,alamat_lengkap,asal_sekolah,tahun_lulus ON public.pendaftar
FOR EACH ROW EXECUTE FUNCTION public.kdj_followup_stop_from_pendaftar();

-- Academic document upload is also authoritative evidence that registration has started.
CREATE OR REPLACE FUNCTION public.kdj_followup_stop_from_document()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_no_wa text; v_phone_local text;
BEGIN
  SELECT no_wa INTO v_no_wa FROM public.pendaftar WHERE id=NEW.pendaftar_id;
  IF v_no_wa IS NULL THEN RETURN NEW; END IF;
  IF v_no_wa ~ '^08[0-9]{8,11}$' THEN
    v_phone_local := v_no_wa;
  ELSIF v_no_wa ~ '^62[0-9]{8,11}$' THEN
    v_phone_local := '0' || pg_catalog.substr(v_no_wa,3);
  ELSE
    RETURN NEW;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_phone_local,0));
  UPDATE public.kdj_followup_profiles SET sequence_status='STOPPED',stop_reason='REGISTRATION_IN_PROGRESS',updated_at=now()
  WHERE phone_local=v_phone_local AND admin_stopped_at IS NULL AND opted_out_at IS NULL;
  UPDATE public.kdj_followup_jobs SET status='CANCELLED',stop_reason='REGISTRATION_IN_PROGRESS',updated_at=now()
  WHERE phone_local=v_phone_local AND status IN ('HELD_COMPLIANCE','SCHEDULED','PROCESSING');
  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS trg_kdj_followup_stop_from_document ON public.dokumen_pendaftar;
CREATE TRIGGER trg_kdj_followup_stop_from_document
AFTER INSERT ON public.dokumen_pendaftar
FOR EACH ROW EXECUTE FUNCTION public.kdj_followup_stop_from_document();

-- A future confirmed booking makes any pending follow-up cycle irrelevant.
CREATE OR REPLACE FUNCTION public.kdj_followup_stop_from_booking()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_phone_local text;
BEGIN
  IF NEW.status<>'Terjadwal' OR NEW.jadwal_pilihan<now() THEN RETURN NEW; END IF;
  IF NEW.no_wa ~ '^08[0-9]{8,11}$' THEN
    v_phone_local := NEW.no_wa;
  ELSIF NEW.no_wa ~ '^62[0-9]{8,11}$' THEN
    v_phone_local := '0' || pg_catalog.substr(NEW.no_wa,3);
  ELSE
    RETURN NEW;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_phone_local,0));
  UPDATE public.kdj_followup_profiles SET sequence_status='STOPPED',stop_reason='ACTIVE_BOOKING',updated_at=now()
  WHERE phone_local=v_phone_local AND admin_stopped_at IS NULL AND opted_out_at IS NULL;
  UPDATE public.kdj_followup_jobs SET status='CANCELLED',stop_reason='ACTIVE_BOOKING',updated_at=now()
  WHERE phone_local=v_phone_local AND status IN ('HELD_COMPLIANCE','SCHEDULED','PROCESSING');
  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS trg_kdj_followup_stop_from_booking ON public.jadwal_konsultasi;
CREATE TRIGGER trg_kdj_followup_stop_from_booking
AFTER INSERT OR UPDATE OF no_wa,status,jadwal_pilihan ON public.jadwal_konsultasi
FOR EACH ROW EXECUTE FUNCTION public.kdj_followup_stop_from_booking();

REVOKE ALL ON FUNCTION public.kdj_followup_stop_from_pendaftar() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.kdj_followup_stop_from_document() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.kdj_followup_stop_from_booking() FROM PUBLIC,anon,authenticated;

-- Keep delivery hard-blocked throughout this migration.
UPDATE public.kdj_followup_delivery_gate
SET delivery_enabled=false,compliance_status='BLOCKED',approved_channel=NULL,approved_by=NULL,approved_at=NULL,
    review_reference=NULL,updated_at=now()
WHERE id=1;

REVOKE ALL ON FUNCTION public.kdj_set_followup_consent(text,boolean,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.kdj_record_followup_inbound(text,text,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.kdj_record_lead_qualification_recommendation(text,text,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.kdj_admin_set_lead_qualification(uuid,uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.kdj_save_followup_conversation_state(text,jsonb,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.kdj_evaluate_followup_eligibility(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kdj_set_followup_consent(text,boolean,text,text,text,jsonb) TO postgres,service_role;
GRANT EXECUTE ON FUNCTION public.kdj_record_followup_inbound(text,text,timestamptz) TO postgres,service_role;
GRANT EXECUTE ON FUNCTION public.kdj_record_lead_qualification_recommendation(text,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.kdj_admin_set_lead_qualification(uuid,uuid,uuid,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.kdj_save_followup_conversation_state(text,jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.kdj_evaluate_followup_eligibility(integer) TO postgres,service_role;

COMMIT;
