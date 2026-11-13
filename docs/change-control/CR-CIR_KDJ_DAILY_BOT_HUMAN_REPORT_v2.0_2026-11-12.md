# CR/CIR — Daily Business Report & Admin System Report

- **CR ID:** CR-CIR-KDJ-REPORT-001
- **Version:** 2.0 (supersedes the v1.0 delivery-policy section only)
- **Date:** 12 November 2026
- **Decision authority:** Owner Admin
- **Parent baseline:** KDJ Master System Specification v1.0 and CR-CIR_KDJ_DAILY_BOT_HUMAN_REPORT_v1.0.md
- **Status:** OWNER-APPROVED; local implementation prepared; SQL validation, Staging migration, UAT, and release gates remain open
- **Environment boundary:** Local only in this execution. Staging migration/UAT and Production deployment require separate authorization.

## 1. Decision and preserved foundation

The Owner requests two role-specific daily reports delivered by WhatsApp direct message to each eligible Admin's personal number at **08:00 WIB**, covering the previous Asia/Jakarta calendar day (00:00:00 through 23:59:59).

- Admin Konsultan receives the Business Report.
- Super Admin receives the complete Business Report plus System Health, Malfunction/Incident, and Maintenance sections.
- Admin Verifikator is not a recipient.
- Do not send to WhatsApp groups. Each report is sent one-to-one; the Admin may forward it manually.
- Preserve the existing prospective Bot activity event ledger, HMAC event-key privacy contract, current report API foundation, and manual Portal view/copy as a fallback unless a later approved UI design replaces it.
- Do not edit or replay the historical v1.0 migration. Keep CR-CIR_KDJ_DAILY_BOT_HUMAN_REPORT_v1.0 as a historical record; this v2.0 explicitly supersedes its manual-only delivery decision.

## 2. Admin Konsultan — Business Report

Required content for the previous day:

### A. New leads
- Number of unique new leads first observed on that reporting date.
- Breakdown by effective lead category at the report cutoff: PROSPEK, DINGIN, BIMBANG, and UNCLASSIFIED.
- Include name and WhatsApp number only for the PROSPEK list, when available.
- Do not include phone/name details for DINGIN, BIMBANG, or UNCLASSIFIED.
- MASIH_BERTANYA remains a separate operational status and is not a fifth mutually exclusive lead-temperature category. It may be shown as a separate informational count, without adding it to category totals or double-counting people.

### B. Consultation
- Consultations scheduled/created during the reporting date.
- Consultations actually completed during the reporting date, based on a committed transition to booking status Selesai, not the scheduled end time.

### C. Registration outcomes
- **Closing today:** one-time event when both initial applicant data are complete and registration payment is verified PAID. The closing count is attributed to the date the second required condition becomes true.
- **Data complete, payment not yet PAID:** end-of-day open-position snapshot. It can include applications started on earlier dates; it is not a new-activity count.
- **Academic documents submitted:** number of applicants whose final document submission was committed on the reporting date. Revisions/resubmissions must be counted according to a documented event rule, not inferred from updated_at.

## 3. Super Admin — Executive and System Report

Super Admin receives the complete Business Report above, plus:

### A. System health
Check independently, where measurable:
- WhatsApp Bot process/readiness;
- WhatsApp connection state;
- Gemini availability/heartbeat;
- Portal runtime/health endpoint;
- Supabase database connectivity/query health;
- Storage availability/authorized access check;
- Cron/evaluator status;
- separate Admin Report delivery queue and existing customer booking notification queue health.

Statuses must use explicit values such as OK, DEGRADED, DOWN, STALE, or NOT_CHECKED. Do not label a component healthy if no current evidence was collected. Include observation timestamp and stale threshold.

### B. Malfunction and incidents
For each detected issue, include:
- affected component/module;
- first-seen/last-seen time where available;
- severity and current incident state;
- observed impact (or explicitly state impact is unknown);
- recommended diagnostic/action steps.

No incident detected means only that the inspected sources showed none during the stated coverage/check time. It is not a blanket guarantee of system health.

