# RT-04 Admin Booking Attested Lane

## Purpose
Separate the Portal Admin manual-booking authority from WhatsApp customer booking approval. A manual Admin booking is not represented as customer consent.

## Request path
1. Portal calls the existing `requireAdminPermission(req, 'booking.create')`. This verifies the signed HttpOnly Admin cookie, current DB Admin row, canonical role, active state, phone identity and current `session_version`.
2. Portal creates a short-lived HMAC-SHA-256 attestation using the server-only `KDJ_ADMIN_BOOKING_HMAC_KEY`. The signature binds Admin ID, session version, customer phone/name, method, UTC schedule instant, idempotency key, issue time and a random nonce.
3. Supabase service_role calls only `kdj_admin_create_booking_attested`; the RPC verifies the signature and current Admin row again.
4. The RPC calls the existing Scheduling V2 `kdj_create_booking` transaction core, preserving its scheduling constraints and atomic Outbox event.
5. The same database transaction inserts `private.kdj_admin_booking_audit`. A booking cannot commit without its audit row.
6. Nonce and idempotency hash uniqueness provide durable replay protection. Exact successful retries return the stored booking result.

## Key custody
- Dedicated key ID defaults to `admin-v1`.
- `KDJ_ADMIN_BOOKING_HMAC_KEY` must be at least 32 random bytes represented as hex.
- It is separate from RT04 Bot approval and Daily Report HMAC keys.
- The one-time bootstrap RPC accepts the key only when the private key table is empty, and is executable only by the PostgreSQL operator role (not service_role). It never returns key material.
- Keep the key only in Portal server environment; never use a `NEXT_PUBLIC_` name, browser code, logs, Git, or Bot environment.
- Rotation requires an explicit database migration/change review.

## Cutover boundary
This migration is additive. It does not yet revoke `service_role` DML or legacy `kdj_create_booking` EXECUTE. Those grants remain until OD-08 verifies every deployed/operational caller (including VPS Bot and Vercel deployments) and UAT passes.

## Required environment
`KDJ_ADMIN_BOOKING_HMAC_KEY` and optionally `KDJ_ADMIN_BOOKING_KEY_ID=admin-v1`.

## UAT cases
- Super Admin manual CREATE succeeds and produces one durable Admin audit row and one Scheduling V2 Outbox event.
- Admin Konsultan manual CREATE succeeds and is recorded.
- Admin Verifikator is blocked by Portal RBAC.
- Inactive Admin or changed `session_version` is rejected by the database.
- Missing/mismatched HMAC key is fail-closed.
- Modified payload/signature is rejected.
- Exact replay returns the original booking and does not duplicate booking, audit or Outbox.
- Reused idempotency key with changed payload is rejected.
- Slot conflict / invalid scheduling returns the existing Scheduling V2 domain result.
- Audit record and booking/Outbox rollback together on a database exception.
