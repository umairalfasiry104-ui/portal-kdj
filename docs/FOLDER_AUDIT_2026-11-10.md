# KDJ — Folder & Release Readiness Audit

**Audit date:** 10 November 2026  
**Audited worktrees:**  
- Portal: `C:\Users\umair\KDJ stagging\kdj-portal`
- Bot: `C:\Users\umair\KDJ stagging\kdj-wa-bot`
- Database: Supabase Staging `pgmdurnylyuqkikbwwwy` (`kdj-staging-v6`)

**Production:** Not accessed or modified.  
**Git:** No commit, push, merge, or deployment performed.

## 1. Executive decision

**NOT READY FOR RELEASE.**

The code/test foundation is substantially covered: Portal test scripts pass 11/11, Bot test scripts pass 14/14 after two stale test-harness expectations were corrected, Portal lint has zero errors, and the latest Portal production build passes. The Staging database still has its three Admin accounts and required system/key configuration after the owner-requested data reset.

However, the audit found an additional **P0 Portal–Bot API credential mismatch in the local environment files**. Portal sends the value from `WA_BOT_API_KEY`; Bot validates against its own `WA_BOT_API_KEY` (or `INTERNAL_API_KEY`). The values in the two local env files do not match, and the Bot file has no `INTERNAL_API_KEY` fallback. Unless the running Bot has a separate external environment override, Portal-to-Bot calls will fail the Bot's API-key check. Do not treat OTP, final-submit notification, or Portal-to-Bot integration as ready until the key is aligned and end-to-end verified.

There are also two release-hardening findings: Bot production dependencies have active npm audit advisories, and the Portal OTP abuse controls rely on process-local state while the declared 60-second database cooldown is not actually enforced.

## 2. Audit coverage and boundaries

Inspected both repository structures, source-file inventory, package manifests/installed dependency trees, Git status/diffs/ignore rules, prompt metadata, migration inventory, critical Portal API/auth/upload/report routes, Bot internal API authentication and RT04-related modules, automated test scripts, Staging environment variable names and selected secret metadata, Supabase migrations, database advisor results, and post-reset Staging state.

The audit did **not** print or disclose secret values. Vendor internals under `node_modules`, Git object storage, Chromium/WhatsApp session contents, and every source line were not manually reviewed line-by-line. Live WhatsApp runtime investigation was excluded because the operator has reserved that Bot READY work. Test scripts that make external Gemini calls were not run.

## 3. Results summary

| Area | Result | Notes |
|---|---|---|
| Portal automated tests | **PASS 11/11** | Admin attestation/RBAC, Akta/Passport, Daily Report, follow-up, qualification, monitoring, scheduling/outbox, session identity |
| Bot automated tests | **PASS 14/14** | RT04 attestation/flow, safe retry, identity/LID, customer name, reporting, scheduling, follow-up helpers, runtime config, prompt metadata |
| Portal production build | **PASS** | Next.js 16.4.3; compile + TypeScript pass; 19/19 static pages generated |
| Portal ESLint | **PASS** | 0 errors, 5 existing `no-img-element` warnings |
| Portal/Bot `git diff --check` | **PASS** | Line-ending conversion warnings only |
| Dependency tree | **PASS** | `npm ls --depth=0` clean in both repositories |
| Portal production dependency audit | **PASS** | 0 low/moderate/high/critical advisories |
| Bot production dependency audit | **FAIL / HARDENING REQUIRED** | 11 high + 5 moderate, 0 critical; npm reported no automatic fix available |
| Portal–Bot local API key parity | **FAIL / P0** | Local env files hold different API keys; Bot API validates exact key match |
| Supabase target parity | **PASS** | Portal and Bot both point to expected Staging ref |
| HMAC key formats / IDs | **PASS** | Required local HMAC values have valid format; Portal Admin key ID and Bot RT04 key ID match Staging IDs |
| Real RT04 WhatsApp customer consent | **PENDING** | Automated tests do not replace customer-sent SETUJU/replay/BATAL |
| Applicant real OTP/browser journey | **PENDING** | API/Storage tests used controlled local test sessions |
| Daily Report browser/clipboard UAT | **PENDING** | API/RBAC tests pass; UI rendering and copy interaction not yet proven |
| Bot WhatsApp READY/heartbeat | **PENDING** | Operator-owned issue; this audit did not investigate or alter Bot runtime |

