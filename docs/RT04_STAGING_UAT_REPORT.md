# KDJ Staging UAT Report — RT-04 and Admin Booking

**Date:** 2026-11-10 (Asia/Jakarta)
**Supabase Staging:** `pgmdurnylyuqkikbwwwy` / `kdj-staging-v6`
**Portal branch:** `feature/kdj-portal-work-20261109`
**Bot branch:** `feature/kdj-wa-bot-work-20261109`
**Production:** untouched

## Migration and security review

The following migrations are applied and recorded in the Staging migration ledger:

- `20261110005919_kdj_direct_customer_booking_approval_gate_rt04`
- `20261110005924_kdj_admin_booking_attested_lane`
- `20261110010908_kdj_staging_key_bootstrap_window`
- `20261110011336_kdj_lock_staging_key_bootstrap`
- `20261110014506_kdj_staging_revoke_legacy_booking_bypass`

Post-migration checks confirm all new objects exist, functions are postgres-owned SECURITY DEFINER with empty search_path where required, and the key/audit tables are not directly readable by service_role.

The temporary service_role bootstrap window was closed. Both key rows exist in Staging as ACTIVE with 32 bytes:
- Bot: `rt04-v1`
- Admin: `admin-v1`

The Bot local key matches the Staging key store. The Portal Admin local key matches the active Staging `admin-v1` key. A validly signed request using a synthetic unknown Admin identity was rejected as `ADMIN_SESSION_REVOKED_OR_UNAUTHORIZED`, confirming that the HMAC was accepted while actor authorization was denied. The successful Admin CREATE/replay/cancel path and negative authorization tests are recorded below.

## RT-04 Bot customer approval UAT

Test method: executed the Bot approval service against the live Staging RPCs using a synthetic WhatsApp message/provider stub. The test did not call WhatsApp Web or a live provider.

| Step | Expected | Actual |
|---|---|---|
| PREPARE customer booking | Durable `PREPARED` request, correct policy snapshot | PASS |
| Synthetic summary message | Exactly one provider acknowledgement; no external send | PASS |
| Record summary send evidence | `AWAITING_APPROVAL`, expiry based on synthetic provider timestamp | PASS |
| Explicit `SETUJU` | One booking + one Outbox event | PASS |
| Exact replay of same provider approval message | `IDEMPOTENT_REPLAY`; no duplicate booking/Outbox | PASS |
| Admin cancellation of UAT booking | Status becomes `Batal` | PASS |
| Prevent future dispatch | All UAT Outbox events marked `SUPERSEDED` | PASS |

Synthetic UAT evidence:
- Approval ID: `1f409a81-41bc-4cf6-809f-a64cf2f5ab63`
- Request ID: `b8c572ea-6de1-41e4-9a44-7f2397394075`
- Booking ID: `0bb2491f-e270-4402-941d-2b18a8596c34`
- Booking result: `BOOKING_CREATED`
- Exact replay result: `IDEMPOTENT_REPLAY`
- Cancellation result: `BOOKING_UPDATED`
- Booking final status: `Batal`
- Scheduled start: 2026-11-12 10:00 WIB
- Consultation end: 12:00 WIB (120 minutes)
- Slot buffer end: 12:30 WIB (150-minute total block)
- Created event ID: `f628bafb-e461-4ad9-8978-567ce0556a74`
- Cancellation event ID: `6ed50d6e-a353-425c-aa9f-f30362c107e9`
- Both Outbox events: `SUPERSEDED`
- Synthetic provider send count: 1
- Actual WhatsApp provider calls: 0

A previous harness attempt created a PREPARED-only request but failed before invoking the synthetic message provider because its local date formatter rejected an ISO string. The subsequent successful run used a new request and the previous request was superseded by the database workflow; no booking or Outbox was created by the failed attempt.

Note: `jadwal_konsultasi.notification_status` only permits `PENDING/SENT/FAILED`, while Outbox supports `SUPERSEDED`. The UAT booking's legacy summary remains `PENDING`, but its `latest_notification_id` points to the cancellation event whose authoritative Outbox status is `SUPERSEDED`; no dispatchable UAT event remains.

## Legacy bypass cutover proof

After applying `20261110014506`:

- Direct service_role call to legacy RPC returns HTTP 403 / SQLSTATE 42501.
- service_role direct booking-table INSERT/UPDATE/DELETE/TRUNCATE privileges are all false.
- service_role booking-table SELECT remains true.
- postgres retains execution of the internal Scheduling V2 core.
- Admin attested and RT-04 service RPCs remain executable by service_role.
- RT-04 recovery proof after cutover returns `NO_PENDING_APPROVAL` for an unused test identity, proving the Bot HMAC signature still passes.

