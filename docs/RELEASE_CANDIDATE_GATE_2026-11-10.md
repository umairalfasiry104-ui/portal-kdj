# KDJ Release Candidate Gate — 10 November 2026

**Scope:** Local source + Supabase Staging only.  
**Production:** Not modified. No Vercel deployment or VPS deployment performed.  
**Authority:** Master System Specification v1.0 remains frozen; all scope changes must follow CR/CIR.

## Executive status

**NOT READY FOR RELEASE.** Core Portal build, Portal Akta and Daily Report API/Storage tests, approved Markdown, Bot automated suites, RT04 synthetic service contracts, Staging legacy booking cutover and Admin-attested booking UAT have evidence of passing. The OTP distributed-throttle/cooldown checkpoint is closed on Staging with two-process concurrency evidence. Controlled internal Staging RT04 SETUJU/BATAL and Bot WhatsApp READY/heartbeat are verified; the RT04 PREPARE calendar-validation finding is closed by migration 20261110172031. Dedicated non-Admin customer-controlled RT04 qualification, applicant/browser OTP journey, Daily Report browser/clipboard UAT, and Production deployment prerequisites remain open.

## P0 — release gates

| Workstream | Evidence / current result | Gate |
|---|---|---|
| Passport follow-up workflow | Applicant Portal Passport tile removed; applicant upload API no longer accepts paspor; runtime request returns HTTP 400; legacy/Admin read support retained; initial final-submit does not require Passport; Admin Human personal WhatsApp handoff confirmed | IMPLEMENTED + API NEGATIVE TEST PASS; channel confirmed |
| Akta Kelahiran | Missing Akta blocks final submission (HTTP 400); upload persisted to private Staging Storage and dokumen_pendaftar; Admin Verifikator can retrieve signed record; synthetic UAT data cleaned | API/STORAGE UAT PASS; real OTP/browser and successful submit path remain pending |
| Daily Report | Super Admin and Admin Konsultan receive HTTP 200 with non-empty report; Admin Verifikator receives HTTP 403; unauthenticated receives HTTP 401; contract test passes | API/RBAC UAT PASS; browser rendering and clipboard UAT pending |
| RT04 customer WhatsApp consent | Automated RT04 + controlled Staging SETUJU and second-pending BATAL pass; exact same-message replay covered by automated contract; PREPARE policy preflight fixed in migration 20261110172031 | PASS WITH FOLLOW-UP / STAGING ONLY — dedicated non-Admin customer-controlled UAT and live exact replay are not claimed; overall RC remains blocked by other gates |
| Markdown approval | Prompt 01–05 are approved/effective 2026-11-10; 02/03/04/05 updated for Admin Human Passport handoff; all six final Bot suites passed | APPROVED + REGRESSION PASS |
| Portal build | Next.js 16.4.3 production build after Passport workflow change: compile PASS, TypeScript PASS, 19/19 static pages, all app/API routes generated, exit code 0 | PASS |

### Scope note — Passport

- Applicant Passport file is not uploaded in Portal.
- Passport remains a deferred requirement no later than H-45 before departure and is sent to Admin Human's personal WhatsApp number after registration; Admin Human gives the number directly to the applicant.
- Applicant upload endpoint rejects Passport files.
- Existing/Admin Passport records remain readable through the Admin academic-document read path.
- Minje/Bot must not request or receive the passport file through automated WhatsApp.
- Handoff channel is Admin Human's personal WhatsApp number, given directly by Admin Human after registration. The Bot inbox is not a document-receiving channel.

### RT04 live-test prerequisites

The real customer approval test must use a dedicated customer-controlled test number, not an Admin identity or an unrelated existing applicant. A human customer must send the exact approval command; consent must not be fabricated by the test harness. The Bot WhatsApp process must first be stable at READY. The operator has reserved Bot readiness repair; this gate does not claim it is resolved.

## P1 — Staging UAT data cleanup

**Status: COMPLETED — Supabase Staging only, 10 November 2026.**