## 4. P0 findings — must close before release/UAT sign-off

### P0-01 — Portal–Bot API key mismatch

**Evidence**
- Portal `callWaBotApi()` sends `x-api-key` using Portal `WA_BOT_API_KEY`.
- Bot `requireInternalApiKey()` compares `x-api-key` against Bot `WA_BOT_API_KEY || INTERNAL_API_KEY` using timing-safe comparison.
- The current local `.env.local` and Bot `.env` have different `WA_BOT_API_KEY` values.
- Bot `INTERNAL_API_KEY` is not present as an alternative in the inspected environment file.
- Portal `WA_BOT_API_URL` is loopback/local and the Bot local port is 3001, which is suitable for the current same-PC Staging arrangement; it is not a deployable Vercel-to-VPS address.

**Impact**
Portal requests such as OTP delivery, final-submit status notification, and other authenticated internal Bot calls will be rejected by the Bot API-key middleware when the Bot starts with the inspected `.env` and no external override is present.

**Required correction**
Align the Portal and Bot internal API key through controlled secret handling, restart the Bot under the operator's coordination, then test a protected endpoint and verify the complete Portal-to-Bot request path. Do not write either secret into Git, documentation, command output, or logs. Re-run OTP/final-submit UAT after alignment.

**Status:** OPEN. The audit did not change either secret or restart the Bot.

### P0-02 — live UAT still incomplete

1. RT04: real customer receives the canonical summary, sends exact `SETUJU`, replay is idempotent, then `BATAL` is verified. Use a dedicated customer-controlled test number and do not fabricate consent.
2. Applicant Portal: real OTP request, WhatsApp receipt, OTP verify, profile completion, Akta upload, payment-proof flow, and final submit.
3. Daily Report UI: Super Admin and Admin Konsultan render and copy the report; a denied role remains blocked.
4. Bot READY/heartbeat must first be restored by the operator handling that issue.

The earlier Akta/Daily Report tests prove API/RBAC/Storage behavior with controlled local test sessions. They do not close these browser/live WhatsApp tests.

## 5. P1 findings — production hardening

### P1-01 — Bot has 16 production dependency advisories

`npm audit --omit=dev` on the Bot repository reported:

- **11 high**
- **5 moderate**
- **0 critical**
- `whatsapp-web.js` is a direct dependency with a high advisory path.
- High-severity transitive paths include Puppeteer/`@puppeteer/browsers`, `extract-zip`, `basic-ftp`, proxy-agent chain, and Chromium BiDi.
- Moderate paths include archiver/archiver-utils, glob, minimatch and zip-stream.
- The audit run reported no automatic remediation available for these dependency trees.

**Recommendation:** prepare a separate dependency remediation CR/CIR. Inspect the exact vulnerable transitive paths and compatible fixed versions/fork options, then run all 14 Bot scripts plus WhatsApp READY, Chromium launch, reconnect, inbound/outbound and RT04 live regression. Do not blindly run `npm audit fix` or upgrade Puppeteer/whatsapp-web.js because this stack is sensitive to WhatsApp Web compatibility.

### P1-02 — OTP abuse controls are not fully durable

**Evidence**
- `OTP_COOLDOWN_MS = 60 * 1000` is declared in `app/api/auth/request-otp/route.js` but is not used to enforce the cooldown.
- The route reads the latest OTP record (`latestOtp`) and created_at, but the result is not used in a 60-second comparison.
- Actual request limiting calls `checkRateLimit()`, which stores state in a process-local JavaScript Map.
- OTP brute-force failures use another process-local Map (`otpAttemptStore`); code comments explicitly say it is not synchronized between instances.
- OTP consumption itself uses a conditional database update and is protected against two requests consuming the same OTP row.