## Admin Booking UAT — PASS (positive path)

**Target:** Supabase Staging `pgmdurnylyuqkikbwwwy` / `kdj-staging-v6`

**Key proof:** PASS. The Portal-generated HMAC was accepted; a synthetic unknown Admin identity was rejected as `ADMIN_SESSION_REVOKED_OR_UNAUTHORIZED`, proving the local Portal key matches the active Staging `admin-v1` key. No key material was exposed in logs or this report.

Positive UAT was executed through `public.kdj_admin_create_booking_attested` with an active DB Admin:

| Field | Verified value |
|---|---|
| Actor username | `konsultan` |
| Actor role | `Admin Konsultan` |
| Actor session_version | `1` |
| Action / audit outcome | `CREATE / BOOKING_CREATED` |
| Audit ID | `8c19999c-284e-4175-9b9c-073097f4258b` |
| Booking ID | `0b7b6912-1cce-49c9-9e0f-f861ab1b4008` |
| Synthetic lead | `KDJ UAT Admin RT04 20261110` |
| Synthetic phone | `080000000001` |
| Method / schedule | `Zoom / 2026-11-12 10:00 WIB` |

Assertions completed successfully inside the SQL UAT block:
- CREATE returned `BOOKING_CREATED`.
- Exact replay returned `IDEMPOTENT_REPLAY` for the same booking; it did not create duplicate booking, audit, or Outbox rows.
- Admin cancellation returned `BOOKING_UPDATED`; final booking status is `Batal`.
- Exactly one matching durable Admin CREATE audit row exists for the actor and booking.

Read-only post-UAT verification returned:
- Booking rows: 1; final status: `Batal`.
- Matching Admin CREATE audit rows: 1.
- Outbox rows: 2 (one `BOOKING_CREATED`, one `BOOKING_CANCELLED`); both `SUPERSEDED`.
- Dispatchable/uncertain Outbox rows: 0.
- Outbox rows with `provider_message_id`: 0.
- Outbox rows with active `locked_at` / `claim_token`: 0.

The test used a synthetic recipient and SQL-only database operations; no WhatsApp provider was invoked. The legacy `jadwal_konsultasi.notification_status` mirror remains `PENDING`, but the authoritative Outbox rows are both `SUPERSEDED`; no dispatchable event or claim remains.

## Admin Booking UAT — Staging negative tests

Executed against `public.kdj_admin_create_booking_attested` through the Staging service_role RPC using fresh Portal-generated HMAC signatures, except the deliberately corrupted signature:

| Case | Expected result | Actual result |
|---|---|---|
| Tampered signature | `INVALID_ADMIN_ATTESTATION` | PASS |
| Changed payload with previously consumed nonce | `ATTESTATION_REPLAY_MISMATCH` | PASS |
| Existing idempotency key reused with changed payload | `IDEMPOTENCY_KEY_REUSED` | PASS |
| Valid HMAC but stale positive session_version | `ADMIN_SESSION_REVOKED_OR_UNAUTHORIZED` | PASS |

Post-test read-only verification confirms:
- Admin `konsultan` remains active with `session_version = 1`.
- No booking was created by any negative test payload.
- Admin audit row count for the tested positive booking actor remains 1.
- At the time of the negative Admin test run (before the subsequent live Portal UAT), global Outbox had 3 `SENT` historical rows and 4 `SUPERSEDED` rows; no `PENDING`, `PROCESSING`, `FAILED`, or `UNKNOWN` rows.

**Inactive Admin case — PASS:** No inactive Admin account existed in Staging, so a controlled single-transaction test temporarily set the dedicated test Admin row inactive, called the attested RPC with a fresh valid HMAC, asserted `ADMIN_SESSION_REVOKED_OR_UNAUTHORIZED`, and restored `is_active = true` before the transaction completed. The SQL block completed without exception. Post-run read-only verification confirmed the actor is active again with `session_version = 1`, and there are zero booking and zero Admin audit rows for the inactive-admin test payload. No lasting Admin account change or test booking was left behind.

## Portal and real WhatsApp end-to-end UAT — outbound provider send PASS

**Test date:** 2026-11-10 (Asia/Jakarta)
**Portal:** local Next.js dev server at `http://127.0.0.1:3100`, localhost only
**Supabase:** Staging `pgmdurnylyuqkikbwwwy` / `kdj-staging-v6`
**Bot:** local branch `feature/kdj-wa-bot-work-20261109`, HEAD `8023fb0`

### Portal login and manual booking

