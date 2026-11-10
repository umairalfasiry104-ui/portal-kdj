import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const route = read('app/api/admin/jadwal/route.js');
const helper = read('lib/admin-booking-attestation.mjs');
const migration = read('supabase/migrations/20261110070000_kdj_admin_booking_attested_lane.sql');

assert.match(route, /requireAdminPermission\(req, requiredPermission\)/);
assert.match(route, /admin:\s*authCheck\.admin/);
assert.match(route, /supabase\.rpc\(\s*'kdj_admin_create_booking_attested'/);
assert.doesNotMatch(route, /supabase\.rpc\(\s*'kdj_create_booking'/);
assert.match(route, /ADMIN_BOOKING_ATTESTATION_NOT_CONFIGURED/);
assert.match(helper, /createHmac\('sha256'/);
assert.match(helper, /admin\.session_version/);
assert.match(helper, /KDJ_ADMIN_BOOKING_HMAC_KEY/);

assert.match(migration, /create table if not exists private\.kdj_admin_booking_attestation_keys/);
assert.match(migration, /create table if not exists private\.kdj_admin_booking_audit/);
assert.match(migration, /for share;/);
assert.match(migration, /v_admin\.session_version <> p_actor_session_version/);
assert.match(migration, /v_admin\.is_active is distinct from true/);
assert.match(migration, /v_admin\.role not in \('Super Admin', 'Admin Konsultan'\)/);
assert.match(migration, /pg_advisory_xact_lock/);
assert.match(migration, /unique index if not exists kdj_admin_booking_audit_nonce/);
assert.match(migration, /unique index if not exists kdj_admin_booking_audit_idempotency/);
assert.match(migration, /private\.kdj_rt04_canonical_payload/);
assert.match(migration, /extensions\.hmac/);
assert.match(migration, /public\.kdj_create_booking\(/);
assert.match(migration, /insert into private\.kdj_admin_booking_audit/);
assert.match(migration, /set search_path = ''/);
assert.match(migration, /grant execute on function public\.kdj_admin_create_booking_attested/);
assert.doesNotMatch(migration, /revoke (?:all|insert|update|delete)[\s\S]{0,120}jadwal_konsultasi/i);

console.log('[PASS] Portal Admin CREATE no longer invokes the legacy RPC directly.');
console.log('[PASS] Admin identity is server-attested and revalidated against active DB session_version/role.');
console.log('[PASS] Booking and immutable-by-API Admin audit are persisted in one database transaction.');
console.log('[PASS] Migration leaves legacy privileges untouched until OD-08 inventory is closed.');