**Impact**
When Portal runs on multiple serverless instances, per-process OTP request limits and failed-attempt lockouts can be bypassed by spreading requests between instances. The advertised 60-second database cooldown is not currently implemented.

**Recommendation:** add an atomic, shared server-side throttle/attempt mechanism (database RPC or trusted shared store), enforce the intended cooldown, and cover concurrency/multi-instance behavior with tests. Keep the existing conditional OTP consumption protection.

### P1-03 — Production deployment environment remains unverified

Earlier OD-08 evidence recorded Vercel Preview/Production env pointing at the legacy Supabase ref reported INACTIVE, the Admin booking HMAC environment key missing, the WA Bot API host unverified, and no Bot VPS provisioned. This audit verifies only the **local Staging** env files. Before Production: select/confirm the target Supabase project, set matching Portal/Bot API credentials, provision and secure the Bot service endpoint, configure Vercel secrets, confirm HMAC key parity/IDs, domain/TLS, and rerun OD-08 caller inventory.

## 6. Security, database and RBAC review

### Positive evidence
- Portal admin routes use Admin session/permission helpers; applicant profile/upload routes bind operations to the signed user session.
- User and Admin sessions are HMAC-signed HttpOnly cookies; Admin authorization rechecks the current DB Admin row, active status, role, phone identity and session version.
- Internal Bot API uses an API key header, timing-safe comparison, rate checks, JSON payload size limit, and per-route WhatsApp READY checks.
- Bot RT04 HMAC and Admin attestation tests fail closed on invalid/missing configuration and replay/tamper cases.
- Supabase target parity: Portal and Bot both point to Staging `pgmdurnylyuqkikbwwwy`.
- Local HMAC format checks pass; Staging key IDs are `admin-v1` and `rt04-v1`, matching the local key IDs.
- Staging migration list has 9 entries, including RT04, Admin attested lane, key bootstrap/lock, legacy bypass revoke, and Daily Reporting migrations.

### Supabase advisor findings
- **23 INFO** findings: RLS enabled without policies on public tables. This is consistent with the current server-side/service-role access design, but it should be re-reviewed with the table grants and RPC contracts. Do not add permissive RLS policies or enable/disable RLS blindly.
- **2 INFO** unindexed foreign keys: `admins.disabled_by` and `jadwal_konsultasi.latest_notification_id`.
- **6 INFO** unused indexes. Do not remove them solely because current usage counters show zero; test query plans and expected production access patterns first.
- Previous ACL review found no direct access to private schema tables from anon/authenticated/service_role; retain that restricted model.

## 7. Folder structure and maintainability

### Portal
- Source and docs are organized under `app/`, `lib/`, `scripts/`, `supabase/migrations/`, `supabase/tests/`, `supabase/ops/`, and `docs/`.
- Largest handwritten files include `lib/security.js` (~1,313 lines), `app/admin/page.js` (~1,275), and `app/page.js` (~1,070). These are maintainability hotspots but not automatic release blockers.
- Portal README remains boilerplate Next.js starter content. It should be replaced with a KDJ-specific setup, environment, testing, Staging and release runbook.
- `dev-server-3000.log` is untracked and is not covered by the current Portal `.gitignore`. Add a log ignore pattern or remove it before packaging; do not stage it.
- `_local_backups/` is ignored; retain locally for now, but exclude from release artifacts.
- Several branding PNGs exist in both `public/` and `app/admin/`; verify whether duplication is needed before consolidating.

