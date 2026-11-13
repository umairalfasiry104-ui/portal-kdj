# STG-05 / STG-06 / UAT-07 — Live WhatsApp UAT Record

**Date:** 10 November 2026 (Asia/Jakarta)  
**Scope:** Local KDJ Bot + Supabase Staging only  
**Supabase ref:** `pgmdurnylyuqkikbwwwy`  
**Bot instance:** PID 18436; local API `127.0.0.1:3001)  
**Internal test handset:** operator-controlled Admin handset, suffix 1604. This is an internal test identity, not a real applicant/customer.  
**Production:** untouched.

## Status summary

| ID | Test | Current result |
|---|---|---|
| STG-05 | Fresh inbound WhatsApp message and Bot response | **PASS — limited live evidence** |
| STG-06 | Outbox provider send + provider ID + cleanup | **PASS** |
| UAT-07 | Customer RT04 summary → SETUJU → replay → BATAL | **PASS WITH FOLLOW-UP / STAGING ONLY — PREPARE calendar validation fixed; exact replay remains automated evidence** |

## STG-05 — inbound WhatsApp and Bot response

Staging activity ledger shows one inbound event and one successful Bot reply from the newly activated Bot instance:

- `CUSTOMER_INBOUND`: 2026-11-10 16:09:11 UTC / 23:09:11 WIB.
- `BOT_REPLY`: 2026-11-10 16:09:22 UTC / 23:09:22 WIB.
- The Bot log confirms a live LID sender was resolved successfully to the operator-controlled test handset suffix 1604.
- The reply instrumentation records a successful `msg.reply()` before writing `BOT_REPLY`; the ledger stores only the hashed event key, not the inbound body or customer identity.

**Observed degradation:** The same message path logged `Lead qualification timed out`; the lead remained `UNCLASSIFIED`/pending review. The main chat did continue and the Bot reply event was recorded. No open system incident was present at final check.

This proves inbound reception, LID resolution and a successful Bot reply on the activated runtime. It does not yet prove a full booking intent or RT04 approval flow.

## STG-06 — Outbox live provider send and cleanup

Test was executed using the Admin-attested Staging booking RPC, not direct table INSERT. The internal Admin handset suffix 1604 was used as the recipient.

Synthetic booking:
- Name: `KDJ INTERNAL STG06 TEST`
- Booking ID: `d6bf64b2-f8a4-46a5-b972-b0a05bdf4d7c`
- Schedule: 12 November 2026, 10:00 WIB
- Method: Zoom
- Final booking state: `Batal`

Provider events:
| Event | Outbox ID | Result |
|---|---|---|
| `BOOKING_CREATED` | `a93a7aa4-4c3f-4671-926c-979bd2235468` | `SENT`, attempts 1, provider_message_id present |
| `BOOKING_CANCELLED` | `8f61fa82-b575-4350-a3c9-e5bffc53fad6` | `SENT`, attempts 1, provider_message_id present |

Evidence:
- Both Bot worker wake-up calls returned HTTP 200 `OUTBOX_PROCESSED`, processed 1.
- `BOOKING_CREATED` acknowledged at 2026-11-10 16:07:30.840733 UTC / 23:07:30 WIB.
- `BOOKING_CANCELLED` acknowledged at 2026-11-10 16:07:32.728685 UTC / 23:07:32 WIB.
- Provider message IDs were present for both messages; exact IDs are intentionally not copied into this report.
- Final read confirmed the synthetic booking status `Batal`.
- Global Staging Outbox after the test: exactly 2 rows, both `SENT`, both with provider message IDs. No `PENDING`, `PROCESSING`, `UNKNOWN`, or `FAILED` rows remained.
- Open system incidents: 0.

The provider send/DB acknowledgement contract passed. A handset read receipt is not asserted; no user confirmation of the message display was collected as part of this automated check.

## UAT-07 — RT04 live customer consent

**Not yet complete.** Automated RT04 service-flow tests already passed with synthetic provider stubs, but they are not live customer-consent evidence.

No row currently exists in `private.booking_customer_approvals` from the new inbound test event. A full approval flow has not yet begun.

### RT04 BATAL rule — important test expectation

The approved RT04 architecture specifies that:
- `SETUJU` finalizes an eligible pending approval into one booking.
- Exact replay of the same provider approval message returns the stored outcome and must not create another booking/Outbox event.
- `BATAL` cancels a **pending approval only**. It never creates a booking.
- Once an approval is `CONSUMED`, `BATAL` does not cancel the resulting booking. Existing customer appointment cancellation after booking creation remains an Admin operation under the current approved scope.

Therefore the safe full test sequence is:
1. Start a controlled booking request from the test handset; receive and inspect the canonical summary.
2. Send exact `SETUJU`; verify one booking and one create Outbox event.
3. Test replay/idempotency: the same provider-message replay is covered by the automated Staging contract; a second separately sent `SETUJU` can be tested as a duplicate-intent check, but must not be mislabeled as the same provider-message replay.
4. Send `BATAL` to a **second pending approval** to verify it becomes `CANCELLED` and creates no booking.
5. Cancel the first already-created synthetic booking through the Admin lane for cleanup.

Do not change the RT04 rule so that `BATAL` cancels a consumed booking without a CR/CIR and approved scope update.

### Required external action

The operator must send a fresh WhatsApp message from the internal test handset suffix 1604 to the KDJ Bot, starting a controlled consultation request. Continue only against that controlled test identity. No real applicant/customer number should be substituted without explicit authorization. After the Bot produces the booking summary, the operator must personally send the exact `SETUJU` or `BATAL` command from that handset; the system must not fabricate or send customer approval on the operator's behalf.

## Final release boundary

- STG-05 inbound + reply: pass for the observed controlled message; booking-intent continuation still required as part of UAT-07.
- STG-06 Outbox: pass.
- UAT-07 RT04 live consent: open.
- No Production changes, deployment, commit, or push.

## Evidence Ledger — STG-05 / STG-06 / UAT-07 (10 November 2026)

| Requirement ID | Method / command | Result | Environment | Commit / hash | Status / rationale |
|---|---|---|---|---|---|
| STG-05-01 | Query `kdj_bot_activity_events` for events after Bot PID 18436 start; inspect live Bot process output for LID resolver result | CUSTOMER_INBOUND at 23:09:11 WIB; BOT_REPLY at 23:09:22 WIB; LID resolved to controlled handset suffix 1604 | Local Bot + Supabase Staging | Bot HEAD `8023fb0`; no source code change in this test | PASS for inbound/reply. Lead-qualification timed out on the same message; chat reply was recorded and Gemini heartbeat later returned OK. |
| STG-06-01 | Admin-attested `kdj_admin_create_booking_attested`; Bot `POST /process-booking-notifications`; query Outbox/provider acknowledgement | BOOKING_CREATED: SENT, attempts 1, provider ID present | Local Bot + Supabase Staging | Portal HEAD `d22599a`; Bot HEAD `8023fb0`; no source code change in this test | PASS. Internal Admin test handset only; synthetic booking named KDJ INTERNAL STG06 TEST. |
| STG-06-02 | `kdj_admin_update_booking` status Batal; process cancellation Outbox; query booking/events/global Outbox | BOOKING_CANCELLED: SENT, attempts 1, provider ID present; booking final Batal; global Outbox 2 SENT and 0 nonterminal | Supabase Staging | Same baseline commits; no schema/migration change | PASS and cleanup complete. Provider acceptance verified; no read-receipt assertion. |
| UAT-07-01 | Inspect `private.booking_customer_approvals` and customer-controlled WhatsApp evidence | No approval rows created by the inbound test; no live SETUJU/BATAL sequence executed yet | Supabase Staging | Same baseline commits | OPEN. Requires operator action from the controlled handset. |

**Policy note:** RT04 `BATAL` cancels only PREPARED/AWAITING_APPROVAL/APPROVAL_CANDIDATE. It is not a customer cancellation path for a CONSUMED booking. Live UAT should test SETUJU + replay on the first request and BATAL on a second pending request. Any created first booking is cleaned up through the Admin lane.

**Replay distinction:** the automated service/DB regression already covers exact same-provider-message replay. A separately typed second `SETUJU` from the handset creates a new provider message ID and is a duplicate-intent test, not an exact transport replay.


## UAT-07 live RT04 SETUJU evidence — 10 November 2026 (supersedes earlier OPEN note)

**SETUJU path: PASS on live controlled Staging. BATAL path: still pending.**

- Approval row: `c26999f6-f95b-418a-88eb-0cb8c638fa40`; request ID `0402675c-b769-4787-95c5-3a2b6d97b7ef`; status `CONSUMED`; command `SETUJU`.
- Controlled sender suffix: `1604`. Persisted customer name: `Bejo` (the name actually captured by the conversation).
- Schedule: 12 November 2026, 10:00–12:00 WIB, Zoom, Asia/Jakarta; 120-minute consultation + 30-minute buffer (slot blocked until 12:30 WIB).
- Approval accepted at 23:20:18 WIB; booking created at 23:20:18 WIB. Booking ID: `131635bb-5f1d-4cf6-a780-9236088ce002`; final status `Terjadwal`.
- Uniqueness check: 1 approval for the request ID, 1 matching booking, 1 `BOOKING_CREATED` event and 1 total Outbox event for this booking. No later pending approval was found for this sender in the inspected window.
- Outbox `BOOKING_CREATED`: `SENT`, attempts 1, provider_message_id present; provider send accepted at 23:20:19 WIB. This confirms provider acceptance, not a handset read receipt.
- Global Staging Outbox at verification: 3 rows, all `SENT` and all with provider_message_id; no other status rows.
- Latest observed process heartbeats: WhatsApp `OK/READY`, Supabase `OK`, Bot process `OK` at approximately 23:24:58 WIB. Last Gemini heartbeat observed `OK` at 23:09:22 WIB (8,999 ms). No rows in `kdj_system_incidents`.
- Exact same-provider-message replay is covered by the existing synthetic service/DB regression, not a second live handset replay. A separately typed second `SETUJU` is a different provider message and is not claimed as transport replay.
- **Still pending:** test `BATAL` against a second approval while that approval is pending. Do not send `BATAL` expecting it to cancel the current `CONSUMED` booking; the approved RT04 contract does not support that. Keep the current booking unchanged unless the operator explicitly asks for Admin cancellation.

### Current UAT-07 disposition

- Live customer summary → `SETUJU` → exactly one booking → Outbox send: **PASS**.
- Exact transport replay: **PASS in automated Staging contract; not repeated live**.
- Pending-approval `BATAL` path: **OPEN — requires a second pending request and an operator-originated `BATAL`**.
- UAT-07 overall: **PARTIAL**, not fully closed until the pending-approval cancellation path is proven.


## UAT-07 live pending-approval BATAL result + validation follow-up — 10 November 2026

### Live BATAL branch — PASS

- Controlled handset suffix: 1604; test customer name captured by Bot: `Bejo`.
- Second approval ID: `de8170ca-c705-4cc0-9d58-dfe371e20dff`; request ID: `46052e74-dd11-444a-b7ae-e59208cd0dd1`.
- Requested method/time: Offline, 14 November 2026 09:00 WIB.
- Approval prepared at 23:30:16.356 WIB. The inbound BATAL event was recorded at 23:30:35.279 WIB; DB cancellation persisted at 23:30:37.006 WIB; Bot reply event followed at 23:30:37.446 WIB.
- Final approval state: `CANCELLED`; `cancellation_message_ref` present; `booking_id=NULL`; `notification_event_id=NULL`; zero booking rows linked to this approval.
- This verifies BATAL cancels the pending approval only and does not create a booking or Outbox notification.

### Cross-check of the SETUJU branch and system state

- The earlier SETUJU approval remains `CONSUMED`; exactly one linked booking exists with status `Terjadwal`.
- Its `BOOKING_CREATED` Outbox event remains `SENT`, attempts 1, provider_message_id present.
- The cancelled BATAL request did not create a second booking. Across Staging, Outbox has 3 rows, all `SENT`, with 0 PENDING/PROCESSING/UNKNOWN/FAILED.
- Latest Bot process, Supabase, and WhatsApp heartbeats were `OK`; WhatsApp state `READY`; no open system incidents.
- Exact replay of the same provider-message ID is covered by the automated RT04 contract test. No live handset transport replay is claimed.
- The first SETUJU test booking remains `Terjadwal`; no Admin cancellation/cleanup was performed. Do not interpret BATAL for the second pending approval as cancellation of that consumed booking.

### Follow-up finding — closed-day validation occurs too late

The second approval was prepared for Saturday, 14 November 2026 at 09:00 WIB (ISO weekday 6), and the customer-visible approval summary was sent before BATAL was received.

Inspection of the active Staging function definitions shows:
- `public.kdj_prepare_booking_approval` validates identity, method, timezone, duration, buffer, name, and timestamp parsing, but does not validate weekday, working hours, H-1, or slot availability before it persists PREPARED and allows the Bot to send the approval summary.
- The finalization path calls `public.kdj_create_booking`, which does enforce the previous-day rule, Monday–Friday (ISO day 1–5), 09:00–17:00 hours for a 120-minute session, and slot exclusion before inserting a booking.
- Therefore the invalid Saturday approval was cancelled without a booking. If approved, the final booking transaction would reject it with `CLOSED_DAY`; no invalid booking was created in this test.

**Disposition:** UAT-07 customer-consent behavior (live SETUJU, automated exact replay contract, live BATAL against a separate pending approval) is **PASS WITH FOLLOW-UP / STAGING ONLY**. Record the PREPARE closed-day validation gap for a minimal bug-fix review against the frozen Scheduling V2 policy. No source code, schema, migration, or Production change was made during this verification.


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
