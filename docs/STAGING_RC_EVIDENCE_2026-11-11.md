# Staging RC Evidence — 11 November 2026

Project: KDJ Portal + WhatsApp Bot. Environment: Supabase Staging `pgmdurnylyuqkikbwwwy`. No Production changes.

## Executive disposition

- **Automated Staging regression: PASS.**
- **Daily Report coverage + component UI + clipboard: PASS; actual Admin-role browser login remains follow-up.**
- **Applicant end-to-end UAT: PARTIAL / BLOCKED** until a dedicated applicant-controlled WhatsApp test number and real OTP are supplied.
- **Overall Staging RC: NOT READY FOR RELEASE / PASS WITH FOLLOW-UP.** Do not deploy, merge or declare release-ready.

## Evidence ledger

| Requirement / area | Command or method | Result | Environment / date | Notes |
|---|---|---|---|---|
| Portal qualification + FU | `npm run test:qualification` | PASS | Portal Staging worktree, 11 Nov | Qualification and idle/FU lifecycle contracts. |
| OTP durable throttle | `npm run test:otp` | PASS | Portal Staging worktree, 11 Nov | Atomic RPC, cooldown, quota, lockout, HMAC keys, replay and two-process test harness contracts. |
| Akta + Passport deferral | `node scripts/test-birth-certificate-upload.mjs` | PASS | Portal Staging worktree, 11 Nov | Akta required; Passport not an applicant Portal upload and not a first-submit blocker. |
| Admin RBAC | `node scripts/test-admin-rbac.mjs` | PASS | Portal Staging worktree, 11 Nov | Super Admin-only payment authority; Verifikator/Konsultan boundaries. |
| Session identity | `node scripts/test-session-identity.mjs` | PASS | Portal Staging worktree, 11 Nov | Ownership/session contract. |
| Admin booking attestation/contract/route | three `test-admin-booking-*.mjs` scripts | PASS | Portal Staging worktree, 11 Nov | Attested RPC path and role enforcement. |
| Monitoring/FU | `node scripts/test-monitoring-followup-contract.mjs` | PASS | Portal Staging worktree, 11 Nov | Schema, lifecycle, consent and UI contract. |
| Daily Report contract | `npm run test:daily-report` | PASS | Portal Staging worktree, 11 Nov | Manual report, restricted ledger, date ref, selected date, clipboard; no auto-send. |
| Applicant browser entry | Puppeteer browser smoke at `http://127.0.0.1:3000` | PASS (entry/negative gate only) | Local Portal + Staging env, 11 Nov | Landing HTTP 200; unauthenticated applicant update/upload/report endpoints each 401; zero page errors. Does not equal successful OTP/applicant UAT. |
| Daily Report UI/clipboard | Puppeteer mounts actual `AdminDailyReportPanel`, fixture RPC response, click/copy/read | PASS | Local Portal browser, 11 Nov | Date, summary cards, coverage note, report text, manual-only label and clipboard verified. Actual Admin session role login remains follow-up. |
| Portal lint | `npm run lint` | PASS — 0 errors / 5 warnings | Portal worktree, 11 Nov | Five existing `<img>` performance warnings in `app/admin/page.js` and `app/page.js`; no lint errors. |
| Portal production build | `npx next build` with isolated `KDJ_NEXT_DIST_DIR=.next-rc-20261111` | PASS | Portal worktree, Next.js 16.4.3, 11 Nov | Turbopack compile, TypeScript, 19/19 static pages and route generation pass. Temporary output directory and config override removed; default `.next` restored. |
| Bot syntax/runtime tests | `npm run check` | PASS | Bot worktree, 11 Nov | `index.js` syntax. |
| Bot baseline/scheduling/qualification | `npm run test:baseline`, `test:scheduling`, `test:qualification` | PASS | Bot worktree, 11 Nov | Baseline, Scheduling V2/Outbox, identity and conversation-store contracts. |
| Bot reporting/RT04 | `npm run test:daily-report`, `npm run test:rt04` | PASS | Bot worktree, 11 Nov | HMAC event recorder; RT04 PREPARE/APPROVE/reconciliation and retry safety. |
| Bot identity/config/system | customer identity/name, Portal name display, prompt identity, runtime config, safe retry, system ops and verified customer phone scripts | PASS | Bot worktree, 11 Nov | All invoked scripts exited 0. Live Gemini generation smoke was intentionally not invoked. |
| Bot dependency audit | `npm run security:check` | PASS | Bot worktree, 11 Nov | Production npm audit: 0 vulnerabilities; 207 registry signatures and 30 attestations verified. |
| Supabase migrations | `supabase_migrations.schema_migrations` read-only check | PASS | Staging, 11 Nov | Daily reporting `20261110083515`, durable OTP `20261110123155`, RT04 policy preflight `20261110172031` present. |
| Sensitive RPC ACL | `pg_proc` security/ACL inspection | PASS | Staging, 11 Nov | Reporting stats/record event, OTP atomic RPCs and RT04 prepare are SECURITY DEFINER, `search_path=""`; EXECUTE ACL only postgres/service_role. |
| Portal health | GET `/api/health` | PASS | Local Portal → Staging Supabase, 11 Nov | HTTP 200, component portal status OK; heartbeat refreshed. |

## Runtime and database snapshot