### Bot
- Runtime code is modularized into `lib/booking/`, `lib/http/`, and `lib/whatsapp/`; `index.js` is about 570 lines.
- Large modules include `lib/whatsapp/message-handler.js` (~922 lines), `customer-approval-service.js` (~571), `conversation-scheduling.js` (~506), and `internal-api.js` (~452). These are future refactor candidates, not current functional blockers.
- Local ignored WhatsApp profile/cache/quarantine data makes the Bot folder approximately **1.04 GB** outside `node_modules` and `.git`. The directories are ignored by Git and contain operational session/cache state. Do not delete the active or quarantined session without a separately approved backup/retention decision.
- Bot README covers RT04 but is not a full operations, service restart, environment, backup/restore or incident runbook.

### Test discoverability
- Portal has 11 standalone `test-*.mjs` scripts but only exposes two npm test scripts for qualification and Daily Report.
- Bot has 14 standalone test scripts with several npm test scripts grouping suites.
- Consider a reviewed `test:all` entry point for each repository once CI/test runtime boundaries are agreed. Keep external Gemini/network tests separate.

## 8. Git and release packaging

- Portal branch: `feature/kdj-portal-work-20261109`, HEAD `d22599a`, ahead 7 relative to origin; worktree has modified files, a staged migration rename, and untracked docs/test/config/log files.
- Bot branch: `feature/kdj-wa-bot-work-20261109`, HEAD `8023fb0`; worktree has modifications to RT04 docs, index.js, prompts and two now-updated test harness scripts.
- Both repos' `git diff --check` pass. Git reports only CRLF/LF working-copy conversion warnings.
- Env files, Bot WhatsApp profiles/caches/quarantine and Portal local backups are ignored.
- No commit, push, deployment, or Production mutation occurred during this audit.
- Before commit, inspect each changed/untracked file individually. Do not use `git add .`; exclude `dev-server-3000.log`, `.env*`, `.wwebjs_auth*`, `.wwebjs_cache*`, `node_modules`, `.next`, and backups.

## 9. Staging database after reset

Post-reset verification:
- Admin accounts: **3**, all active.
- Applicants: **0**.
- Bookings: **0**.
- `berkas_kdj` Storage objects: **0**.
- Daily Report coverage start: `NULL` (next successful event establishes new coverage).
- Bot and Admin HMAC key-custody rows retained.
- `kdj_bot_reporting_config`, `kdj_system_controls`, and `kdj_followup_delivery_gate` singleton configuration rows retained.
- Migration history, schema, functions and ACLs retained.
- Production untouched.

## 10. Prioritized action register

| Priority | Item | Required close evidence |
|---|---|---|
| P0 | Align Portal/Bot `WA_BOT_API_KEY` | Local config parity check without displaying values; protected Portal-to-Bot API call succeeds |
| P0 | Restore Bot WhatsApp READY (operator-owned) | Stable READY/heartbeat and fresh inbound event evidence |
| P0 | RT04 live customer-consent UAT | Real summary → customer SETUJU → idempotent replay → BATAL |
| P0 | Applicant browser/OTP UAT | Real OTP receive/verify, form and Akta upload, payment proof, final submit |
| P0 | Daily Report UI UAT | Both allowed roles render/copy correctly; denied role blocked in browser |
| P1 | Bot dependency remediation CR/CIR | Reduce/resolve high/moderate production advisories; full WhatsApp regression |
| P1 | OTP shared throttling + real 60s cooldown | CLOSED — DB/shared atomic implementation + two-process Staging concurrency evidence; live applicant OTP UAT remains P0 |
| P1 | Production environment/infra/OD-08 | Active Production Supabase, Vercel secret alignment, public Bot endpoint/VPS, HMAC parity, TLS and caller inventory |
| P2 | Portal README / Bot operations runbook | KDJ setup, env, testing, deploy, backup/restore and recovery instructions |
| P2 | Portal log ignore rule and release hygiene | No local log/session/cache/backup files in release staging |
| P2 | Refactor large files / expose test:all | Small CRs, no behavior change, regression evidence |

## 11. Final recommendation

Do **not** mark the system “clear” or release-ready yet. The 25/25 automated source tests and Portal build are a strong foundation, but the local Portal–Bot API-key mismatch is an additional P0 integration blocker, and the Bot dependency audit plus distributed OTP throttling need production hardening.