### C. Maintenance recommendations
- Daily checks: heartbeat/readiness, database and Storage reachability, unresolved incidents, queue age/status, UNKNOWN outcomes, and report delivery outcomes.
- Weekly checks: dependency advisories, database/Storage capacity, recurring errors, query performance, backup integrity, and restore evidence.
- Dynamic recommendations must be based on observed evidence; recurring checklist items may be static.

## 4. Metric definitions and data correctness

- Store report window as explicit Asia/Jakarta start/end timestamps. Scheduler target is 08:00 WIB; Supabase/PostgreSQL should remain UTC. If using pg_cron UTC, schedule **01:00 UTC**, and preserve the timezone contract in code/tests.
- Unique leads are not inbound-message counts. A customer returning after first contact is not a new lead.
- Lead category breakdown is a snapshot at report cutoff, not an aggregation of all category change events. New leads without a reviewed classification remain UNCLASSIFIED.
- BIMBANG means the person is undecided/considering, for example “aku pikir-pikir dulu ya Kak”.
- MASIH_BERTANYA means an open information request; it remains an operational status.
- Closing requires both data completeness and a committed, verified PAID event. Do not infer a payment from an uploaded image or from pendaftar.updated_at.
- Consultation completed is based on a committed Selesai transition, not schedule end time.
- Submitted berkas is based on a durable submission event, not generic row update time.
- Report snapshot and metric source coverage must be stored with the report so a later data change does not rewrite an already sent report.
- If a source ledger starts mid-day or has a known coverage gap, show the gap prominently and qualify the metric.

## 5. Delivery and reliability contract

A new Admin-report delivery ledger must remain separate from:
- Customer Booking Outbox V6.2;
- customer Follow-up jobs;
- existing Bot activity event ledger;
- Admin audit/incident history.

Required design:
- one report run per reporting date and report version;
- immutable report snapshot with window/cutoff, generated time, data coverage, metrics and report text;
- one delivery record per eligible Admin and report date, with a stable unique idempotency key;
- states PENDING, PROCESSING, SENT, FAILED, UNKNOWN;
- bounded lease/claim and send timeout;
- store provider message reference only when returned;
- UNKNOWN is never automatically resent. It requires manual reconciliation first;
- retry only a proven FAILED result, using an explicit authorized operation and the same delivery record/idempotency identity;
- no group recipients or unapproved roles;
- no PII beyond the requested PROSPEK name/phone list in the Consultant business report.

The sender must use the existing verified direct-recipient resolution path and accept only direct one-to-one WhatsApp IDs. It must not fabricate a direct @c.us ID or fall back to group IDs when identity resolution fails.

## 6. Trigger and schedule

- Reporting date: previous calendar day in Asia/Jakarta.
- Trigger time: 08:00 WIB daily (01:00 UTC if pg_cron uses UTC).
- Generate once per reporting date even if the Bot restarts.
- A missed run should be detected and surfaced; recovery may generate the missing snapshot, but it must not blindly resend a report whose provider outcome is UNKNOWN.
- The scheduler creates/claims durable work; it must not rely only on a process-local timer or an in-memory flag.

## 7. Security and access

- Recipients come from active admins rows with roles exactly Admin Konsultan or Super Admin.
- Revalidate role and active status when creating/claiming a delivery.
- Deliver to each recipient privately, one-to-one.
- Admin Verifikator and inactive accounts are excluded.
- Store report snapshots/delivery ledger as server-only data with RLS enabled, no anon/authenticated table access, and least-privilege RPC grants.
- Do not store payment proof, academic document paths, raw transcripts, or arbitrary customer message bodies in the report snapshot.
- Do not display HMAC keys, API keys, or credentials in report or log.

## 8. Change impact