Pre-cleanup snapshot:
- public.pendaftar: 5; public.dokumen_pendaftar: 8; public.jadwal_konsultasi: 6; public.booking_notification_outbox: 9.
- public.kdj_bot_activity_events: 2; public.kdj_followup_profiles: 5; public.kdj_followup_jobs: 3.
- public.kdj_lead_qualifications: 5; public.kdj_lead_qualification_events: 49.
- public.kdj_system_heartbeats: 37; public.kdj_system_incidents: 2; public.otp_auth: 36.
- private.booking_customer_approvals: 2; private.kdj_booking_attestation_nonces: 7; private.kdj_admin_booking_audit: 3.
- public.admins: 3 active Admin accounts; both HMAC key-custody tables: 1 row each.

Cleanup execution:
- Removed **189 transactional/UAT/audit/OTP/heartbeat/incident rows** across the listed business and operational event tables using one guarded database transaction with dependency-aware delete order.
- Removed **12 objects** from the Staging berkas_kdj bucket via Storage API. The bucket itself remains present and empty.
- Cleared booking/outbox, applicant/document, follow-up, lead qualification, Bot activity, heartbeat/incident, OTP, approval, nonce, Admin lifecycle audit and Admin booking audit records.
- Reset kdj_bot_reporting_config.ledger_enabled_at to NULL so a new Daily Report coverage window starts with the next event after the reset.

Post-cleanup verification:
- public.admins: **3 rows, all active**.
- public.pendaftar, dokumen_pendaftar, jadwal_konsultasi, booking_notification_outbox, follow-up/qualification tables, incident/heartbeat, OTP and the deleted private event/audit tables: **0 rows**.
- Storage berkas_kdj: **0 objects**.
- Preserved: private Bot and Admin HMAC key-custody rows (1 each), public kdj_bot_reporting_config (1), kdj_system_controls (1), kdj_followup_delivery_gate (1), all schemas/functions/ACLs and migration history.
- auth.users was already 0 and remains 0.
- No schema/table was dropped. Production was not touched.

The reset leaves the required three Admin accounts and system configuration/key custody intact while clearing Staging business/test content.

## P1 — documentation

- RT04 customer approval architecture document has a dated Staging status addendum correcting stale pre-cutover statements.
- RT04 Admin attested lane document now distinguishes completed Staging cutover from untouched Production.
- RT04 Staging UAT report includes the new Akta and Daily Report API/Storage UAT outcomes and their limitations.
- Daily Report CR/CIR includes role/API UAT results and notes that browser clipboard UAT remains pending.
- Akta CR/CIR includes the owner’s Passport handoff clarification; a dedicated Passport Admin Human handoff CR/CIR records its Portal/API/Markdown impact and verification.
- This consolidated gate is the current release summary. Historical UAT evidence narratives remain in the documentation; Staging transactional and audit test rows were subsequently cleared in the P1 reset below.

## Deployment and environment blockers

- Vercel Preview and Production variables were previously found pointing to the legacy Supabase project oudjeospzpiwkupfutow, reported INACTIVE in the OD-08 inventory. They have not been changed here.
- Vercel KDJ_ADMIN_BOOKING_HMAC_KEY was not configured in that inventory; its current status requires a fresh pre-deployment verification.
- WA_BOT_API_URL host remains unverified from available variable metadata.
- No Bot VPS provisioned; no Bot production deployment.
- Production Supabase target, secrets/key parity, domain, Portal environment, and Bot service environment must be reviewed before any deployment.

## Evidence and change control

- Portal Akta/Passport contract: PASS.
- Portal Daily Report contract: PASS.
- Portal qualification/follow-up contract tests: PASS.
- Portal ESLint: 0 errors; 5 existing no-img-element warnings.
- Portal git diff --check: PASS (line-ending warnings only).
- Portal production build after Passport UI/API changes: PASS.
- Bot check, baseline, scheduling, qualification, daily-report and RT04 automated suites: PASS in the final regression run after the Passport SOP/KB patch.
- Synthetic Akta/Daily Report API test applicant and document Storage objects were deleted; baseline applicant/document/booking/Admin counts returned unchanged.
- Passport upload negative-test applicant was deleted; no Passport file was stored.
- Git worktrees remain modified/uncommitted; no broad staging, commit, push, or deployment performed.

