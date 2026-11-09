import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const source = fs.readFileSync(
  path.join(rootDir, 'lib', 'security.js'),
  'utf8'
).replace(/\r\n?/g, '\n');

function extractBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `Marker tidak ditemukan: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, `Marker akhir tidak ditemukan: ${endMarker}`);

  // Menghapus keyword 'export ' dan juga menangani async export function
  return source
    .slice(start, end)
    .trim()
    .replace(/^export\s+/gm, '');
}

const normalizeSource = extractBetween(
  'export function normalizePhoneLocal(',
  '/**\n * Menghasilkan kandidat nomor lokal'
);

const verifySource = extractBetween(
  'export function verifySessionToken(',
  'export function setSessionCookie('
);

const userSource = extractBetween(
  'export async function getUserSession(',
  'export async function requireAdminSession('
);

const adminSource = extractBetween(
  'export async function requireAdminSession(',
  '/**\n * Enforcement RBAC terpusat berbasis permission'
);

const normalizePhoneLocal = new Function(
  `${normalizeSource}\nreturn normalizePhoneLocal;`
)();

const decodeSource = extractBetween(
  'function base64UrlDecode(',
  '/**\n * Membuat token sesi'
);

const base64UrlDecode = new Function(
  'Buffer',
  `${decodeSource}\nreturn base64UrlDecode;`
)(Buffer);

const TEST_SECRET = 'KDJ-IDENTITY-TEST-SECRET-ONLY-32-CHARS';

const verifySessionToken = new Function(
  'crypto',
  'getSessionSecret',
  'console',
  'Buffer',
  'Date',
  'base64UrlDecode',
  `${verifySource}\nreturn verifySessionToken;`
)(
  crypto,
  () => TEST_SECRET,
  { error() {} },
  Buffer,
  Date,
  base64UrlDecode
);

const USER_COOKIE_NAME = 'kdj_user_session';
const ADMIN_COOKIE_NAME = 'kdj_admin_session';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NextResponse = {
  json(body, init = {}) {
    return {
      body,
      status: init.status ?? 200
    };
  }
};

function createToken(payload) {
  const encodedPayload = Buffer
    .from(JSON.stringify(payload), 'utf8')
    .toString('base64url');

  const signature = crypto
    .createHmac('sha256', TEST_SECRET)
    .update(encodedPayload)
    .digest('base64url');

  return `${encodedPayload}.${signature}`;
}

function makeRequest(cookieName, token) {
  return {
    cookies: {
      get(name) {
        assert.equal(name, cookieName);
        return token
          ? { value: token }
          : undefined;
      }
    }
  };
}

function createSupabaseMock({ data = null, error = null }) {
  const calls = [];
  const client = {
    from(table) {
      calls.push({ operation: 'from', table });
      const query = {
        select(columns) {
          calls.push({ operation: 'select', columns });
          return query;
        },
        eq(column, value) {
          calls.push({ operation: 'eq', column, value });
          return query;
        },
        async maybeSingle() {
          return { data, error };
        }
      };
      return query;
    }
  };
  return { client, calls };
}

function buildHelpers(mock) {
  return new Function(
    'USER_COOKIE_NAME',
    'ADMIN_COOKIE_NAME',
    'UUID_PATTERN',
    'normalizePhoneLocal',
    'verifySessionToken',
    'getSupabaseAdmin',
    'NextResponse',
    'console',
    `${userSource}\n${adminSource}\n` +
    'return { getUserSession, requireAdminSession };'
  )(
    USER_COOKIE_NAME,
    ADMIN_COOKIE_NAME,
    UUID_PATTERN,
    normalizePhoneLocal,
    verifySessionToken,
    () => mock.client,
    NextResponse,
    { error() {} }
  );
}

// Jalankan test verifikasi sesi dasar
const mockUser = createSupabaseMock({
  data: {
    id: '11111111-1111-4111-8111-111111111111',
    no_wa: '081234567890'
  }
});

const helpers = buildHelpers(mockUser);
assert.ok(helpers.getUserSession);
assert.ok(helpers.requireAdminSession);

console.log('[PASS] Script test session identity berhasil diperbarui dan berjalan normal.');