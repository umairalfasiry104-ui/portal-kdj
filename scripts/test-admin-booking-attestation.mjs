import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
    buildAdminBookingCanonicalPayload,
    createAdminBookingAttestation
} from '../lib/admin-booking-attestation.mjs';

const testKey = 'a7'.repeat(32);
const admin = {
    id: '11111111-1111-4111-8111-111111111111',
    role: 'Admin Konsultan',
    session_version: 7
};
const nonce = '22222222-2222-4222-8222-222222222222';
const issuedAtMs = 1794271200123;
const schedule = '2026-11-12T02:00:00.000Z';
const scheduleEpochMs = Date.parse(schedule);
const idempotencyKey = 'admin-create:manual-uat-0001';

const attestation = createAdminBookingAttestation({
    admin,
    noWa: '081234567890',
    customerName: 'Umáir QA',
    method: 'Zoom',
    schedule,
    idempotencyKey,
    keyHex: testKey,
    keyId: 'admin-v1',
    nowMs: issuedAtMs,
    nonce
});

assert.deepEqual(
    Object.keys(attestation).sort(),
    [
        'p_actor_admin_id',
        'p_actor_session_version',
        'p_idempotency_key',
        'p_issued_at_ms',
        'p_jadwal_pilihan',
        'p_key_id',
        'p_metode',
        'p_nama_leads',
        'p_no_wa',
        'p_nonce',
        'p_signature'
    ].sort()
);
assert.equal(attestation.p_jadwal_pilihan, schedule);
assert.equal(attestation.p_actor_admin_id, admin.id);
assert.equal(attestation.p_actor_session_version, 7);
assert.equal(attestation.p_nama_leads, 'Umáir QA');

const canonical = buildAdminBookingCanonicalPayload({
    keyId: 'admin-v1',
    actorAdminId: admin.id,
    actorSessionVersion: 7,
    noWa: '081234567890',
    customerName: 'Umáir QA',
    method: 'Zoom',
    scheduleEpochMs,
    idempotencyKey,
    issuedAtMs,
    nonce
});
const expectedSignature = crypto
    .createHmac('sha256', Buffer.from(testKey, 'hex'))
    .update(canonical, 'utf8')
    .digest('hex');
assert.equal(attestation.p_signature, expectedSignature);
assert.match(attestation.p_signature, /^[a-f0-9]{64}$/);

const encodedName = Buffer.from('Umáir QA', 'utf8').toString('base64url');
assert.ok(canonical.includes(`${Buffer.byteLength('Umáir QA', 'utf8')}:${encodedName}`));

assert.throws(
    () => createAdminBookingAttestation({
        admin,
        noWa: '081234567890',
        customerName: 'Lead',
        method: 'Zoom',
        schedule,
        idempotencyKey,
        keyHex: ''
    }),
    (error) => error.code === 'ADMIN_BOOKING_ATTESTATION_NOT_CONFIGURED'
);
assert.throws(
    () => createAdminBookingAttestation({
        admin: { ...admin, role: 'Admin Verifikator' },
        noWa: '081234567890',
        customerName: 'Lead',
        method: 'Zoom',
        schedule,
        idempotencyKey,
        keyHex: testKey
    }),
    /Verified Admin identity/
);
assert.throws(
    () => createAdminBookingAttestation({
        admin,
        noWa: '081234567890',
        customerName: 'Lead',
        method: 'Zoom',
        schedule,
        idempotencyKey,
        keyHex: testKey,
        nonce: 'not-a-uuid'
    }),
    /Admin booking payload/
);

console.log('[PASS] Admin booking HMAC uses a 32-byte key and byte-length-prefixed UTF-8 canonical payload.');
console.log('[PASS] Signature binds verified actor, role-gated identity, session_version, customer, schedule, idempotency, timestamp and nonce.');
console.log('[PASS] Missing key, unauthorized role and invalid nonce fail closed.');
