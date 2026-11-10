import crypto from 'node:crypto';

const DOMAIN = 'KDJ-ADMIN-BOOKING';
const VERSION = '1';
const DEFAULT_KEY_ID = 'admin-v1';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function canonicalize(fields) {
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new TypeError('Admin booking attestation fields are required.');
  }

  return fields.map((field) => {
    const value = field === null || field === undefined ? '' : String(field);
    const bytes = Buffer.from(value, 'utf8');
    return `${bytes.length}:${bytes.toString('base64url')}`;
  }).join('|');
}

function getSecret(secretHex) {
  const value = typeof secretHex === 'string'
    ? secretHex
    : process.env.KDJ_ADMIN_BOOKING_HMAC_KEY;

  if (
    typeof value !== 'string' ||
    !/^(?:[a-fA-F0-9]{2}){32,256}$/.test(value)
  ) {
    const error = new Error('Admin booking attestation key is not configured.');
    error.code = 'ADMIN_BOOKING_ATTESTATION_NOT_CONFIGURED';
    throw error;
  }

  return Buffer.from(value, 'hex');
}

export function buildAdminBookingCanonicalPayload({
  keyId,
  actorAdminId,
  actorSessionVersion,
  noWa,
  customerName,
  method,
  scheduleEpochMs,
  idempotencyKey,
  issuedAtMs,
  nonce
}) {
  return canonicalize([
    DOMAIN,
    VERSION,
    keyId,
    'CREATE',
    actorAdminId,
    actorSessionVersion,
    noWa,
    customerName,
    method,
    scheduleEpochMs,
    idempotencyKey,
    issuedAtMs,
    nonce
  ]);
}

export function createAdminBookingAttestation({
  admin,
  noWa,
  customerName,
  method,
  schedule,
  idempotencyKey,
  keyHex,
  keyId = process.env.KDJ_ADMIN_BOOKING_KEY_ID || DEFAULT_KEY_ID,
  nowMs = Date.now(),
  nonce = crypto.randomUUID()
}) {
  if (
    !admin ||
    typeof admin.id !== 'string' ||
    !UUID_PATTERN.test(admin.id) ||
    !Number.isSafeInteger(Number(admin.session_version)) ||
    Number(admin.session_version) < 1 ||
    !['Super Admin', 'Admin Konsultan'].includes(admin.role)
  ) {
    throw new TypeError('Verified Admin identity is required for booking attestation.');
  }

  if (
    typeof keyId !== 'string' ||
    !/^[A-Za-z0-9._-]{1,80}$/.test(keyId) ||
    typeof noWa !== 'string' ||
    !/^08\d{8,13}$/.test(noWa) ||
    typeof customerName !== 'string' ||
    customerName.trim().length < 2 ||
    customerName.trim().length > 120 ||
    !['Zoom', 'Offline'].includes(method) ||
    typeof idempotencyKey !== 'string' ||
    !/^admin-create:[A-Za-z0-9:_-]{8,200}$/.test(idempotencyKey) ||
    !Number.isSafeInteger(nowMs) ||
    nowMs <= 0 ||
    typeof nonce !== 'string' ||
    !UUID_PATTERN.test(nonce)
  ) {
    throw new TypeError('Admin booking payload is not valid for attestation.');
  }

  const scheduleEpochMs = Date.parse(schedule);
  if (!Number.isSafeInteger(scheduleEpochMs) || scheduleEpochMs <= 0) {
    throw new TypeError('Admin booking schedule must be a valid timestamp.');
  }

  const actorSessionVersion = Number(admin.session_version);
  const cleanName = customerName.trim();
  const fields = {
    keyId,
    actorAdminId: admin.id,
    actorSessionVersion,
    noWa,
    customerName: cleanName,
    method,
    scheduleEpochMs,
    idempotencyKey,
    issuedAtMs: nowMs,
    nonce
  };

  const payload = buildAdminBookingCanonicalPayload(fields);
  const signature = crypto
    .createHmac('sha256', getSecret(keyHex))
    .update(payload, 'utf8')
    .digest('hex');

  return {
    p_key_id: keyId,
    p_actor_admin_id: admin.id,
    p_actor_session_version: actorSessionVersion,
    p_no_wa: noWa,
    p_nama_leads: cleanName,
    p_metode: method,
    p_jadwal_pilihan: new Date(scheduleEpochMs).toISOString(),
    p_idempotency_key: idempotencyKey,
    p_issued_at_ms: nowMs,
    p_nonce: nonce,
    p_signature: signature
  };
}