## Final disposition

**Staging RC remains BLOCKED.** The P1 Staging data reset is complete. Do not declare the system release-ready until the live customer RT04 WhatsApp approval flow, stable Bot readiness, final applicant/browser UAT, Daily Report browser/clipboard UAT, Passport Admin Human channel, and Production environment/deployment gates are closed with evidence.


## Final regression addendum — 10 November 2026

- Runtime applicant Passport upload rejection: PASS (HTTP 400); temporary test applicant deleted; no Passport file object created.
- Final Portal build after the Passport Portal tile/API removal: PASS (Next.js 16.4.3, TypeScript PASS, 19 static pages, exit code 0).
- Final Bot regression after prompt revisions: all six commands PASS — check, test:baseline, test:scheduling, test:qualification, test:daily-report, test:rt04.
- Portal lint remains PASS with 0 errors / 5 pre-existing img warnings; Portal diff check exit code 0.

The live WhatsApp customer-consent UAT and Bot READY incident remain pending; synthetic RT04 tests do not substitute for customer action.

 
---

## Folder-wide audit addendum — 10 November 2026

See `docs/FOLDER_AUDIT_2026-11-10.md` for complete evidence.

- Portal automated tests: 11/11 PASS; Bot automated tests: 14/14 PASS after correcting two stale test-harness assumptions (approved prompt metadata and current RT04 migration filename).
- Portal production build: PASS, Next.js 16.4.3, TypeScript PASS, 19/19 static pages; ESLint 0 errors / 5 existing image warnings.
- **P0 configuration:** Portal and Bot local `WA_BOT_API_KEY` values do not match. Portal sends this value as `x-api-key`; Bot compares it to its configured internal API key. No `INTERNAL_API_KEY` fallback is present in the inspected Bot env file. Align the key and verify a protected Portal-to-Bot request before OTP/final-submit UAT sign-off.
- **P1 security:** Bot `npm audit --omit=dev` reports 11 high and 5 moderate production dependency advisories, with no automatic fix reported.
- **P1 security:** Portal OTP route's declared 60-second cooldown is not implemented; request/failed-attempt limits are process-local and not shared across instances.
- Confirmed Passport handoff channel: Admin Human's personal WhatsApp number, given directly by Admin Human; Bot inbox is not a receiving channel.
- Supabase Staging key IDs and environment project refs match; three Admin accounts and required singletons remain after reset.
- Current local Portal Bot URL is loopback and is not a Production/Vercel Bot endpoint.
- No commit, push, deployment, or Production changes performed.

## P1 OTP gate addendum — 10 November 2026

**P1 OTP shared throttling + real 60-second cooldown: CLOSED for Staging implementation and concurrency evidence.**

Evidence: all three API entry points (OTP request, OTP verify, Admin password login) use the shared database-backed rate limiter; per-phone OTP cooldown and quota are enforced atomically. Two independent Node.js processes generated identical HMAC keys and exercised the same Staging database concurrently. Results were 12 shared limiter requests → 4 allowed/8 denied, 10 same-phone OTP requests → 1 issued/9 COOLDOWN, and 10 account-failure increments → durable shared lockout confirmed. Test rows were cleaned (1 OTP + 3 throttle rows); follow-up counts were zero.

The 10-minute request quotas are fixed windows. This is a Staging multi-process test, not a deployed Vercel test. All deployed Portal instances must share the same SESSION_SECRET or the existing shared server-side fallback.

This P1 closure does **not** unblock release by itself. The overall RC remains blocked by the outstanding P0 Bot/API configuration and readiness, live applicant/browser WhatsApp OTP journey, RT04 customer-consent UAT, Daily Report UI UAT, and Production environment/deployment checks. No Production change, commit, push, or deployment was made.

## Runtime activation addendum — Bot dependency and WhatsApp READY (10 November 2026)

**Local Staging Bot activation: PASS.** This supersedes earlier entries that described the dependency graph as inactive or the Bot WhatsApp readiness as pending.

