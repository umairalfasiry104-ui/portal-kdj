CREATE INDEX IF NOT EXISTS idx_kdj_lead_qualifications_confirmed_by
  ON public.kdj_lead_qualifications (confirmed_by)
  WHERE confirmed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kdj_lead_qualification_events_actor_admin
  ON public.kdj_lead_qualification_events (actor_admin_id)
  WHERE actor_admin_id IS NOT NULL;