The operator confirmed in Incognito that the Portal opened without repeated refresh, rendered normally, accepted Admin login, and displayed the manual booking form. The operator submitted two test bookings:

| Lead | Booking ID | Recipient | Result |
|---|---|---|---|
| Jihad | `0d4acd03-fcb8-40a8-b006-6e672688b828` | Synthetic number ending `5678` | Booking created; notification deliberately quarantined |
| Umair | `b780df55-cf42-4dcd-94f5-8d1c2a566af4` | Operator-controlled WhatsApp number ending `1604` | Booking created; real outbound message sent |

Umair booking snapshot:
- Status: `Terjadwal`
- Method: `Zoom`
- Schedule: 2026-11-13 15:00 WIB
- Latest Outbox event: `6e53edd5-14c9-4521-8fff-2d7539d139e6` / `BOOKING_CREATED`

### Synthetic-recipient quarantine

Before starting the live Bot, the Jihad event was the oldest pending Outbox event. It was claimed and finished through the existing worker RPC pair, not by direct table DML:
- Claim RPC: `kdj_claim_booking_notifications`
- Finish RPC: `kdj_finish_booking_notification`, outcome `FAILED`
- Final status: `FAILED`, attempts: 1, provider message ID: NULL
- Recorded reason: synthetic recipient intentionally withheld before WhatsApp provider send; do not retry.

The Jihad booking row remains `Terjadwal` in Staging and is test data; cancel it through the Admin Portal when convenient to release its schedule slot. Its current notification event is not dispatchable.

### Real WhatsApp outbound send

The local Bot was started with `npm start`. Its environment was verified to point to Staging, with the required credentials present and Chromium sandbox disablement set to false. Logs confirmed:
- WhatsApp session authenticated and Bot reached `READY`.
- WhatsApp Web runtime version: `2.3000.1053820627`.
- The Bot resolved the Umair recipient and sent Outbox event `6e53edd5-14c9-4521-8fff-2d7539d139e6`.
- WhatsApp `sendMessage` resolved; Outbox was acknowledged as `SENT`.
- Booking mirror `jadwal_konsultasi.notification_status` also became `SENT`.
- Attempts: 1; provider message ID present; `sent_at`: 2026-11-10 11:10:27 WIB; `last_error`: NULL.

Final global Outbox counts after the send:
- `SENT`: 4
- `SUPERSEDED`: 4
- `FAILED`: 1 (Jihad synthetic-recipient quarantine)
- `PENDING / PROCESSING / UNKNOWN`: 0

The provider-send and database-acknowledgement path is **PASS**. The operator subsequently confirmed that the booking confirmation message appeared in the destination WhatsApp, so handset receipt is **MANUALLY CONFIRMED**. No read receipt / blue-tick evidence is claimed. The local Bot process was stopped after the successful outbound acknowledgement to prevent unattended live-inbox processing; it can be restarted for the next explicitly coordinated inbound UAT.

### Remaining live-chat scope

- Inbound customer conversation and AI response: **PENDING**.
- Customer booking consent via real WhatsApp (`SETUJU` / replay / `BATAL`): **PENDING**.
- End-to-end inbound approval/cancellation with provider evidence: **PENDING**.

Runtime evidence note: the Bot was run from the local worktree at HEAD `8023fb0`; before this UAT the worktree already contained one uncommitted `index.js` line passing `handleBookingApprovalMessage` into the message-handler registration. This UAT did not edit or commit Bot source. Portal worktree was also not clean before this UAT; no Portal source or dependency files were changed by this UAT. Production and Vercel were not touched.

## Current gate summary

- RT-04 Bot Staging RPC/HMAC and synthetic approval UAT: PASS (no live WhatsApp send).
- Staging legacy bypass revoke: PASS.
- Admin attested lane schema/security/local integration: PASS.
- Admin key synchronization proof: PASS.
- Admin positive Staging UAT (CREATE, durable audit, exact replay, cancel, Outbox quarantine): PASS.
- Admin negative Staging tests (tampered signature, altered payload/nonce replay, idempotency key reuse, stale session): PASS.
- Inactive Admin Staging test: PASS (transactionally disabled only during the RPC check; restored active before commit; post-run actor state and absence of booking/audit verified).
- Portal Admin login/manual booking and real WhatsApp outbound send to a team-controlled test phone: PASS (Portal → Staging Outbox → Bot → WhatsApp provider; provider message ID and DB SENT acknowledgement verified; operator manually confirmed the message appeared on the handset). Read receipt is not asserted. Inbound AI conversation, real customer approval, replay, and cancellation UAT remain PENDING.
- Vercel Preview is not a Staging target; Vercel env points to a separate Supabase project reporting INACTIVE. The Vercel `WA_BOT_API_URL` variable is sensitive and its value was returned empty by the available API, so its host remains unverified. No Vercel env change or deployment made.
- VPS: not provisioned yet; future deployment gate remains.
- Production: untouched by this work.