- Main Bot installation now uses the remediated lockfile.
- Security audit: 0 vulnerabilities; 207 registry signatures and 30 attestations verified.
- Bot tests: 14/14; baseline and syntax checks pass.
- Puppeteer 25.16.0 / Chromium 156.0.8078.47 launch smoke passes.
- Bot PID 18436 reached WhatsApp READY with WhatsApp Web runtime 2.3000.1053914165. Two heartbeat cycles confirm bot_process OK, Supabase OK, WhatsApp OK/READY.
- Portal-configured API key passed Bot middleware using a safe invalid payload check; no outbound WhatsApp test message was sent.

The overall RC remains blocked: fresh inbound chat UAT, Outbox send after dependency activation, live RT04 customer SETUJU/replay/BATAL, applicant real-OTP/browser flow, Daily Report UI/coverage, and Production target/infrastructure prerequisites remain open. This is local Staging only; no VPS/Production activation or deployment occurred.

## STG-05 / STG-06 live runtime update — 10 November 2026

This addendum supersedes the activation note that listed fresh inbound chat and Outbox send-after-restart as still pending:

- STG-05 inbound: controlled handset suffix 1604 generated CUSTOMER_INBOUND at 23:09:11 WIB and BOT_REPLY at 23:09:22 WIB. Bot LID resolution succeeded. Lead-qualification timed out on the same message; chat reply was recorded.
- STG-06 Outbox: Admin-attested synthetic booking was sent to the internal test handset. BOOKING_CREATED and subsequent BOOKING_CANCELLED both reached SENT with provider message IDs and one attempt each. Test booking ended Batal. Global Outbox has 2 SENT / 0 nonterminal events; no open incident.
- UAT-07 remains open and requires the controlled handset to perform the RT04 booking approval flow. Per the approved architecture, BATAL cancels a pending approval only; it must not cancel a CONSUMED booking. Test BATAL on a second pending approval and use the Admin lane to clean up the first created test booking.

## UAT-07 live SETUJU evidence update — 10 November 2026

Live controlled RT04 approval by handset suffix 1604 reached `CONSUMED` with `approval_command=SETUJU`. Exactly one booking (Zoom, 12 November 2026 10:00 WIB, 120 min + 30 min buffer) and exactly one `BOOKING_CREATED` Outbox event were linked. Booking remains `Terjadwal`; Outbox reached `SENT` with provider_message_id in one attempt. Global Staging Outbox was 3 SENT / 3 provider IDs; latest Bot process, Supabase and WhatsApp heartbeats were OK/READY; incident table empty.

UAT-07 is now **PARTIAL**: live SETUJU flow passed; exact same-provider-message replay remains supported by existing automated contract tests (not repeated live); pending-approval `BATAL` still requires a second pending request and an operator-originated command. `BATAL` must not be tested against the already CONSUMED booking. No Production activity.


## UAT-07 closure update — live BATAL verified; policy follow-up recorded (10 November 2026)

- Live second approval from controlled handset suffix 1604: approval `de8170ca-c705-4cc0-9d58-dfe371e20dff`, name `Bejo`, Offline, requested 14 November 2026 09:00 WIB.
- Inbound BATAL at 23:30:35.279 WIB; approval reached `CANCELLED` at 23:30:37.006 WIB; Bot reply event at 23:30:37.446 WIB.
- Cancellation row has no booking_id or notification_event_id; DB cross-check found zero booking rows for that approval.
- Earlier SETUJU request remains one `CONSUMED` approval → one `Terjadwal` booking → one `BOOKING_CREATED` Outbox event `SENT`. Exact same-provider-message replay is covered by automated RT04 contract tests, not repeated live.
- Global Staging Outbox: 3/3 SENT, 0 nonterminal/failed. Bot process, Supabase, and WhatsApp READY heartbeats OK; no open incidents.
- **Follow-up finding:** the cancelled request used Saturday 14 November (ISO weekday 6). `kdj_prepare_booking_approval` does not enforce weekday/working-hours/H-1/slot validation before sending its summary. `kdj_create_booking` enforces Monday–Friday, business hours and H-1 at finalization, so the invalid booking is still blocked at commit; however, an unbookable summary can reach the customer. Review a minimal correction under the existing frozen Scheduling V2 rules; do not expand business scope.
- The first SETUJU test booking remains `Terjadwal`; no Admin cleanup was executed. BATAL on the second pending approval must not cancel the first consumed booking.
- No source/schema/migration changes, commit, push, deployment, or Production activity.

