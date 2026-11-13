# CR-CIR — Daily Bot-to-Human Operational Report

**ID:** CR-CIR-KDJ-REPORT-001
**Version:** 1.0
**Decision date:** 9 November 2026
**Decision authority:** Owner Admin (approval recorded in the project conversation)
**Implementation target:** Local Portal + Bot source; Supabase Staging migration source
**Deployment:** Not authorized by this record; Vercel deployment is deferred.

## 1. Approved decision

KDJ will provide a daily Bot-to-Human operational report that is generated manually from the Admin Portal. The report can be copied and shared manually with Human/Admin operators.

Automatic WhatsApp, email, scheduled outbound delivery, or broadcast of the report is explicitly not part of this approval.

## 2. Report contents

The selected reporting date uses Asia/Jakarta (WIB). The report includes:
- Customer inbound events recorded by the Bot.
- Successful Bot chat replies.
- Successful BOT-to-HUMAN handovers.
- Successful HUMAN-to-BOT resume operations.
- Current number of conversations in HUMAN state at generation time.
- Booking-created Outbox events.
- Current notification status for booking Outbox records created on the selected date.
- Admin lead qualification confirmations/revisions.
- Current status of FU jobs created on the selected date.
- Incidents opened on the selected date.
- Global Safe Mode and latest heartbeat snapshot at report generation time.

Report fields are operational counts/statuses, not customer-level records.

## 3. Privacy and event-ledger design

The event ledger stores only:
- Event type.
- HMAC-SHA-256 pseudonymous idempotency key derived from the source message/action identifier using a Bot-only local secret.
- Event timestamp.
- Bot instance label.

It does not store customer phone, WhatsApp JID/LID, name, message content, transcript, or prompt data. The event key is HMAC-SHA-256 using a dedicated random 32-byte Bot-only secret (`KDJ_DAILY_REPORT_HMAC_KEY`), stored only in the Bot local `.env` and ignored by Git. The raw source message/action identifier is never sent to Supabase. If the key is missing or invalid, event recording fails closed and the report must not be treated as complete. Database access is restricted to service_role, with RLS enabled and browser roles denied. Because the current Portal and Bot share the Supabase service_role, this is operational telemetry—not a tamper-proof or non-repudiable audit trail; a caller holding service_role can invoke the event RPC directly.

## 4. Historical coverage and accuracy

The ledger is prospective. Its coverage timestamp is set by the first successfully inserted Bot event, not by migration time. No backfilled or inferred historical customer/Bot activity will be created. The report warns when a selected date is before or overlaps the first recorded event.

Booking notification status, FU job status, current HUMAN sessions, Safe Mode, and heartbeat are explicitly presented as snapshots at report generation time, not as historical state transitions.

## 5. Access

Report generation/read access is limited to Super Admin and Admin Konsultan. Portal server-side authorization remains authoritative; hiding the UI control is not the security boundary.

## 6. Dependencies and release gates

- Migration must be reviewed and applied to Supabase Staging under separate migration approval.
- Bot must restart on the version that records activity events.
- Portal daily report endpoint and UI must pass local tests and browser UAT for both authorized roles and a denied role.
- The report must be verified against a controlled internal test conversation and known event counts.
- No Production deployment until separate release approval and the overall KDJ release gates are complete.

## 7. Out of scope

- Automatic WhatsApp/email dispatch.
- Scheduled report sending.
- Customer-level report details, phone numbers, names, transcripts, or raw message content.
- Retrospective creation of missing historical events.


## 8. Execution evidence — 10 November 2026

### Database / migration
- Supabase target: Staging project `pgmdurnylyuqkikbwwwy` only.
- Applied migration: version `20261110083515`, name `kdj_bot_daily_reporting_20261109`.
- Both RPCs exist: `kdj_record_bot_activity_event` and `kdj_get_bot_daily_report_stats`.
- Both ledger/config tables have RLS enabled. `anon` and `authenticated` are denied table read and report RPC execution; `service_role` has the required access.
- PostgREST report RPC smoke test returned HTTP 200 after schema cache reload.

### Bot key / contract test
- Generated a fresh cryptographically random 32-byte HMAC key and stored it in the Bot local `.env`; value was not displayed or written to Git.
- Format validation: 64 lowercase hex characters, PASS.
- `npm run test:daily-report`: PASS (HMAC/idempotency privacy, HUMAN/BOT command contract, Admin messages excluded from customer activity metrics).

### Actual event evidence
Supabase Staging ledger contains two records, both from source instance `kdj-bot`:
- `CUSTOMER_INBOUND`: occurred at 2026-11-10 09:03:07.163 UTC (16:03:07 WIB); persisted at 09:03:07.477 UTC.
- `BOT_REPLY`: occurred at 2026-11-10 09:03:14.464 UTC (16:03:14 WIB); persisted at 09:03:15.392 UTC.
- `coverage_started_at`: 2026-11-10 09:03:07.163 UTC.
- Daily report SQL preview returns `CUSTOMER_INBOUND: 1` and `BOT_REPLY: 1`; no synthetic test event was inserted by this verification.

### Latest process state / remaining gate
- After the subsequent restart to load the updated Markdown prompts, Bot Node process `14800` and local API listener `127.0.0.1:3001` are running. Supabase and Bot process heartbeats are `OK`.
- Latest WhatsApp heartbeat remains `AUTHENTICATED/STARTING`, not `READY/OK`. Chromium's WhatsApp page reports a connected socket and synced state, but the whatsapp-web.js `ready` event has not been observed on this latest process.
- Therefore the actual event recording path is proven for the recorded inbound/reply pair, but a fresh post-prompt-restart message test and a stable `READY` heartbeat remain pending.

**Release note:** This remains Staging-only. Production release and automatic report delivery remain out of scope.

---

## 9. Additional Staging API UAT — 10 November 2026

A local Portal API test against Supabase Staging verified:
- Super Admin: report API HTTP 200 with non-empty report text.
- Admin Konsultan: report API HTTP 200 with non-empty report text.
- Admin Verifikator: HTTP 403 FORBIDDEN_DAILY_REPORT.
- No session: HTTP 401.
- Test contract npm run test:daily-report: PASS after its migration filename reference was aligned with the applied migration 20261110083515_kdj_bot_daily_reporting_20261109.sql.

The test used locally minted test-session cookies and did not constitute a browser login/clipboard test. Daily Report UI rendering and copy interaction remain pending browser UAT. The report remains manual/copy-only; no automated WhatsApp/email delivery is included.

The Staging ledger already has a prospective event pair (CUSTOMER_INBOUND and BOT_REPLY) recorded before the latest prompt restart. A new post-restart event has not been demonstrated. Bot readiness/heartbeat remains an external release gate and is not represented as passed by this Portal API test.


### Staging data reset impact — 10 November 2026

After the API role UAT was recorded, the owner-directed Staging reset removed the two historical Bot activity ledger rows and reset kdj_bot_reporting_config.ledger_enabled_at to NULL. The Daily Report configuration row and service RPCs were preserved. A post-reset Super Admin API smoke returned HTTP 200 with an empty event ledger. The next successful Bot event will start a new coverage window; reports must not claim coverage before that event.
