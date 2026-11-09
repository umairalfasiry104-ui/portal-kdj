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