**Disposition:** UAT-07 = **PASS WITH FOLLOW-UP / STAGING ONLY**. Overall Release Candidate remains **NOT READY** pending the independent applicant/browser, Daily Report UI, Production readiness, and the newly recorded PREPARE validation gap.


## RT04 PREPARE Scheduling V2 preflight fix — 11 November 2026

**Status: CLOSED / STAGING ONLY.** The original PREPARE RPC could send a summary for a closed day or out-of-hours slot even though final booking creation would reject it. Migration `20261110172031_rt04_prepare_schedule_policy_validation` now applies the existing H-1, Monday–Friday, 09:00–17:00 WIB, and 150-minute active-slot-overlap checks before creating a PREPARED approval. The final `kdj_create_booking` transaction remains authoritative for race safety.

Signed HMAC integration against Staging passed five cases:
- Same-day 11 Nov 2026 10:00 → `BOOKING_REQUIRES_PREVIOUS_DAY`.
- Saturday 14 Nov 2026 09:00 → `CLOSED_DAY`.
- Friday 13 Nov 2026 08:00 → `OUTSIDE_WORKING_HOURS`.
- Active booking overlap (12 Nov 2026 10:00) → `SLOT_UNAVAILABLE`.
- Valid Friday 13 Nov 2026 10:00 → `PREPARED` (positive control; no summary sent).

Temporary positive-control approval and all five HMAC nonce rows were deleted. Verification found 0 test approvals/nonces remaining, booking count unchanged at 2, Outbox 3 SENT / 0 nonterminal. Bot `npm run check`, `npm run test:rt04`, `npm run test:scheduling`, and diff check passed.

Bot response handling was updated and Bot restarted safely after Puppeteer Browser.close. Final PID 25136, API listener 127.0.0.1:3001, WhatsApp Web 2.3000.1053925913 READY, Bot/Supabase/WhatsApp heartbeats OK. LocalAuth profile preserved. Production untouched; no commit/push/deployment.


## Retest update — 11 November 2026, 03:15 WIB

- Automated Portal regression suite: PASS, including OTP durable contract, Akta requirement, applicant session identity, RBAC, Daily Report, scheduling/outbox and lifecycle contracts. Lint has 0 errors and 5 existing image-optimization warnings.
- Automated Bot regression suite: PASS, including Daily Report event recording, RT04, scheduling/outbox, identity and safe retry. Production dependency audit: 0 vulnerabilities; 207 signatures and 30 attestations verified.
- Live two-process Staging OTP concurrency: PASS (rate limiter 4/12 allowed, OTP cooldown 1/10 issued, shared lockout persisted). All 4 synthetic OTP/throttle records deleted and post-cleanup count is zero.
- Staging snapshot: 2 applicants (both `draft_berkas`), 0 document rows, 0 payment-proof references, 0 private-bucket objects; Outbox 3 SENT / 0 attention; 0 open incidents. Current Portal/Bot/Supabase/WhatsApp heartbeats OK; Gemini heartbeat stale.
- Daily Report component/date/coverage/text/clipboard evidence remains PASS, but live Admin-role browser sessions are still required to close Super Admin/Admin Konsultan allow and Admin Verifikator deny qualification.
- Live applicant OTP → biodata → Akta → payment proof → final submit → Bot correlation remains BLOCKED / NOT RUN until a dedicated applicant-controlled Staging WhatsApp number is available. Synthetic concurrency is not customer delivery evidence.

**Final RC disposition after retest: NOT READY FOR RELEASE.** Automated regression passed, but live applicant end-to-end UAT, real Admin role-session validation and fresh Gemini smoke/heartbeat remain open release qualifications. This is Staging qualification only; no deploy, Production change, merge, push or commit is authorized or performed.
