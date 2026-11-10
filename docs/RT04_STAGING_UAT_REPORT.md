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

The Bot local key matches the Staging key store. The Portal Admin local key currently does **not** match the Admin key store; proof returned `INVALID_ADMIN_ATTESTATION`. The Admin audit table remains empty. No successful Admin booking test has been attempted.

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

## Admin Booking UAT — BLOCKED

Portal/Admin positive Staging UAT is blocked only by key mismatch:

- Local Portal `.env.local` has a valid 32-byte `KDJ_ADMIN_BOOKING_HMAC_KEY`.
- Staging has one active `admin-v1` key row.
- Signing with the local Portal key is rejected by Staging as `INVALID_ADMIN_ATTESTATION`.
- No Admin booking or Admin audit row was created.
- The bootstrap RPC is currently postgres-only; service_role cannot invoke it.

Required operator action:
1. In Supabase Dashboard, select the KDJ Staging project and open SQL Editor.
2. Run the one-time reconciliation transaction from `docs/RT04_STAGING_ADMIN_KEY_SYNC.md`, using the current local `KDJ_ADMIN_BOOKING_HMAC_KEY` from Portal `.env.local` (paste it locally; never send the secret in chat).
3. Confirm the result code is `KEY_PROVISIONED` and key metadata shows `admin-v1 / ACTIVE / 32 bytes`.
4. Report only the result code and metadata row.

After key sync, rerun:
- HMAC proof using a non-existent Admin ID (must return `ADMIN_SESSION_REVOKED_OR_UNAUTHORIZED`, proving the signature now matches).
- Positive Admin UAT with an active authorized DB Admin, unique UAT lead, durable Admin audit row, and Scheduling V2 Outbox row.
- Exact replay, altered-payload replay, tampered signature, inactive Admin and stale session_version negative tests.
- Cancel the UAT booking and supersede its synthetic Outbox events; no live WhatsApp sends.

## Current gate summary

- RT-04 Bot Staging RPC/HMAC/UAT: PASS (synthetic provider; no live WhatsApp send).
- Staging legacy bypass revoke: PASS.
- Admin attested lane schema/security/local integration: PASS.
- Admin key proof / positive Admin UAT: BLOCKED pending operator key sync.
- Vercel Preview is not a Staging target; Vercel env points to a separate Supabase project reporting INACTIVE. No Vercel env change or deployment made.
- VPS: not provisioned yet; future deployment gate remains.
- Production: untouched by this work.