---

## Akta Kelahiran and Daily Report API/Storage UAT — 10 November 2026

**Target:** Supabase Staging pgmdurnylyuqkikbwwwy; local Portal 127.0.0.1:3000.
**Test data:** One temporary synthetic applicant and one-pixel PNG test files. Temporary applicant/document rows and Storage objects were removed in the test cleanup.

### Akta Kelahiran
| Case | Expected | Result |
|---|---|---|
| Final submit without Akta Kelahiran | HTTP 400 and missing Akta identified | PASS |
| Upload Akta Kelahiran through applicant endpoint | File accepted, private Storage object created, document row persisted | PASS |
| Admin Verifikator document retrieval | Signed Akta document record visible | PASS |
| Cleanup | Synthetic applicant, document rows and uploaded test objects removed | PASS |

This run proves the local Portal API and Staging Storage integration for Akta upload/retrieval. It did not run a full browser interaction, real customer OTP, or a successful final submit that would call the external WhatsApp status-notification endpoint.

### Daily Report role/API UAT
| Actor | Expected | Result |
|---|---|---|
| Super Admin | Report endpoint allowed | HTTP 200 — PASS |
| Admin Konsultan | Report endpoint allowed | HTTP 200 — PASS |
| Admin Verifikator | Report endpoint denied | HTTP 403 — PASS |
| No authenticated session | Report endpoint denied | HTTP 401 — PASS |

The report API returned non-empty report text for the allowed roles. Generation remains manual and copy-only; no WhatsApp/email auto-send is implemented or authorized. Browser UI rendering and clipboard interaction were not covered by this API test.

### Current related automated verification
- Portal scripts/test-birth-certificate-upload.mjs: PASS, including the four-slot Portal document contract and no applicant Passport upload slot.
- Portal npm run test:daily-report: PASS after correcting the contract script to the applied migration filename 20261110083515_kdj_bot_daily_reporting_20261109.sql.
- Portal qualification/follow-up contract tests: PASS.
- Portal ESLint: PASS, zero errors and five existing no-img-element warnings.
- Latest Portal build before the subsequent Passport-flow adjustment: PASS. A final build after the Passport-flow adjustment is still required.
- Bot check, test:baseline, test:scheduling, test:qualification, test:daily-report, and test:rt04: PASS after Markdown approval. RT04 result is synthetic/automated and is not live customer consent UAT.

### Remaining live UAT
- Applicant browser journey with real OTP: PENDING (depends on WhatsApp Bot readiness).
- Full successful final submit through the external notification call: PENDING.
- Daily Report browser UI/clipboard UAT: PENDING.
- Real customer WhatsApp RT04 summary → SETUJU → replay → BATAL: PENDING.

---

## Final Portal/Bot regression supplement — 10 November 2026

After the Passport handoff change:
- Applicant Passport upload endpoint test: **PASS** — POST /api/upload-dokumen with jenis_dokumen=paspor returns HTTP 400; temporary applicant row was removed.
- Portal production build: **PASS** — Next.js 16.4.3; compilation and TypeScript passed; all 19 static pages generated; all application/API routes listed; exit code 0.
- Bot final regression after revised Passport SOP/KB/Few-Shot/Guardrails: check, baseline, scheduling, qualification, daily-report and RT04 all **PASS**.
- Portal contract checks, Daily Report API contract, ESLint and git diff --check remain PASS as recorded above.

The Bot RT04 suite remains automated/synthetic. Live customer WhatsApp approval is still pending. The Bot readiness incident remains under the operator's handling and is not closed by this regression run.


---

## Staging UAT data reset — 10 November 2026

Owner-directed cleanup completed on Supabase Staging project pgmdurnylyuqkikbwwwy after the current API/contract/build evidence was recorded.

- 189 rows removed across transactional and UAT tables: applicants/documents, bookings/outbox, follow-up/consent/profile/jobs, lead qualifications/events, Bot activity, heartbeat/incidents, OTP, RT04 customer approvals/nonces, Admin booking audit, and Admin lifecycle audit.
- 12 objects removed from the berkas_kdj Storage bucket through the Storage API; bucket retained and verified empty.
- Three public.admins rows remain and all three are active.
- Bot and Admin HMAC key-custody rows remain (one in each key table).
- Required singleton system config remains: kdj_bot_reporting_config, kdj_system_controls, and kdj_followup_delivery_gate (one row each).
- kdj_bot_reporting_config.ledger_enabled_at reset to NULL. The next successfully recorded Bot event will establish the new reporting coverage start.
- Schemas, functions, ACLs, migration history, and the Production project were not changed.