- **Database:** additive report-run snapshot, per-admin delivery ledger, claim/finish/reconcile RPCs, indexes and one scheduled job.
- **Bot:** report formatter, snapshot consumer, role-aware recipient resolution, durable sender, bounded retry/UNKNOWN reconciliation.
- **Portal:** retain existing manual report preview/copy as fallback; optionally expose run/delivery status only after access/UX contract is approved.
- **Monitoring:** report scheduler and delivery outcomes must themselves be observable.
- **WhatsApp:** internal one-to-one delivery only; channel/automation compliance and account risk remain an operational release gate.
- **Tests:** metrics reconciliation, date/cutoff boundaries, role recipient filtering, restart recovery, duplicate job prevention, stale heartbeat, FAILED vs UNKNOWN, no-group guarantee, privacy review.

## 9. Implementation gates and non-goals

- Existing v1.0 activity ledger and HMAC key are preserved; no retroactive event backfill is allowed.
- The existing v1.0 kdj_get_bot_daily_report_stats RPC is not silently changed or replayed; add a versioned function for the extended business report.
- No new WhatsApp FU customer dispatch is enabled.
- No changes to Customer Booking Outbox V6.2 semantics.
- No Staging migration, Cron modification, Bot restart, live WhatsApp send, or Production deployment is authorized by this local execution.
- Run all report tests locally against a restored schema before separate Staging migration approval.

## 10. Owner-approved decisions and open clarifications

Owner-approved in this conversation:
- two report variants (Admin Konsultan and Super Admin);
- private direct messages to each eligible Admin; no group send;
- delivery at 08:00 WIB for the previous calendar day;
- include business metrics and system condition/recommendation sections as described above;
- BIMBANG is the “still considering” category; MASIH_BERTANYA stays operational status;
- unpaid is an end-of-day snapshot, while closing and submit berkas are daily events.

Still requiring technical confirmation before Staging:
- precise stale thresholds for each heartbeat/component;
- whether each Admin role remains one active account or supports multiple recipients (implementation will support all active eligible rows and deduplicate by Admin ID/normalized number);
- whether a failed report can be manually re-sent by Super Admin and the required audit reason;
- report retention period;
- recipient WhatsApp compliance/channel risk acceptance.

## 11. Authorization boundary

Owner approval authorizes this v2.0 direction and local-only source/design preparation. Staging migration/Cron changes, live Admin WhatsApp sends, and Production deployment require separate explicit authorization.


## 12. Local execution evidence — 12 November 2026

The Owner confirmed 08:00 WIB and direct delivery to each eligible Admin individually. Local implementation now includes:

- Immutable report snapshot per business date/version and a separate per-Admin delivery ledger.
- Database claim/finish functions with bounded leases. A lease expiry or ambiguous WhatsApp send becomes UNKNOWN and is never automatically resent. Only proven FAILED deliveries may be retried through a separate audited Super Admin action.
- Bot formatter for the two role-specific variants. Consultant report includes lead totals and category breakdown, a name/phone list for PROSPEK only, separate MASIH_BERTANYA count, scheduled/completed consultation, daily closing, unpaid at end of day, and berkas submissions.
- Super Admin report includes all business metrics plus health, incidents, recommendations, and daily/weekly maintenance items. Missing/stale health evidence is rendered as NOT_CHECKED/STALE rather than Normal.
- Recipient source is active Admin rows whose role is exactly Admin Konsultan or Super Admin. The Bot resolves the recipient using its existing verified WhatsApp identity service and rejects group JIDs.
- Bot polling is wired at 30-second intervals, but only when `KDJ_ADMIN_DAILY_REPORT_DELIVERY_ENABLED=true`. The variable is currently unset in the local Bot `.env`, so code default is OFF. No report was claimed or sent in this execution.
- PostgreSQL Staging reports `cron.timezone = GMT` and database timezone UTC. The candidate `0 1 * * *` cron schedule therefore maps to 08:00 WIB. The current Staging `cron.job` query returned no report-generation job; the candidate migration would create it after separate approval.

Lead-source correction:
- The report counts unique first inbound profiles from `kdj_followup_profiles.first_inbound_at`, not inbound messages and not only applicants in `pendaftar`.
- The additive payment/progress migration adds the first-inbound anchor for profiles created after rollout. Existing profiles are intentionally not backfilled because `last_inbound_at` cannot reconstruct the true first inbound. Report dates before the ledger's start are marked partial.
- The effective category is the latest Bot recommendation/Admin decision as of report cutoff. A later inbound invalidates an older classification; the report then counts that lead as UNCLASSIFIED until a new recommendation/decision exists.
- Prospek name lookup uses customer-provided applicant fields only; push_name is not used.

