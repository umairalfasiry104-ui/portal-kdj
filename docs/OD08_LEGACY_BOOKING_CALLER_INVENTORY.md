# OD-08 Legacy Booking Caller Inventory

**Audit date:** 2026-11-10 (Asia/Jakarta)
**Database in scope:** KDJ Staging `pgmdurnylyuqkikbwwwy`
**Status:** CLOSED FOR KNOWN CURRENT STAGING PERIMETER
**Future VPS:** Not provisioned yet, per owner; inventory again before first deployment
**Production:** No Production database or deployment configuration changed

## Scope and conclusion

Inventoried the known Portal/Bot Git repositories and local clones, the Vercel team/project/deployment surfaces, Supabase projects/Edge Functions/cron/database functions/triggers/views, and local Windows processes.

No currently provisioned external caller to the KDJ Staging database was found that still needs direct `kdj_create_booking` EXECUTE or direct DML on `jadwal_konsultasi`.

The Staging legacy bypass has therefore been revoked from `service_role`. The internal Scheduling V2 booking core remains available to the postgres-owned SECURITY DEFINER wrappers used by the Admin attested lane and RT-04 customer approval lane.

This conclusion is limited to the currently known infrastructure. The future VPS does not exist yet and is not treated as an active caller. Its Bot deployment must use a reviewed RT-04 branch and receive a new caller/permission review before being brought online.

## Caller inventory evidence

| Area | Method / evidence | Finding | Status |
|---|---|---|---|
| Portal Staging source | Inspected `app/api/admin/jadwal/route.js` on `feature/kdj-portal-work-20261109` | Admin CREATE now calls only `kdj_admin_create_booking_attested`; no direct legacy RPC in active route | PASS |
| Portal old local clone | `C:\Users\umair\kdj-portal`, branch `main`, HEAD `81f9a5f`; tracked-source grep | No tracked `kdj_create_booking` invocation in the Admin route or tracked source. Clone was left untouched because it is dirty | PASS for tracked source |
| Bot Staging source | `feature/kdj-wa-bot-work-20261109`, HEAD `8023fb0`; source grep | Active customer path uses RT-04 prepare/summary/submit/recovery RPCs; no direct `kdj_create_booking` call | PASS |
| Bot old local clone | `C:\Users\umair\kdj-wa-bot`, branch `main`, HEAD `6d0148c` | One legacy RPC invocation at `index.js:1320`; local `.env` points to `oudjeospzpiwkupfutow.supabase.co`, not Staging. Clone was left untouched because it is dirty | NOT A STAGING CALLER |
| Local Bot process | Windows process inventory on UMAIR | No active KDJ Bot runtime process observed | PASS at audit time |
| Future VPS | Owner confirmed no VPS exists yet; creation will follow project completion | No deployed VPS Bot caller to inventory today | DEFERRED FUTURE INFRA |
| Vercel project inventory | Team `umair-1286`; enumerate projects and deployments | One KDJ project `portal-kdj`; no Vercel KDJ Bot project | PASS |
| Vercel Preview | Latest deployment `dpl_864kR317sePUaA7eYzTKzBgAkXoN`; branch `feature/kdj-portal-work-20261109`; commit `0f152f9` | Preview build exists due Git integration. It is not pointed to Staging; Vercel project env points to legacy Supabase `oudjeospzpiwkupfutow` | NOT A STAGING CALLER |
| Vercel Production | Latest deployment `dpl_6qDELWXAtLiERSSp2YuwCxzVtgcf`; branch `main`; commit `b0769ee`; domain `pendaftaran.kuliahdijordan.com` | Existing Production deployment is outside the Staging caller perimeter. Its Supabase URL points to legacy project `oudjeospzpiwkupfutow` | NOT A STAGING CALLER |
| Vercel Bot deployment | Enumerated all linked projects and deployments | No Bot-specific Vercel project/deployment exists | PASS |
| Vercel environment variables | `filter_project_envs`, decrypt=false; only public `SUPABASE_URL` was read | `SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_URL` target Production/Preview/Development and resolve to `oudjeospzpiwkupfutow`. No `KDJ_ADMIN_BOOKING_HMAC_KEY` is configured in Vercel | RISK / OUTSIDE STAGING |
| Legacy Supabase project | `get_project(oudjeospzpiwkupfutow)` | Project name `portal pendaftaran kdj`, status `INACTIVE` | OWNER REVIEW REQUIRED BEFORE ANY VERCEL ENV CHANGE |
| KDJ Staging project | `get_project(pgmdurnylyuqkikbwwwy)` | `kdj-staging-v6`, status `ACTIVE_HEALTHY`; local Staging Portal/Bot envs point here | PASS |
| Supabase Edge Functions | List Edge Functions for Staging | No deployed Edge Function caller returned | PASS |
| Supabase cron | Inspect `cron.job` definitions | Follow-up eligibility cron only; no reference to the legacy booking RPC or direct booking-table DML | PASS |
| Database functions | Search function definitions referencing `kdj_create_booking` | Only the RT-04 finalizer and Admin attested wrapper call the legacy core; both are postgres-owned SECURITY DEFINER functions | PASS |
| Database triggers/views | Inspect non-internal triggers and views on booking table | Lifecycle/scheduling triggers only; no trigger or view calls the legacy RPC | PASS |
| Historical RPC statistics | `pg_stat_statements`, reset since 2026-10-31 | 10 historical direct legacy RPC calls recorded under shared `service_role`; exact originating application cannot be attributed from shared key stats | HISTORICAL; NOT CURRENT PERMISSION |
| Historical direct DML statistics | `pg_stat_statements` for DELETE on booking table | Five historical deletes were executed by role `postgres`, not `service_role` | NOT AN APPLICATION BYPASS |

