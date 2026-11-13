# KDJ Portal â€” Durable OTP Protection Remediation

**Date:** 10 November 2026
**Scope:** Local Portal + Supabase Staging only
**Result:** Durable OTP request/verification controls implemented and verified. Browser/live OTP UAT remains pending.

## Executive result

The customer OTP request and verification flow no longer depends on process-local Maps. Quota, cooldown, failed-attempt counters, lockout, OTP invalidation and one-time consumption are enforced in PostgreSQL transactions through SECURITY DEFINER RPCs.

The Portal has no process-local OTP brute-force fallback. If the throttle/verification RPC is unavailable, the request fails closed.

## Implemented changes

### Portal code

- `lib/security.js`
  - Added HMAC-SHA256 throttle identifiers derived from the server-side `SESSION_SECRET` or its existing server-side fallback.
  - Added a central RPC wrapper that treats database errors as failures, never as permission to continue.
  - `requestOtpAtomically()` calls `kdj_otp_request_atomic`.
  - `consumeOtpAtomically()` calls `kdj_otp_verify_atomic`; a correct code, attempt count, lockout and one-time consume are decided inside one database transaction.
  - Removed the process-local `rateLimitStore`, `otpAttemptStore`, and their legacy Map-based OTP helpers.
  - Retained the shared authentication RPC wrappers required by the existing Admin login route; the separate shared rate-limiter item remains tracked independently.
- `app/api/auth/request-otp/route.js`
  - Uses the atomic issuance helper.
  - Checks the database result when invalidating an issued OTP after Bot delivery failure. An invalidation error is not silently ignored.
- `app/api/auth/verify-otp/route.js`
  - Continues to call `consumeOtpAtomically()`; it now receives the durable RPC result and returns its status/message.

### Database and test files

- Local migration filename aligned with the migration actually recorded in Staging:
  `supabase/migrations/20261110123155_otp_durable_shared_throttle.sql`
- SQL regression test updated:
  `supabase/tests/20261110_kdj_otp_durable_shared_throttle_test.sql`
- Added Portal contract test:
  `scripts/test-otp-durable-contract.mjs`
- Added npm command:
  `npm run test:otp`
- Change-control record updated:
  `docs/change-control/CR-CIR_KDJ_OTP_DURABLE_SHARED_THROTTLE_v1.0.md`

## Approved security policy preserved

| Control | Policy |
|---|---|
| OTP validity | 5 minutes |
| Per-phone cooldown | 60 seconds |
| OTP request quota | 4 requests per 10 minutes |
| Failed OTP attempts | 5 within 10 minutes |
| Lockout after fifth failure | 10 minutes |
| Consumption | One-time, atomic; replay denied |

The migration uses per-phone advisory transaction locks and row locks. The throttle table stores HMAC identifiers, not raw phone numbers/IP/username identifiers. RLS is enabled and direct table privileges are revoked from PUBLIC, anon, authenticated and service_role. The service_role can execute the approved RPCs, but cannot directly read the throttle table.

## Verification evidence

### Local Portal

- `npm run test:otp`: PASS.
- All Portal `scripts/test-*.mjs`: **12/12 PASS**.
- `npm run lint`: PASS, 0 errors and 5 existing `@next/next/no-img-element` warnings.
- `npm run build`: PASS on Next.js 16.4.3; TypeScript completed and 19/19 static pages generated.
- `git diff --check`: PASS (only existing LF-to-CRLF warnings).

The contract test asserts there are no Map-based OTP/rate-limit helpers, customer OTP uses HMAC identifiers and durable RPCs, request/verify routes call the atomic helpers, and database errors fail closed.

### Supabase Staging

Staging migration history contains exactly one matching record:
- Version: `20261110123155`
- Name: `kdj_otp_durable_shared_throttle`

A transaction-based regression was executed with synthetic phone/key values and rolled back. It verified:
- first OTP request is accepted;
- immediate second request is blocked by the 60-second cooldown;
- quota allows four requests and blocks the fifth in the 10-minute window;
- issuing a new OTP invalidates the previous active OTP;
- the fifth wrong attempt creates a durable lockout;
- the lockout blocks even a correct OTP until expiry;
- successful verification consumes the OTP;
- replay of a consumed OTP is rejected;
- shared Admin rate-limit and lock/clear RPCs work.

Post-test database checks:
- `kdj_auth_throttle_state` rows: 0
- Active OTP rows: 0
- OTP rows created in the last hour: 0
- Throttle table RLS: enabled
- Direct SELECT on throttle table: denied to anon, authenticated and service_role
- OTP RPC EXECUTE: denied to anon/authenticated and granted to service_role

No test/customer OTP rows were retained.

## Remaining release gate

This completes the **durable OTP implementation and Staging verification** for P1 item 4. It does **not** prove an end-to-end customer WhatsApp OTP journey in the browser. After environment reload, the remaining UAT is:
1. request OTP from the applicant browser;
2. verify the OTP delivered by WhatsApp;
3. confirm one-time login succeeds and the same OTP cannot be replayed;
4. confirm retry/cooldown behavior through the real Portalâ€“Bot path.

No live customer OTP was sent during this work.

At the time this report was first written, P1 item 5 remained a separate checkpoint; it was closed by the two-process Staging verification in the addendum below.

## Change boundary

