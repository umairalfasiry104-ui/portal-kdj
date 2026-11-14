import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(crypto.scrypt);
const SCRYPT_N = 2 ** 17;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const MAX_MEMORY = 256 * 1024 * 1024;
const MIN_PASSWORD_LENGTH = 14;
const MAX_PASSWORD_LENGTH = 128;
const MAX_PASSWORD_BYTES = 512;

export function isValidAdminPassword(password) {
  return (
    typeof password === 'string' &&
    password.length >= MIN_PASSWORD_LENGTH &&
    password.length <= MAX_PASSWORD_LENGTH &&
    Buffer.byteLength(password, 'utf8') <= MAX_PASSWORD_BYTES
  );
}

export async function hashAdminPassword(password) {
  if (!isValidAdminPassword(password)) {
    throw new Error('Password harus 14–128 karakter dan tidak melebihi 512 byte UTF-8.');
  }

  const salt = crypto.randomBytes(16);
  const derivedKey = await scryptAsync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: MAX_MEMORY
  });

  return [
    'kdj',
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('hex'),
    Buffer.from(derivedKey).toString('hex')
  ].join('$');
}

function safeHexEqual(actualHex, expectedHex) {
  if (
    typeof actualHex !== 'string' ||
    typeof expectedHex !== 'string' ||
    !/^[0-9a-f]{128}$/i.test(actualHex) ||
    !/^[0-9a-f]{128}$/i.test(expectedHex)
  ) {
    return false;
  }

  const actual = Buffer.from(actualHex, 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function verifyLegacySha256(password, storedHash) {
  const parts = storedHash.trim().split('$');
  if (parts.length !== 5 || parts[0] !== 'kdj' || parts[1] !== 'sha256') {
    return false;
  }

  const iterations = Number(parts[2]);
  const salt = parts[3];
  const expectedHex = parts[4].toLowerCase();

  if (
    !Number.isSafeInteger(iterations) ||
    iterations < 1 ||
    iterations > 100000 ||
    !/^[0-9a-f]{16,64}$/i.test(salt) ||
    !/^[0-9a-f]{64}$/i.test(expectedHex)
  ) {
    return false;
  }

  let currentHex = crypto
    .createHash('sha256')
    .update(`${salt}:${password}`, 'utf8')
    .digest('hex');

  for (let i = 1; i <= iterations; i += 1) {
    currentHex = crypto
      .createHash('sha256')
      .update(`${currentHex}:${salt}`, 'utf8')
      .digest('hex');
  }

  const actual = Buffer.from(currentHex, 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export async function verifyAdminPassword(password, storedHash) {
  if (
    typeof password !== 'string' ||
    password.length === 0 ||
    typeof storedHash !== 'string' ||
    storedHash.length > 512
  ) {
    return false;
  }

  const parts = storedHash.trim().split('$');
  if (parts[0] !== 'kdj') return false;

  // Compatibility path for accounts created before the scrypt migration.
  if (parts[1] === 'sha256') {
    return verifyLegacySha256(password, storedHash);
  }

  if (
    parts.length !== 7 ||
    parts[1] !== 'scrypt' ||
    Number(parts[2]) !== SCRYPT_N ||
    Number(parts[3]) !== SCRYPT_R ||
    Number(parts[4]) !== SCRYPT_P ||
    !/^[0-9a-f]{32}$/i.test(parts[5]) ||
    !/^[0-9a-f]{128}$/i.test(parts[6])
  ) {
    return false;
  }

  try {
    const salt = Buffer.from(parts[5], 'hex');
    const derivedKey = await scryptAsync(password, salt, KEY_LENGTH, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: MAX_MEMORY
    });
    return safeHexEqual(Buffer.from(derivedKey).toString('hex'), parts[6]);
  } catch {
    return false;
  }
}

export function isLegacyAdminPasswordHash(storedHash) {
  return typeof storedHash === 'string' && storedHash.startsWith('kdj$sha256$');
}
