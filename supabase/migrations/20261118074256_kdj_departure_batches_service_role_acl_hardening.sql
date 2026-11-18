-- Revoke database default DML grants from service_role for departure-wave tables.
-- All writes must go through SECURITY DEFINER RPCs that validate active Super Admin identity.
BEGIN;

REVOKE ALL ON TABLE public.kdj_departure_batches FROM service_role;
REVOKE ALL ON TABLE public.kdj_departure_batch_events FROM service_role;

GRANT SELECT ON TABLE public.kdj_departure_batches TO service_role;
GRANT SELECT ON TABLE public.kdj_departure_batch_events TO service_role;

COMMIT;