Close P0 configuration and live UAT first. Then resolve P1 dependency and OTP security work before Production. P2 structure/documentation housekeeping can be handled without changing the frozen business scope.

## 12. P1 OTP remediation addendum — 10 November 2026

The earlier P1-02 finding is now **CLOSED for local Portal + Supabase Staging implementation and multi-process concurrency evidence**.

- The three relevant API paths are wired to the shared PostgreSQL rate limiter: customer OTP request IP, customer OTP verify IP, and Admin password login IP. Each is configured for 20 requests per 10-minute fixed window.
- Per-phone OTP issuance is guarded by a 60-second cooldown and a 4-per-10-minute fixed window; OTP failure lockout and Admin account lockout remain durable.
- Two independent Node.js worker processes were started against the same Staging project. Parallel results: shared limiter 12 calls = 4 allowed/8 denied; OTP issuance 10 calls for one synthetic phone = 1 issued/9 COOLDOWN; account failure 10 calls = shared lockout confirmed.
- Both workers derived the same HMAC key from their server-side environment. This validates shared database behavior under independent processes configured with the same key; it is not a deployed Vercel Preview/Production test.
- Test residue was removed: one synthetic OTP row and three throttle rows. Verification returned 0 matching rows and 0 total throttle-state rows.
- RLS and direct table ACLs remain restricted. Static contract test `npm run test:otp` passes with route wiring and concurrency harness assertions.

The 10-minute quotas are fixed-window quotas, not sliding windows. The separate live browser/WhatsApp applicant OTP UAT remains a P0 release gate; Production and deployed Vercel environment parity remain untouched.

## Runtime activation addendum — Bot dependency remediation (10 November 2026)

The prior finding that the Bot dependency remediation was not yet activated and the WhatsApp READY/heartbeat state was pending is superseded by the completed local Staging activation recorded in the Bot repository at `docs/security/BOT_DEPENDENCY_ACTIVATION_2026-11-10.md`.

- Main Bot dependency installation is active after `npm ci`; the Puppeteer 25.16.0 install script was explicitly approved and rebuilt.
- Installed versions: whatsapp-web.js 1.34.7; puppeteer/puppeteer-core 25.16.0; @puppeteer/browsers 3.2.6; glob 14.0.4; minimatch 11.0.5.
- Full npm audit and production audit: 0 vulnerabilities. 207 registry signatures and 30 attestations verified.
- Bot tests: 14/14 PASS; baseline/check PASS; Puppeteer Chromium 156.0.8078.47 launch smoke PASS.
- Local Bot restarted as PID 18436. WhatsApp runtime 2.3000.1053914165 emitted READY. Two successive Staging heartbeat cycles report bot_process OK, Supabase OK, and WhatsApp OK/READY.
- Safe Portal-configured key check returned HTTP 400 INVALID_PAYLOAD from the protected Bot route, proving middleware accepted the key; no WhatsApp message was sent.
- LocalAuth session profile was preserved. Production and VPS were not accessed.

This closes local Staging Bot dependency activation and READY restoration. It does not close the fresh inbound conversation, Outbox send-after-restart, RT04 live customer consent, applicant/browser OTP or other P0 UAT gates.

## STG-05 / STG-06 status update — 10 November 2026

The runtime activation addendum above is further updated by the latest controlled UAT:
- STG-05: inbound WhatsApp message and Bot reply recorded; LID resolved to controlled handset suffix 1604. Lead qualification timed out on that message but chat reply was recorded.
- STG-06: live Outbox create/cancel notifications both SENT with provider message IDs; synthetic booking cleaned to Batal; global Outbox only 2 SENT test rows and 0 nonterminal.
- UAT-07 RT04 customer consent is still open, pending operator-originated SETUJU/replay/BATAL interaction. RT04 BATAL policy is pending-approval cancellation only.
