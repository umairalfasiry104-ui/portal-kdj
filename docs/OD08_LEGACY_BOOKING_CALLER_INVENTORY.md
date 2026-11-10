# OD-08 Legacy Booking Caller Inventory

**Audit date:** 2026-11-10 (Asia/Jakarta)
**Target database:** KDJ Staging `pgmdurnylyuqkikbwwwy`
**Status:** PARTIAL — do not revoke legacy permissions yet
**Production:** not inspected or modified

## Purpose and cutover rule

Identify every application, scheduled process, database object and deployed runtime that can invoke `public.kdj_create_booking` or write directly to `public.jadwal_konsultasi`.

The legacy RPC EXECUTE and `service_role` table DML grants remain in place until both the VPS Bot runtime and Vercel deployments are inventoried and migrated callers are verified. This audit intentionally makes no broad revoke.

## Evidence gathered

| Area | Method / evidence | Result | Status |
|---|---|---|---|
| Portal Staging source | Search tracked source and inspect `app/api/admin/jadwal/route.js` on `feature/kdj-portal-work-20261109` | Admin CREATE was the Portal legacy caller; route now invokes `kdj_admin_create_booking_attested` only | PASS for source branch |
| Older Portal clone | `git grep kdj_create_booking` on `C:\Users\umair\kdj-portal`, branch `main`, HEAD `81f9a5f` | No tracked source invocation remains in the clone; clone is dirty and was not modified | PASS for tracked source only |
| Bot Staging source | Search tracked source on `feature/kdj-wa-bot-work-20261109`, HEAD `8023fb0` | No active Bot-side direct `kdj_create_booking` call; customer booking uses RT-04 approval RPCs | PASS for source branch |
| Older Bot clone | `git grep kdj_create_booking` on `C:\Users\umair\kdj-wa-bot`, branch `main`, HEAD `6d0148c` | One direct invocation at `index.js:1320`; associated log at 1332 and comment at 1432. Clone is dirty and was not modified | FOUND — deployment relevance unknown |
| GitHub repository scope | Enumerate accessible repositories for `umairalfasiry104-ui` | Two relevant repositories: `portal-kdj`, `kdj-wa-bot`; one unrelated repository | PASS for account-visible repositories |
| Supabase functions | Inspect function definitions referencing `kdj_create_booking` | No other database function wrapper calling legacy RPC found | PASS |
| Supabase Edge Functions | List Edge Functions for Staging project | No deployed Edge Functions returned | PASS |
| Supabase cron | Inspect `cron.job` commands | One follow-up eligibility cron; no reference to legacy RPC, booking table or service_role DML | PASS |
| Database triggers/views | Inspect non-internal triggers on `jadwal_konsultasi` and views referencing booking objects | Three lifecycle/scheduling triggers; no trigger/view invokes the legacy RPC | PASS |
| Database query statistics | Inspect `pg_stat_statements` for legacy RPC references | 17 calls across 8 query shapes; source identity is not attributable from this view | PARTIAL — usage observed |
| Grants | Check `has_function_privilege` and `has_table_privilege` for `service_role` | Legacy RPC EXECUTE and direct INSERT/UPDATE/DELETE/TRUNCATE on `jadwal_konsultasi` still exist | OPEN — intentionally unchanged |
| Local process inventory | Inspect Windows processes on device UMAIR | No KDJ Bot process observed; this does not establish remote VPS state | PARTIAL |
| VPS / process manager | No usable SSH host alias or authorized VPS shell available during this audit | Cannot inspect deployed repository, PM2/systemd/container command, environment, cron or direct SQL callers on VPS | BLOCKED — owner access required |
| Vercel | Team authorization request generated; owner approval not completed | Cannot inspect projects, production/preview deployments, deployment branch, environment variables or other deployed callers | BLOCKED — owner approval required |

## Database privilege snapshot

At the end of the Staging review:
- `service_role` can execute `public.kdj_create_booking`.
- `service_role` has direct INSERT, UPDATE, DELETE and TRUNCATE privileges on `public.jadwal_konsultasi`.
- `service_role` can execute the new `public.kdj_admin_create_booking_attested` RPC.
- `anon` and `authenticated` cannot execute the new Admin RPC.
- `service_role` cannot directly read the new Admin HMAC key or Admin audit tables.
- Bootstrap functions are no longer executable by `service_role`; PostgreSQL operator role only.

Do not infer that the two legacy grants are unused merely because the feature branch no longer calls them.

## Cutover decision

**OD-08 is not closed.** The code change and database wrapper are in place, but there is still one legacy invocation in the older Bot clone and the live VPS deployment relevance is unknown. Vercel deployment inventory is also unavailable.

Keep all legacy grants unchanged until:
1. VPS Bot code, process manager, deployed commit, runtime environment and cron/webhook callers are verified.
2. Vercel project/deployment/environment inventory is completed.
3. Every verified caller is migrated or explicitly retired.
4. Admin UAT and RT-04 customer approval UAT pass on Staging.
5. A targeted Change-Impact Review approves the exact function/table permission revokes.
6. Post-revoke regression confirms no required caller lost access.

## Next evidence required from owner

- Approve Vercel team access request, then enumerate all KDJ deployments and production/preview environment scopes.
- Provide authorized VPS inspection access (prefer a temporary SSH public key installed through the provider console; do not send passwords or private keys in chat).
- Identify any other server, scheduled task, webhook or integration that shares the Staging service_role key.

## Safety record

No Production project, schema, data, runtime, VPS or Vercel deployment was changed. No legacy permission was revoked. No booking or WhatsApp message was created by this caller inventory.
