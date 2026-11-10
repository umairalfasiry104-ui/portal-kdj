import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const routeSource = fs.readFileSync(
    path.join(root, 'app', 'api', 'admin', 'jadwal', 'route.js'),
    'utf8'
)
    .replace(/^import \{ NextResponse \} from 'next\/server';\r?\n/m, '')
    .replace(/^import \{[\s\S]*?\} from '@\/lib\/security';\r?\n/m, '')
    .replace(/^import \{ createAdminBookingAttestation \} from '@\/lib\/admin-booking-attestation\.mjs';\r?\n/m, '')
    .replaceAll('export async function GET', 'async function GET')
    .replaceAll('export async function POST', 'async function POST');

const buildRoute = new Function(
    'NextResponse',
    'getSupabaseAdmin',
    'requireAdminPermission',
    'callWaBotApi',
    'normalizePhoneLocal',
    'createAdminBookingAttestation',
    'console',
    `${routeSource}\nreturn { POST };`
);

const admin = {
    id: '11111111-1111-4111-8111-111111111111',
    username: 'qa-admin',
    role: 'Admin Konsultan',
    session_version: 7
};
const bookingResult = {
    ok: true,
    booking_id: '123e4567-e89b-42d3-a456-426614174000',
    notification_event_id: null,
    notification_status: 'PENDING'
};
const body = {
    action: 'CREATE',
    no_wa: '081234567890',
    nama_leads: 'UAT Lead',
    metode: 'Zoom',
    jadwal_pilihan: '2026-11-12T09:00:00+07:00',
    status: 'Terjadwal'
};

function makeRequest() {
    return {
        json: async () => body,
        headers: {
            get(name) {
                return name === 'x-idempotency-key' ? 'manual-uat-0001' : null;
            }
        }
    };
}

{
    const rpcCalls = [];
    const attestCalls = [];
    const supabase = {
        async rpc(name, args) {
            rpcCalls.push({ name, args });
            return { data: bookingResult, error: null };
        }
    };
    const route = buildRoute(
        { json: (data, init = {}) => ({ data, status: init.status || 200 }) },
        () => supabase,
        async (_req, permission) => {
            assert.equal(permission, 'booking.create');
            return { authorized: true, admin };
        },
        async () => { throw new Error('Bot wake-up should not run without an Outbox ID.'); },
        (phone) => phone,
        (values) => {
            attestCalls.push(values);
            return { p_key_id: 'admin-v1', p_actor_admin_id: values.admin.id, p_signature: 'server-signature' };
        },
        { error() {}, warn() {} }
    );

    const response = await route.POST(makeRequest());
    assert.equal(response.status, 200);
    assert.equal(response.data.success, true);
    assert.equal(rpcCalls.length, 1);
    assert.equal(rpcCalls[0].name, 'kdj_admin_create_booking_attested');
    assert.deepEqual(rpcCalls[0].args, {
        p_key_id: 'admin-v1',
        p_actor_admin_id: admin.id,
        p_signature: 'server-signature'
    });
    assert.equal(attestCalls.length, 1);
    assert.equal(attestCalls[0].admin, admin);
    assert.equal(attestCalls[0].noWa, '081234567890');
    assert.equal(attestCalls[0].customerName, 'UAT Lead');
    assert.equal(attestCalls[0].method, 'Zoom');
    assert.equal(attestCalls[0].schedule, '2026-11-12T09:00:00+07:00');
    assert.equal(attestCalls[0].idempotencyKey, 'admin-create:manual-uat-0001');
}

{
    let rpcCalled = false;
    const route = buildRoute(
        { json: (data, init = {}) => ({ data, status: init.status || 200 }) },
        () => ({
            async rpc() {
                rpcCalled = true;
                return { data: bookingResult, error: null };
            }
        }),
        async () => ({ authorized: true, admin }),
        async () => ({ ok: true }),
        (phone) => phone,
        () => {
            const error = new Error('not configured');
            error.code = 'ADMIN_BOOKING_ATTESTATION_NOT_CONFIGURED';
            throw error;
        },
        { error() {}, warn() {} }
    );
    const response = await route.POST(makeRequest());
    assert.equal(response.status, 503);
    assert.equal(response.data.code, 'ADMIN_BOOKING_ATTESTATION_NOT_CONFIGURED');
    assert.equal(rpcCalled, false);
}

{
    let attestCalled = false;
    const route = buildRoute(
        { json: (data, init = {}) => ({ data, status: init.status || 200 }) },
        () => ({ async rpc() { throw new Error('RPC must not run'); } }),
        async () => ({ authorized: false, response: { status: 403 } }),
        async () => ({ ok: true }),
        (phone) => phone,
        () => { attestCalled = true; return {}; },
        { error() {}, warn() {} }
    );
    const response = await route.POST(makeRequest());
    assert.equal(response.status, 403);
    assert.equal(attestCalled, false);
}

console.log('[PASS] Admin CREATE requires booking.create and signs the DB-verified session actor.');
console.log('[PASS] Route calls only the attested RPC; missing key is fail-closed before DB write.');
console.log('[PASS] Unauthorized Admin is rejected before attestation or RPC.');
