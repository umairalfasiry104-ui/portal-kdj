# CR-CIR â€” KDJ Durable OTP & Shared Authentication Throttling

- Reference: CR-CIR-KDJ-OTP-DURABLE-SHARED-THROTTLE-v1.0
- Date: 2026-11-10
- Environment: Local / Supabase Staging only
- Status: Local implementation and Supabase Staging verification complete; browser/live OTP UAT pending. Production remains untouched.
- Change class: Security hardening / database schema and RPC change

## 1. Problem
The Portal OTP request quota, failed OTP attempt tracker, and Admin password login throttling were process-local Maps. They could be bypassed across serverless or multi-instance workers. The 60-second OTP cooldown constant and latest-OTP lookup existed but did not enforce a cooldown.

## 2. Approved behavior preserved
- Customer OTP request: maximum 4 requests per normalized phone in a fixed 10-minute window.
- Per-phone OTP request cooldown: 60 seconds.
- OTP validity remains 5 minutes.
- Wrong OTP lockout: 5 failed attempts in 10 minutes, followed by a 10-minute lockout.
- Admin login IP quota remains 20 requests per 10 minutes.
- Admin username/email password failure lockout remains 5 failures per 10 minutes.
- OTP delivery channel, WhatsApp API contract, customer data model, session contract, and Admin role model do not change.

## 3. Design
- Add server-only `public.kdj_auth_throttle_state`; store HMAC-SHA256 identifiers, not raw phone numbers, IP addresses, usernames, or emails.
- Enable RLS and revoke table privileges from PUBLIC, anon, authenticated, and service_role. Only owner-executed SECURITY DEFINER RPCs mutate/read this table.
- All SECURITY DEFINER functions use an empty search_path and fully qualified object names.
- Use PostgreSQL advisory transaction locks and row locks so concurrent workers serialize updates.
- Move OTP invalidation and issuance into one transaction.
- Move OTP compare, attempt counter, lockout and consumption into one transaction.
- Replace in-memory Admin IP/account counters with the same shared database mechanism.
- Hash identifiers with server SESSION_SECRET (or the existing server-side derived fallback); identical secret configuration is required across Portal instances.

## 4. Migration
`supabase/migrations/20261110123155_otp_durable_shared_throttle.sql` (matches applied Staging migration version `20261110123155`).

The migration creates:
- `kdj_auth_throttle_state`
- `kdj_otp_request_atomic`
- `kdj_otp_verify_atomic`
- `kdj_auth_rate_limit_consume`
- `kdj_auth_lock_check`
- `kdj_auth_lock_record_failure`
- `kdj_auth_lock_clear`

## 5. Risks and controls
- New RPC names and function arguments must match Portal code exactly.
- All Portal instances must share the same SESSION_SECRET, otherwise their HMAC keys differ and counters split.
- RPC or database failure must fail closed (return 5xx / deny request); no memory fallback.
- Existing active OTP rows remain untouched by applying the migration; a subsequent allowed OTP request atomically invalidates prior active rows and creates the new row.
- Existing process-memory counters cannot be migrated; they expire naturally after the old process lifecycle. New requests immediately use the shared DB state.
- Staging tests use synthetic identifiers and clean them up.

## 6. Rollback
Preferred rollback is application rollback to a version that continues to use the existing helpers only if the old process-local behavior is explicitly accepted as temporary risk. The database migration is additive. Do not drop the new table or functions during normal rollback while any updated Portal instance may still call them. A schema rollback, if ever approved, must first confirm all Portal deployments have reverted and then remove the new functions/table in a separate reviewed migration.

## 7. Verification gates
- RPC grants: anon/authenticated/service_role cannot directly read throttle table; only approved server RPC execution is granted to service_role.
- OTP request tests: cooldown, fixed window limit, previous OTP invalidation, and concurrent request serialization.
- OTP verification tests: wrong attempt count, 5th failure lockout, expired/wrong code, successful atomic consume, replay blocked, failure reset.
- Admin login tests: shared IP limit and durable account failure lockout.
- Portal: OTP security unit tests, all existing tests, lint, production build.
- Staging: SQL transaction tests and security advisors.
- Live customer OTP + Browser UAT is still required after local environment reload.