Post-reset smoke: Super Admin session still receives HTTP 200 from the Daily Report API with an empty event ledger; the three Admin accounts remain active.

## Bot dependency activation / readiness update — 10 November 2026

The earlier note that Bot readiness/heartbeat remained under operator repair is superseded for the local Staging process:

- Remediated dependency graph is installed in the main Bot repository using npm ci.
- Puppeteer 25.16.0 postinstall was explicitly approved and rebuilt; Chromium 156.0.8078.47 headless launch smoke passes.
- 14/14 Bot tests, npm run test:baseline, npm run check and security checks pass; npm audits report 0 vulnerabilities.
- Bot restarted as PID 18436 and emitted WhatsApp READY. WhatsApp Web runtime: 2.3000.1053914165.
- Supabase Staging heartbeats at 2026-11-10 15:39:27 UTC and 15:39:57 UTC show bot_process OK, Supabase OK and WhatsApp OK/READY.
- A safe authenticated Portal → Bot route check returned HTTP 400 INVALID_PAYLOAD, proving API-key middleware acceptance without sending a WhatsApp message.

**Still pending:** fresh inbound customer conversation UAT, RT04 live customer summary → exact SETUJU → replay → BATAL, and Outbox provider send/ack after this dependency activation. No live test/customer WhatsApp message was sent during the activation work. Production remains untouched.

## Live WhatsApp UAT update — 10 November 2026

**STG-05 — PASS (limited inbound/reply evidence):** After the Bot restart, Staging ledger recorded CUSTOMER_INBOUND at 23:09:11 WIB and BOT_REPLY at 23:09:22 WIB. The Bot log confirmed successful LID resolution to operator-controlled handset suffix 1604. A lead-qualification timeout warning occurred on that message; the chat reply was still recorded. Full booking-intent conversation remains part of UAT-07.

**STG-06 — PASS:** An Admin-attested synthetic Staging booking for the internal test handset produced a BOOKING_CREATED Outbox send and provider message ID (one attempt). The booking was then changed to Batal through the approved Admin booking RPC; the resulting BOOKING_CANCELLED Outbox event also reached SENT with provider message ID (one attempt). Final booking status Batal. Global Staging Outbox after test: 2 SENT rows, both provider acknowledged; no PENDING/PROCESSING/UNKNOWN/FAILED rows.

**UAT-07 — OPEN:** Live customer decision flow still needs the controlled operator handset to start a booking conversation and personally send SETUJU/BATAL. Exact replay of the same provider message ID remains covered by the synthetic service-flow test; a separately typed second SETUJU is a duplicate-intent check, not the same transport message replay.

Policy boundary: RT04 BATAL cancels a pending approval only. It does not cancel a CONSUMED booking. Verify BATAL against a second pending approval; cancel any already-created test booking through the Admin lane. No CR/CIR-approved expansion of customer appointment cancellation is in scope.


## UAT-07 live follow-up — RT04 SETUJU result (10 November 2026)

The earlier UAT-07 OPEN note is superseded for the `SETUJU` path:
- Controlled handset suffix 1604 completed a live RT04 approval. `private.booking_customer_approvals` records `SETUJU`, status `CONSUMED`, approved at 23:20:18 WIB.
- One booking was created: ID `131635bb-5f1d-4cf6-a780-9236088ce002`, customer name `Bejo`, Zoom, 12 November 2026 10:00 WIB, status `Terjadwal`.
- One `BOOKING_CREATED` Outbox event is linked to the booking; it reached `SENT`, attempts 1, provider_message_id present, at 23:20:19 WIB.
- Idempotency snapshot: one approval for the request, one matching booking, one create event, one total event for that booking. No duplicate booking was observed.
- Global Staging Outbox: 3/3 events SENT with provider IDs. Latest heartbeat showed Bot process, Supabase, and WhatsApp READY/OK; no system incident rows.
- Exact same-provider-message replay remains covered by automated contract tests; no live transport replay was claimed.
- Remaining UAT-07 item: `BATAL` on a **second pending approval**. Never use `BATAL` as a cancellation of this already `CONSUMED` booking; that would contradict the approved RT04 contract. Current booking remains `Terjadwal`.

**Disposition: UAT-07 PARTIAL — live SETUJU/booking/outbound path PASS; pending-approval BATAL path OPEN.**


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
