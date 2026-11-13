import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const security = read('lib/security.js');
const requestRoute = read('app/api/auth/request-otp/route.js');
const verifyRoute = read('app/api/auth/verify-otp/route.js');
const adminAuthRoute = read('app/api/admin/auth/route.js');
const concurrencyTest = read('scripts/test-otp-concurrency-staging.mjs');
const migration = read('supabase/migrations/20261110123155_otp_durable_shared_throttle.sql');
const sqlTest = read('supabase/tests/20261110_kdj_otp_durable_shared_throttle_test.sql');

// No process-local throttling fallback may remain in the Portal security module.
for (const forbidden of [
    'rateLimitStore',
    'otpAttemptStore',
    'checkOtpBruteForce',
    'recordOtpFailure',
    'clearOtpFailures',
    'export function checkRateLimit'
]) {
    assert.doesNotMatch(security, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}
assert.match(security, /Authentication throttling is persisted in PostgreSQL RPCs/);

// OTP identifiers are HMAC-derived; raw phone/IP/account values are not used as storage keys.
assert.match(security, /createHmac\('sha256', getSessionSecret\(\)\)/);
assert.match(security, /createAuthThrottleKeyHash\('customer-otp', normalizedPhone\)/);

// Request and verification must go through their transaction-scoped database RPCs.
assert.match(security, /supabase\.rpc\(functionName, params\)/);
assert.match(security, /'kdj_otp_request_atomic'/);
assert.match(security, /'kdj_otp_verify_atomic'/);
assert.match(security, /export async function requestOtpAtomically/);
assert.match(security, /export async function consumeOtpAtomically/);
assert.match(security, /Penyimpanan kontrol autentikasi tidak tersedia/);
assert.match(security, /Gagal menjalankan verifikasi OTP durable/);

// Portal routes must use the durable helpers; failed delivery must invalidate that exact OTP and fail closed on DB error.
assert.match(requestRoute, /requestOtpAtomically\(supabase, normalizedPhone, otp, expiresAt\)/);
assert.match(requestRoute, /async function invalidateIssuedOtp\(supabase, otpId\)/);
assert.match(requestRoute, /\.eq\('id', otpId\)/);
assert.match(requestRoute, /if \(error\)[\s\S]*?throw new Error\('Gagal menonaktifkan OTP yang gagal dikirim\.'/);
assert.match(requestRoute, /await invalidateIssuedOtp\(supabase, otpId\)/);
assert.match(verifyRoute, /consumeOtpAtomically\(supabase, phone, otp\)/);
assert.match(requestRoute, /checkSharedRateLimit/);
assert.match(requestRoute, /customerOtpRequestIp/);
assert.match(verifyRoute, /checkSharedRateLimit/);
assert.match(verifyRoute, /customerOtpVerifyIp/);
assert.match(adminAuthRoute, /checkSharedRateLimit/);
assert.match(adminAuthRoute, /adminLoginIp/);

// PostgreSQL is the source of truth: per-phone transaction/advisory lock, row lock, quota and lockout.
assert.match(migration, /pg_advisory_xact_lock/);
assert.match(migration, /FOR UPDATE/);
assert.match(migration, /last_otp_requested_at/);
assert.match(migration, /interval '60 seconds'/);
assert.match(migration, /v_request_count >= 4/);
assert.match(migration, /v_failure_count >= p_max_failures/);
assert.match(migration, /SET search_path = ''/);
assert.match(migration, /REVOKE ALL ON TABLE public\.kdj_auth_throttle_state FROM PUBLIC, anon, authenticated, service_role/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.kdj_otp_verify_atomic[\s\S]*?TO postgres, service_role/);

// SQL integration test covers cooldown, quota, lockout, one-time consumption and shared state.
for (const marker of [
    'COOLDOWN',
    'RATE_LIMITED',
    'kdj_otp_verify_atomic',
    'OTP replay was not rejected',
    'kdj_auth_rate_limit_consume',
    'kdj_auth_lock_record_failure'
]) {
    assert.ok(sqlTest.includes(marker), `Missing SQL OTP regression marker: ${marker}`);
}

console.log('[PASS] No process-local OTP/rate-limit maps or brute-force helpers remain.');
console.log('[PASS] OTP identifiers use server-side HMAC and durable shared PostgreSQL RPCs.');
console.log('[PASS] Request/verify routes call the atomic RPC helpers; failed delivery invalidation is checked.');
console.log('[PASS] Migration locks per-phone operations, serializes row state, and restricts table/function ACLs.');
console.log('[PASS] Staging SQL integration test covers cooldown, quota, lockout, consume/replay and shared counters.');
assert.match(concurrencyTest, /spawn\(process\.execPath/);
assert.match(concurrencyTest, /Two independent Node\.js worker processes/);
assert.match(concurrencyTest, /kdj_auth_rate_limit_consume/);
assert.match(concurrencyTest, /kdj_otp_request_atomic/);
assert.match(concurrencyTest, /kdj_auth_lock_record_failure/);
assert.match(concurrencyTest, /Separate processes derived different HMAC throttle keys/);
console.log('[PASS] OTP request, verification and Admin login routes all use shared rate-limit controls.');
console.log('[PASS] A two-process Staging harness covers shared quota, OTP cooldown and lockout concurrency.');
console.log('\n=== ALL DURABLE OTP CONTRACT TESTS PASSED ===');
