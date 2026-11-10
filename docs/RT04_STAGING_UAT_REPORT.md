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