- Bot Node process PID: `25136` (previously verified active); internal Bot API port 3001.
- Fresh heartbeat observations after Portal health ping: `bot_process`, `portal`, `supabase`, `whatsapp` all `OK`.
- Gemini heartbeat last observed `2026-11-10 16:09:22Z` (23:09 WIB); status last recorded OK but observation is stale. No live Gemini generation test was run in this gate.
- Applicant DB rows: 2 existing `draft_berkas` records; documents 0; payment proof references 0; private Storage objects 0; unexpired unused OTP 0.
- Scheduling: 2 existing booking rows.
- Booking notification Outbox: 3 rows, all `SENT`; no PENDING/PROCESSING/UNKNOWN/FAILED rows in the snapshot.
- Open system incidents: 0.
- Reporting ledger: 38 events, 20 customer inbound and 18 Bot replies; coverage began 10 Nov 2026 at 22:05:30 WIB.

## Source checkpoint

- Portal branch: `feature/kdj-portal-work-20261109`; HEAD `d22599aaaa4e206d6727819e442fb4f13b9e94ea`; branch remains ahead by 7 commits as it was at the start of this task.
- Bot branch: `feature/kdj-wa-bot-work-20261109`; HEAD `8023fb06f1ccff5124340466c1307da4125fa1ea`.
- Portal Daily Report component SHA-256: `72CFF14F0E765E15A6055786B94FB10B5AF9ACE4367434B855421F5E7461FC07`.
- Portal Daily Report contract SHA-256: `18A91D210048A3DBE26A91A082D0AE4531146FC882A47250D04A24658F40D922`.
- Both repositories still contain pre-existing local worktree modifications. This task created no commit, push, merge, deployment or Production modification.

## Outstanding release blockers

1. Complete real applicant UAT with dedicated customer-controlled Staging WhatsApp number: request/receive OTP, verify/replay, biodata save/reload, Akta upload, payment proof, missing-document negative case, final submit, and Bot notification correlation.
2. Perform actual Admin-browser login RPT role qualification (Super Admin/Admin Konsultan allowed; Admin Verifikator and unauthenticated denied). The component fixture test does not substitute for real Admin session evidence.
3. Refresh/verify Gemini health on a controlled test when approved; current last heartbeat observation is stale (recorded OK, not current).

**Final gate:** Automated Staging regression is green, but the overall Staging RC remains **NOT READY** until the required live UAT and follow-up checks above are closed and owner Go/No-Go is recorded. No Production deployment is authorized by this report.


## Final verification update — 11 Nov 2026, 03:15 WIB

### Fresh regression rerun

- Portal: qualification/FU, Daily Report, durable OTP, Akta upload contract, session identity, Admin RBAC, Admin booking attestation/contract/route, monitoring/FU, idle lifecycle, lead qualification, Scheduling V2/Outbox, and lint all exited 0. Lint: 0 errors, 5 existing `<img>` performance warnings.
- Bot: syntax check, baseline, Scheduling V2/Outbox, qualification/conversation store, Daily Report recording, RT04 attestation/service-flow, customer identity/name, Portal name display, prompt identity, runtime config, safe booking retry, system ops, verified customer phone and security checks all exited 0.
- Bot production dependency audit: 0 vulnerabilities. Supply-chain verification: 207 registry signatures and 30 package attestations passed.
- `git diff --check` PASS in Portal and Bot. Only Windows LF/CRLF conversion warnings were printed; no whitespace errors.
- Daily Report source hashes match the previous isolated Next.js 16.4.3 production build evidence (19/19 static pages/routes). The temporary build output and QA route were verified absent. The running Portal dev server was left intact; build was not rerun into its live `.next` directory.

### Live Staging OTP concurrency

Using two independent Node worker processes against the confirmed Staging project:
- Shared rate limiter: 12 simultaneous RPC calls → 4 allowed, 8 denied.
- Per-phone OTP cooldown: 10 simultaneous requests → 1 issued, 9 `COOLDOWN`.
- Shared auth lockout: 10 simultaneous failures → durable lockout confirmed.
- Test-created data was cleaned by exact selectors: 1 synthetic `otp_auth` row and 3 HMAC throttle rows deleted. Post-cleanup checks: OTP rows 0; throttle rows 0.

### Fresh Staging data / runtime snapshot

- Applicants: 2 total, both `draft_berkas`; applicant document rows 0; payment-proof references 0; private `berkas_kdj` Storage objects 0.
- Booking rows: 2. Outbox: 3 `SENT`; rows needing attention (`PENDING`/`PROCESSING`/`UNKNOWN`/`FAILED`): 0.
- Open incidents: 0. Daily reporting ledger: 38 events; reporting config active.
- Latest heartbeats: Bot process, Portal, Supabase and WhatsApp all `OK` at approximately 03:14 WIB. Gemini last heartbeat remains stale (last recorded `OK` at 23:09 WIB on 10 Nov); no live Gemini generation smoke was run in this gate.
- Anonymous report API GET returned 401; anonymous applicant POST returned 401; Portal `/api/health` returned HTTP 200.
- Confirmed Staging migration history includes daily reporting `20261110083515`, durable OTP `20261110123155`, and RT04 preflight policy `20261110172031`.

### Final release gate

**Automated regression = PASS. Daily Report capability = PASS WITH ROLE-SESSION FOLLOW-UP. Applicant live end-to-end UAT = BLOCKED / NOT RUN. Overall Staging RC = NOT READY FOR RELEASE.** Remaining qualification is real applicant-controlled OTP journey through final submit and Bot notification correlation, plus real authenticated Admin-role validation for Daily Report and a fresh Gemini service smoke/heartbeat. These cannot be claimed from synthetic concurrency or static/fixture tests.

No Production modification, deploy, commit, push or merge was performed. Portal and Bot local worktree changes were preserved. Bot PID `25136` and Portal dev process remained running. No release authorization is implied; require explicit owner Go/No-Go after the open live UAT qualifications close.