## 8. Release impact
This change is a release-security prerequisite. It is Staging/local only in this work. No Production environment variables, Production database, commit, push, or deployment are included.

## 9. Completion evidence â€” 10 November 2026

- The Portal security module no longer contains `rateLimitStore`, `otpAttemptStore`, or the Map-based OTP brute-force helpers. OTP request and verification call the HMAC-keyed PostgreSQL RPCs and fail closed on RPC errors.
- Request route invalidates the exact issued OTP after Bot send failure and checks the Supabase update result.
- Local regression: `npm run test:otp` PASS; all Portal `scripts/test-*.mjs` PASS (12/12); lint PASS (0 errors, 5 existing image warnings); Next.js production build PASS (19/19 pages); `git diff --check` PASS.
- Staging transaction regression passed: cooldown, request quota, previous OTP invalidation, fifth-failure lockout, correct-code blocking during lockout, one-time consume, replay denial and shared Admin lock/rate-limit RPCs. Synthetic rows rolled back.
- Post-test Staging check: throttle rows 0, active OTP rows 0, OTP rows in the last hour 0. RLS enabled; direct throttle-table SELECT denied to anon/authenticated/service_role; approved OTP RPC execution granted only to service_role/postgres.
- Local migration file is named `20261110123155_otp_durable_shared_throttle.sql`, matching the single applied Staging migration record.
- Report: `docs/OTP_DURABLE_REMEDIATION_2026-11-10.md`.

Browser/live applicant OTP UAT remains a release gate. No real OTP was sent during this regression. Production remains untouched; no commit, push or deployment was performed.

## 10. P1 item 5 â€” multi-process concurrency completion evidence (10 November 2026)

**Status: CLOSED for local Portal + Supabase Staging implementation and concurrency verification.**

The configured shared rate-limit paths are:
- Customer OTP request IP: 20 requests per 10-minute fixed window.
- Customer OTP verification IP: 20 requests per 10-minute fixed window.
- Admin password login IP: 20 requests per 10-minute fixed window.
- Customer OTP request per phone: 60-second cooldown and 4 requests per 10-minute fixed window.
- Customer OTP failure: 5 attempts within 10 minutes, followed by a 10-minute lockout.
- Admin account failure: 5 attempts within 10 minutes, followed by a 10-minute lockout.

The 10-minute request quotas use **fixed windows**, not a sliding/rolling event window.

The new `scripts/test-otp-concurrency-staging.mjs` test uses two independent Node.js child processes, separate Supabase clients, and the same configured HMAC derivation. Staging results:
- 12 simultaneous shared-rate-limit calls: exactly 4 allowed / 8 denied at a limit of 4.
- 10 simultaneous requests for one synthetic phone: exactly 1 OTP issued / 9 `COOLDOWN`.
- 10 simultaneous account-failure increments: shared durable lockout confirmed by a separate RPC.
- Both processes derived an identical HMAC key for each shared test identity.
- `npm run test:otp`: PASS; static test checks the request, verify and Admin login rate-limit call sites and the two-process test harness.

After testing, 1 synthetic OTP row and 3 synthetic throttle rows were deleted. Post-cleanup Staging counts: 0 matching test OTP rows, 0 matching test throttle rows, 0 total throttle-state rows. RLS/ACL checks remained as specified: direct throttle-table SELECT denied to anon/authenticated/service_role; service_role RPC execution allowed only as approved.

The test script prints cleanup selectors before it writes test state; any future rerun must perform the corresponding cleanup SQL after completion. Production and deployed Vercel environments were not tested. Identical SESSION_SECRET (or the existing identical server-side fallback) remains a pre-deployment requirement across every application instance. Live browser/WhatsApp OTP UAT remains outside this P1 concurrency checkpoint.