- Production was not accessed or changed.
- No Supabase migration was applied during this task; the matching migration was already present in Staging.
- No environment secret was edited or displayed.
- No commit, push or deployment was performed.
- No Bot runtime restart was performed.

## P1 item 5 addendum â€” shared limiter and multi-process concurrency (10 November 2026)

P1 item 5 is now **CLOSED for the local Portal + Supabase Staging implementation and concurrency evidence**. The earlier status in this report described the checkpoint before this addendum.

### Route and policy inventory
- `POST /api/auth/request-otp`: shared IP quota of 20 requests / 10-minute fixed window, plus the atomic per-phone cooldown of 60 seconds and quota of 4 requests / 10-minute fixed window.
- `POST /api/auth/verify-otp`: shared IP quota of 20 requests / 10-minute fixed window, in addition to the per-phone failed-OTP counter and 10-minute lockout after the fifth failure.
- `POST /api/admin/auth` with `login_admin`: shared IP quota of 20 requests / 10-minute fixed window, plus durable account lockout after 5 failures / 10 minutes.
- Each route calls `checkSharedRateLimit()`; the underlying counters and lockout state are held in the shared PostgreSQL table through atomic RPCs. RPC errors fail closed.
- The 10-minute quotas are **fixed windows**, not a sliding/rolling event window. This documents the actual implementation and test contract.

### Multi-process Staging test
Added `scripts/test-otp-concurrency-staging.mjs`. It starts two independent Node.js worker processes, each using the same local Staging environment and a separate Supabase client, then fires parallel RPC calls against the same synthetic HMAC keys.

Results:
- Shared rate limiter: 12 concurrent calls across two processes, exactly 4 allowed and 8 denied for a limit of 4.
- OTP per-phone cooldown: 10 concurrent requests across two processes, exactly 1 OTP issued and 9 returned `COOLDOWN`.
- Account failure counter: 10 concurrent failure increments across two processes; a separate RPC confirmed the shared lockout was active.
- Both workers derived the same HMAC throttle key from the configured server-side secret.
- Harness completed with exit code 0. Static contract test `npm run test:otp` also passes and now asserts all three endpoint call sites and the concurrency harness are present.

### Staging cleanup and access verification
- Removed 1 synthetic OTP row and 3 synthetic throttle-state rows after the test.
- Post-cleanup: 0 matching synthetic OTP rows, 0 matching throttle rows, and 0 total rows in `kdj_auth_throttle_state`.
- RLS remains enabled. Supabase Security Advisor returned the INFO rls_enabled_no_policy lint for 24 public tables, including this intentionally server-only table. Direct SELECT is denied to `anon`, `authenticated`, and `service_role`; approved server RPC execution remains restricted.

### Remaining boundaries
This evidence verifies database sharing across two independently running Portal-like processes configured with the same local Staging environment. It does not represent a deployed Vercel Preview/Production multi-instance test; deployment environment/key parity remains in the separate Production/OD-08 gate. Browser/live WhatsApp applicant OTP UAT also remains pending under the P0 applicant UAT gate. Production was not accessed or changed; no commit, push, deployment, or Bot restart was performed.

## Evidence Ledger â€” P1 item 5 (2026-11-10)

| Requirement ID | Method / command | Result | Environment | Commit / hash | Status / rationale |
|---|---|---|---|---|---|
| P1-OTP-05-01 | Static route contract: `npm run test:otp` | PASS | Local Portal | Baseline HEAD `d22599a`; changes uncommitted | Request OTP, verify OTP and Admin login are wired to shared limiter controls; test also verifies the multi-process harness contract. |
| P1-OTP-05-02 | `node scripts/test-otp-concurrency-staging.mjs` | PASS | Supabase Staging `pgmdurnylyuqkikbwwwy`; two independent Node processes | Baseline HEAD `d22599a`; changes uncommitted | 12 limiter calls â†’ 4 allowed/8 denied; 10 same-phone OTP calls â†’ 1 issued/9 COOLDOWN; 10 account-failure calls â†’ durable lockout. Worker HMAC keys matched. |
| P1-OTP-05-03 | Supabase SQL cleanup + post-cleanup count/ACL query | PASS | Supabase Staging | Baseline HEAD `d22599a`; no DB schema change in this checkpoint | Deleted 1 synthetic OTP row + 3 synthetic throttle rows; 0 matching records, 0 total throttle rows; RLS and ACLs verified. |
| P1-OTP-05-04 | `npm run lint`, `node --check` (two test scripts), `git diff --check` | PASS | Local Portal | Baseline HEAD `d22599a`; changes uncommitted | Lint: 0 errors / 5 existing image warnings. Diff check passed with line-ending conversion warnings only. |
| P1-OTP-05-05 | Supabase Security Advisor | INFO only | Supabase Staging | Migration `20261110123155` already present | One INFO lint category, RLS enabled without policies on 24 public tables; throttle table has no direct API-role privileges by design. No higher-severity finding was returned. |

**Re-run command:** `node scripts/test-otp-concurrency-staging.mjs`. It creates temporary synthetic Staging records and prints cleanup selectors before making writes. After a rerun, delete the synthetic OTP row for the printed phone and the throttle rows for the three printed key hashes, then verify zero rows remain. Do not run against Production.

**Evidence boundary:** the two-process test represents independent application processes sharing the same Staging DB and same local environment secrets. It does not prove deployed Vercel Preview/Production environment parity or real browser/WhatsApp delivery. Those remain separate release gates.
