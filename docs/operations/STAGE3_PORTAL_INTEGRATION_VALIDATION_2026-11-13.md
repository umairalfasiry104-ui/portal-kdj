# Stage 3 — Portal Integration Validation
Date: 13 November 2026
Project: KDJ Portal + Daily Business Report v2
Environment: Local Portal build; local source checkout; no authenticated Supabase UAT
Base commit observed: `d4d583ce6dc6e4521a0838680b9dd5e248522853`

## Disposition

**PARTIAL PASS — source/contract checks, lint, production build, and unauthenticated HTTP authorization checks passed. Authenticated role UAT remains blocked by environment isolation.**

No Portal source code was edited in this validation. The Portal worktree was already dirty when Stage 3 began; no files were staged, committed, reset, stashed, or cleaned.

## Evidence Ledger

| Evidence ID | Requirement / risk | Method | Result | Environment / date | Status and rationale |
|---|---|---|---|---|---|
| STG3-PORTAL-01 | Manual report flow remains separate from v2 durable snapshot/delivery flow | Inspected `app/api/admin/reports/daily/route.js`, `AdminDailyReportPanel.jsx`, recovery route, and approved CR/CIR v2.0 | Manual preview/copy calls the existing `kdj_get_bot_daily_report_stats` RPC. Recovery reads v2 delivery rows and calls retry/reconcile RPCs. CR/CIR v2.0 explicitly retains manual Portal view/copy as fallback. | Local source, 2026-11-13 | PASS — separation is intentional, not an accidental endpoint mismatch. |
| STG3-PORTAL-02 | Report tab is limited to eligible roles; recovery UI is Super Admin-only | Inspected `app/admin/page.js`, panel props, recovery API, and ran `node scripts/test-admin-daily-report-recovery.mjs` | Report panel mount allowlist is Super Admin/Admin Konsultan; `isSuperAdmin` is derived from authenticated dashboard role. Recovery API independently calls `requireAdminSession` and verifies role Super Admin. Contract test passed. | Local source, 2026-11-13 | PASS — source and contract evidence; not a live role session. |
| STG3-PORTAL-03 | Manual report contract: WIB date selection, summary, coverage note, clipboard, no Portal auto-send | Ran `node scripts/test-daily-reporting-contract.mjs`; reviewed manual report route and panel | Contract passed. Route validates date and uses the existing v1 stats RPC. Panel performs manual clipboard copy and states no auto-send. | Local source, 2026-11-13 | PASS — static contract evidence. |
| STG3-PORTAL-04 | Three-role permission boundaries remain intact | Ran `node scripts/test-admin-rbac.mjs` | Three-role RBAC contract passed. | Local source, 2026-11-13 | PASS — source-contract level. |
| STG3-PORTAL-05 | Payment/report migration Portal contract remains intact | Ran `node scripts/test-registration-payment-progress-contract.mjs` | All declared registration/payment/progress and Daily Report v2 source contracts passed. | Local source, 2026-11-13 | PASS — source-contract level. |
| STG3-PORTAL-06 | Portal lint quality | Ran `npm run lint` | Exit code 0; 0 errors; 5 existing `@next/next/no-img-element` warnings. | Local Portal, 2026-11-13 | PASS with existing warnings; no lint errors. |
| STG3-PORTAL-07 | Production compilation and route registration | Ran `npm run build` | Next.js 16.4.3 compiled successfully; TypeScript completed; 23/23 static pages generated; both `/api/admin/reports/daily` and `/api/admin/daily-report/recovery` registered as dynamic routes. | Local Portal, 2026-11-13 | PASS. |
| STG3-PORTAL-08 | Unauthenticated callers cannot access report/recovery APIs | Started local production server on 127.0.0.1:3001 and sent requests without cookies | Manual report GET = HTTP 401; recovery queue GET = HTTP 401; recovery action POST = HTTP 401. | Local Portal production build, 2026-11-13 | PASS — rejected by the session guard before any report/recovery data operation. |
| STG3-PORTAL-09 | Retry delivery remains disabled by default | Inspected Bot `lib/admin-daily-report-delivery.js`, `index.js`, and Bot `.env` without printing secrets | `isAdminDailyReportDeliveryEnabled` returns true only when the variable equals `true`; Bot `.env` does not define it. The worker logs that it remains inactive unless explicitly enabled. | Local Bot, 2026-11-13 | PASS — code default OFF and config UNSET. |
| STG3-PORTAL-10 | No unintended whitespace/source-tree changes from validation | Ran `git diff --check` and compared before/after `git status --short` | `git diff --check` passed. Existing dirty worktree entries remained; no staging/commit/cleanup was performed. | Portal worktree, 2026-11-13 | PASS — only existing modifications/untracked files remain visible. |
| STG3-PORTAL-11 | Authenticated role UAT must target the intended test database, not Staging by accident | Inspected only Supabase URL host and key presence in Portal `.env.local`; secret value not read/displayed | `NEXT_PUBLIC_SUPABASE_URL` points to `pgmdurnylyuqkikbwwwy.supabase.co`; service-role key is present. This is the hosted Staging project, not the local PostgreSQL clone. | Local Portal config, 2026-11-13 | BLOCKED by environment boundary — no authenticated Admin session test was run to avoid reads/writes against hosted Staging without separate authorization. |

## Findings