## Staging cutover performed

Migration: `20261110014506_kdj_staging_revoke_legacy_booking_bypass`

The migration performed only targeted permission revokes:

- Revoked `EXECUTE` on `public.kdj_create_booking(text,text,text,timestamptz,text)` from `service_role`.
- Revoked `INSERT`, `UPDATE`, `DELETE`, and `TRUNCATE` on `public.jadwal_konsultasi` from `service_role`.
- Preserved `SELECT` on `jadwal_konsultasi`.
- Preserved `EXECUTE` on the new Admin attested RPC and RT-04 customer approval RPCs.
- Preserved postgres-owner execution of the Scheduling V2 core so the new SECURITY DEFINER wrappers can continue using it.

Post-cutover verification:

| Check | Result |
|---|---|
| `service_role` EXECUTE legacy `kdj_create_booking` | false |
| `postgres` EXECUTE core `kdj_create_booking` | true |
| `service_role` INSERT/UPDATE/DELETE/TRUNCATE booking table | all false |
| `service_role` SELECT booking table | true |
| `service_role` EXECUTE Admin attested RPC | true |
| `service_role` EXECUTE RT-04 prepare/submit RPC | true |
| Direct legacy RPC via PostgREST with service_role | HTTP 403, SQLSTATE 42501 |
| RT-04 recovery RPC after cutover | HMAC accepted; `NO_PENDING_APPROVAL` |

## Vercel risk that is deliberately unchanged

Vercel currently has 19 deployment records for `portal-kdj` (13 Production and 6 Preview). Git integration automatically creates Preview builds when feature branch commits are pushed.

The Preview and Production targets currently share the old Supabase URL `https://oudjeospzpiwkupfutow.supabase.co`, whose Supabase project reports `INACTIVE`. This URL is not the KDJ Staging project. No Vercel environment variable, alias, deployment, domain, or Supabase Production configuration was changed during this audit.

Do not use the Vercel Preview deployment for Staging UAT until the owner decides how to separate the inactive legacy project from the future Staging/Production environment configuration. The current UAT path is the local Portal environment pointed directly at `pgmdurnylyuqkikbwwwy`.

## Future VPS go-live gate

Before creating or starting the future VPS Bot:
1. Deploy only the reviewed RT-04 Bot branch or a later approved main commit containing the RT-04 customer approval service.
2. Confirm VPS `SUPABASE_URL` targets the intended environment and the dedicated `KDJ_BOOKING_APPROVAL_HMAC_KEY` matches that environment's private key row.
3. Verify no direct `kdj_create_booking` calls or direct DML on `jadwal_konsultasi` are present in deployed Bot code.
4. Re-run OD-08 against PM2/systemd/container, cron, webhook, process manager and any additional runtime/provider.
5. Keep legacy DML and RPC privileges revoked; future Bot must use RT-04 RPCs.

## Safety record

No Production project, Supabase project `oudjeospzpiwkupfutow`, Vercel env variable, Vercel alias, or deployment was modified. No VPS exists. No actual WhatsApp provider message was sent in the Staging UAT.