Validation:
- Bot report formatter tests: PASS.
- Bot report delivery tests: PASS, including disabled flag, WhatsApp-not-ready, role restrictions, no-group guard, provider-message reference, and UNKNOWN/no-auto-resend.
- Bot Daily Report activity regression: PASS.
- Portal report/payment contract checks: PASS.
- SQL has not yet been executed on a local restore because the local PostgreSQL listener requires a credential not available in this execution. Staging was read-only; no migration or Cron job was applied.
- No WhatsApp message was sent.

Before Staging activation: validate both SQL migrations against a fresh local restore, review report samples/reconciliation, apply the additive migrations in an approved Staging window, verify Cron creates the 08:00 WIB run, then enable the Bot delivery feature flag only for a supervised direct-message UAT. Keep the flag OFF until those gates pass.

## 13. Controlled local implementation addendum — recipients, health freshness, and recovery

The Owner authorized local correction of the four open technical findings. This addendum preserves the approved report content, reporting time, role recipients, PII boundary, and no-group rule. It does not authorize Staging migration or live delivery.

### Recipient deduplication
- Active eligible Admin numbers are normalized to canonical Indonesian local form (`08...`) before delivery rows are generated.
- If more than one active eligible Admin record maps to the same normalized number, all accounts sharing that number are withheld from that report run. The Super Admin snapshot records the count of duplicate-number groups.
- A unique database index on `(report_run_id, recipient_phone)` provides a second guard against duplicate direct messages.
- The Super Admin report formatter displays the duplicate-recipient conflict count. The Consultant report does not disclose other Admin contact details.

### Heartbeat freshness contract
The local report snapshot applies:
- 180 seconds for Bot process, WhatsApp connection, Gemini request heartbeat, and Supabase heartbeat.
- 300 seconds for Portal heartbeat.

These are freshness thresholds, not assertions that a component is DOWN. An absent signal is `NOT_CHECKED`; an old signal is `STALE`. Portal's 300-second threshold matches the existing Portal monitoring route. The Bot emits process/WhatsApp/Supabase heartbeat every 30 seconds; Gemini heartbeat is request-driven, therefore an idle model can become STALE without being declared DOWN. Review these operational thresholds during Staging UAT against observed runtime cadence.

### Super Admin recovery surface
- Added a server API and Admin Portal recovery panel restricted to Super Admin.
- The delivery list exposes only FAILED/UNKNOWN rows, masked recipient numbers, bounded error text, and report date. It does not return the recipient's full phone number or report body.
- `FAILED` can be requeued only through `kdj_admin_retry_failed_daily_report_delivery`, with actor identity taken from the authenticated Admin session and a mandatory reason.
- `UNKNOWN` must be resolved first: mark SENT only with a provider message reference; mark FAILED only after explicit confirmation that the recipient chat was checked and no message exists. Marking UNKNOWN as FAILED does not send a message. A later retry is a separate audited action.
- The Portal does not send WhatsApp messages directly. A retry returns the durable delivery to PENDING; the Bot worker processes it only when its feature flag is enabled and WhatsApp is ready.
- Admin Konsultan can view/copy the manual report but cannot see or invoke recovery controls.

### Validation and rollout gate
Focused source-contract tests cover role enforcement, actor identity, phone masking, the UNKNOWN confirmation gate, separate retry/reconcile RPCs, recipient deduplication, and heartbeat thresholds. Local source validation does not replace SQL runtime validation. The delivery flag remains OFF; no delivery was claimed or sent. Staging migration, Admin UAT, and separate delivery activation approval remain mandatory.


Clarification closure: the earlier Section 10 items for precise heartbeat freshness thresholds and Super Admin manual retry/reconciliation are now defined by this local implementation addendum. Report retention duration and WhatsApp compliance/channel risk acceptance remain open release decisions.