1. The existing manual Bot→Human activity report is still a fallback view/copy flow and uses the existing v1 reporting RPC. This matches the approved CR/CIR v2.0 decision to preserve the existing manual Portal report as fallback.
2. The v2 durable business report and per-Admin delivery/recovery ledger are a separate path. Portal recovery only lists FAILED/UNKNOWN rows and calls dedicated reconciliation/retry RPCs. The Portal itself does not call WhatsApp send APIs.
3. UI visibility is not relied upon as the security boundary: the recovery API checks the fresh admin session and Super Admin role server-side.
4. Unauthenticated HTTP checks passed. They do not prove the allowed/denied responses for authenticated Admin roles, report data correctness against a live environment, clipboard behavior in a real role session, or recovery actions end-to-end.
5. Portal `.env.local` is wired to hosted Staging. Do not use authenticated local Portal UAT against this configuration until a separate Staging UAT authorization is given or a dedicated local Supabase/API environment is configured.

## Remaining Stage 3 UAT — not yet executed

| UAT ID | Role | Required verification | Expected result |
|---|---|---|---|
| STG3-UAT-01 | Super Admin | Open Daily Report tab; generate an allowed completed report date; inspect coverage and all summary fields; copy report text | Report loads; coverage limitation is explicit; clipboard text matches rendered report; recovery section is visible. |
| STG3-UAT-02 | Admin Konsultan | Open Daily Report tab; generate/copy a report; try direct recovery GET/POST | Manual report works; recovery panel is absent; direct recovery API is denied (403). |
| STG3-UAT-03 | Admin Verifikator | Check dashboard navigation and call manual report endpoint | Report tab is absent; direct report API is denied (403). |
| STG3-UAT-04 | Unauthenticated | Directly call both report APIs | Already executed: report GET, recovery GET and recovery POST returned 401. |
| STG3-UAT-05 | Super Admin | Validate recovery list/actions using controlled FAILED/UNKNOWN fixtures on the approved test target | Only masked recipient is shown; UNKNOWN is reconciled before retry; each action records reason/audit; no live WA send occurs during UAT. |

## Environment / safety boundary

- No migration was applied to hosted Staging or Production.
- No Cron job or Staging setting was changed.
- No Bot process was started or restarted.
- No WhatsApp message was claimed or sent.
- The local production server used for HTTP checks was stopped after testing.
- Delivery feature flag remains unset in the Bot `.env`; do not enable it in this stage.
- No source changes were made as part of Stage 3 validation. The evidence file itself is a new local documentation artifact and is intentionally left unstaged.

## Exit decision

Stage 3 is **not fully closed**. Source/contract/build/authentication checks are passed. Authenticated Super Admin, Admin Konsultan, and Admin Verifikator UAT is the remaining gate and must be performed against a dedicated local API environment or under explicit Staging UAT authorization.

## 2026-11-13 — Staging DB migrations applied and verified

Database deployment has progressed beyond the earlier Stage 3 preflight:
- Migration versions 20261112132800 and 20261112132807 are both recorded in the remote Staging migration history.
- Supabase CLI v3.1.0 dry-run listed only these two pending migration files; actual push finished successfully with exit code 0.
- Post-deploy catalog verification: 11/11 tables present with RLS enabled; 15/15 functions present with SECURITY DEFINER and search_path=""; service_role EXECUTE true, anon/authenticated EXECUTE false; no anon/authenticated direct SELECT to the new tables.
- Both expected triggers exist.
- Three Cron jobs are active: original Follow-up job preserved, payment expiry every five minutes, Daily Admin Report generation at 01:00 GMT / 08:00 WIB.
- New ledger tables are empty except the singleton reporting config row (count=1).
- The Bot Admin report delivery feature flag remains unset/default OFF; no Bot was started and no WhatsApp message sent.

Advisor follow-up:
- 35 INFO RLS-enabled/no-policy findings, an increase of 11 exactly corresponding to the new server-only tables.
- 13 INFO unindexed FKs (2 baseline + 11 candidate objects), 17 unused indexes (5 baseline + 12 new/unexercised).
- Health advisor returned no lints.

Updated gate:
- Staging database migration deployment: PASS.
- Stage 3 authenticated Portal integration/role UAT: OPEN.
- Fresh Bot/WhatsApp live runtime evidence: OPEN.
- Team UAT: NOT STARTED.

## 15. Post-deployment runtime evidence and current UAT gate — 13 November 2026

A fresh read-only query after both migrations returned the latest heartbeat records unchanged from the 11 November observations:
- bot_process OK — 2026-11-11 15:42:21 UTC
- Gemini OK — 2026-11-11 14:51:49 UTC
- Portal OK — 2026-11-11 15:14:18 UTC
- Supabase OK — 2026-11-11 15:42:22 UTC
- WhatsApp OK — 2026-11-11 15:42:22 UTC

These observations are stale by approximately two days and do not prove current live runtime readiness. Bot/WhatsApp has not been started or restarted during this migration task. The existing booking_notification_outbox remains 3 SENT rows.

Current decision:
- Staging DB schema deployment: PASS.
- Fresh runtime heartbeat: OPEN / STALE.
- Authenticated Portal role UAT: OPEN.
- Bot/WhatsApp integration UAT: OPEN.
- Supervised live team UAT: NOT STARTED.

Proceed with Portal authenticated role UAT using synthetic applicant/test documents. Do not treat the old heartbeat OK values as a live-system health pass. Keep Admin Report delivery OFF and avoid real WhatsApp or real payment activity until separately authorized.
