import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const routePath = path.join(rootDir, 'app', 'api', 'admin', 'jadwal', 'route.js');
const retryPath = path.join(rootDir, 'app', 'api', 'admin', 'jadwal', 'notifications', 'retry', 'route.js');
const pagePath = path.join(rootDir, 'app', 'admin', 'page.js');
const routeSource = fs.readFileSync(routePath, 'utf8');
const retrySource = fs.readFileSync(retryPath, 'utf8');
const pageSource = fs.readFileSync(pagePath, 'utf8');

function extractFunction(source, functionName) {
    const pattern = new RegExp(`function ${functionName}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`, 'm');
    const match = source.match(pattern);
    assert.ok(match, `${functionName} tidak ditemukan.`);
    return match[0];
}

const helpers = vm.runInNewContext(
    `const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;\n` +
    `${extractFunction(routeSource, 'normalizeScheduleMethod')}\n` +
    `${extractFunction(routeSource, 'normalizeJakartaTimestamp')}\n` +
    `({ normalizeScheduleMethod, normalizeJakartaTimestamp })`,
    { Date, Number, String, RegExp }
);

assert.equal(helpers.normalizeScheduleMethod('Zoom'), 'Zoom');
assert.equal(helpers.normalizeScheduleMethod('Offline'), 'Offline');
assert.equal(helpers.normalizeScheduleMethod('Datang ke Kantor'), 'Offline');
assert.equal(helpers.normalizeScheduleMethod('Google Meet'), null);
assert.equal(helpers.normalizeJakartaTimestamp('2026-11-03T09:00:00+07:00'), '2026-11-03T09:00:00+07:00');
assert.equal(helpers.normalizeJakartaTimestamp('2026-11-03T15:00+07:00'), '2026-11-03T15:00:00+07:00');
assert.equal(helpers.normalizeJakartaTimestamp('2026-11-03T09:00:00Z'), null);
assert.equal(helpers.normalizeJakartaTimestamp('2026-02-31T09:00:00+07:00'), null);
assert.equal(helpers.normalizeJakartaTimestamp('2026-11-03T09:00:00+08:00'), null);

assert.match(routeSource, /requireAdminPermission\(req, 'booking.read'\)/);
assert.match(routeSource, /requireAdminPermission\(req, requiredPermission\)/);
assert.match(routeSource, /supabase\.rpc\(\s*'kdj_admin_update_booking'/);
assert.match(routeSource, /booking_notification_outbox/);
assert.match(routeSource, /callWaBotApi\(\s*'\/process-booking-notifications'/);
assert.doesNotMatch(routeSource, /callWaBotApi\(\s*'\/notify-booking'/);
assert.doesNotMatch(routeSource, /kdj_update_booking_notification/);
assert.doesNotMatch(routeSource, /export const runtime/);
assert.doesNotMatch(routeSource, /\.from\(['"]jadwal_konsultasi['"]\)[\s\S]{0,300}\.update\(/);
assert.doesNotMatch(routeSource, /\.from\(['"]jadwal_konsultasi['"]\)[\s\S]{0,300}\.insert\(/);
assert.match(routeSource, /supabase\.rpc\('kdj_create_booking'/);
assert.match(pageSource, /x-idempotency-key/);
assert.match(retrySource, /requireAdminPermission\(req, requiredPermission\)/);
assert.match(retrySource, /booking\.outbox\.resolve_unknown/);
assert.match(retrySource, /booking\.outbox\.retry_failed/);
assert.match(retrySource, /kdj_retry_booking_notification/);
assert.match(retrySource, /confirm_unknown/);
assert.match(retrySource, /process-booking-notifications/);
assert.match(pageSource, /timeZone:\s*'Asia\/Jakarta'/);
assert.match(pageSource, /type="date"/);
assert.match(pageSource, /type="time"/);
assert.match(pageSource, /T\$\{scheduleDraft\.time\}:00\+07:00/);
assert.match(pageSource, /handleRescheduleJadwal/);
assert.match(pageSource, /handleRetryBookingNotification/);
assert.match(pageSource, /Periksa chat WhatsApp penerima terlebih dahulu/);

assert.match(routeSource, /\.in\('id', latestNotificationIds\)/);
assert.match(routeSource, /notification_status_source/);
assert.match(routeSource, /POINTER_TARGET_NOT_FOUND/);
assert.match(routeSource, /POINTER_BOOKING_MISMATCH/);
assert.match(routeSource, /POINTER_MISSING_WITH_EVENTS/);
assert.match(routeSource, /POINTER_TARGET_SUPERSEDED/);
assert.match(routeSource, /notification_alerts:\s*alertEvents\.map\(/);
assert.doesNotMatch(routeSource, /latestByBooking/);
assert.match(pageSource, /notification_status_source === 'OUTBOX'/);
assert.match(pageSource, /notification_status_source === 'LEGACY_SUMMARY'/);
assert.match(pageSource, /notification_integrity/);
assert.doesNotMatch(pageSource, /notification\?\.status \|\| j\.notification_status/);
assert.match(pageSource, /alertEvent\.is_latest \?/);
assert.match(pageSource, /Event lama telah digantikan perubahan terbaru/);
assert.match(pageSource, /Notifikasi yang perlu ditindaklanjuti/);
assert.doesNotMatch(pageSource, /new Date\(j\.jadwal_pilihan\)\.toLocaleString/);

const routeModuleSource = routeSource
    .replace(/^import \{ NextResponse \} from 'next\/server';\r?\n/m, '')
    .replace(/^import \{[\s\S]*?\} from '@\/lib\/security';\r?\n/m, '')
    .replaceAll('export async function GET', 'async function GET')
    .replaceAll('export async function POST', 'async function POST');
const buildRouteModule = new Function(
    'NextResponse', 'getSupabaseAdmin', 'requireAdminPermission', 'callWaBotApi', 'normalizePhoneLocal', 'console',
    `${routeModuleSource}\nreturn { GET, POST };`
);
function makeRequest(body) { return { json: async () => body }; }
const testBookingId = '123e4567-e89b-42d3-a456-426614174000';
const testEventId = '123e4567-e89b-42d3-a456-426614174001';
const existingBooking = {
    id: testBookingId, no_wa: '081234567890', nama_leads: 'Lead QA',
    jadwal_pilihan: '2026-11-02T02:00:00.000Z', metode: 'Zoom', status: 'Terjadwal'
};

function createGetRuntime({
    bookings,
    historyRows = [],
    pointerRows = [],
    historyError = null,
    pointerError = null
}) {
    const outboxQueries = [];

    const supabase = {
        from(table) {
            if (table === 'jadwal_konsultasi') {
                return {
                    select() {
                        return this;
                    },
                    async order() {
                        return { data: bookings, error: null };
                    }
                };
            }

            if (table === 'booking_notification_outbox') {
                let filterColumn = null;

                return {
                    select() {
                        return this;
                    },
                    in(column, values) {
                        filterColumn = column;
                        outboxQueries.push({
                            column,
                            values: [...values]
                        });
                        return this;
                    },
                    async order(column, options) {
                        assert.equal(filterColumn, 'booking_id');
                        assert.equal(column, 'created_at');
                        assert.equal(options?.ascending, false);

                        return {
                            data: historyRows,
                            error: historyError
                        };
                    },
                    then(resolve, reject) {
                        if (filterColumn !== 'id') {
                            return Promise.reject(
                                new Error('Unexpected Outbox query without an ID filter.')
                            ).then(resolve, reject);
                        }

                        return Promise.resolve({
                            data: pointerRows,
                            error: pointerError
                        }).then(resolve, reject);
                    }
                };
            }

            throw new Error(`Unexpected table ${table}`);
        }
    };

    const getModule = buildRouteModule(
        { json: (body, init = {}) => ({ body, status: init.status || 200 }) },
        () => supabase,
        async () => ({ authorized: true }),
        async () => ({ ok: true }),
        (phone) => String(phone || '').replace(/[^0-9]/g, '').replace(/^62/, '0'),
        { error() {}, warn() {} }
    );

    return { getModule, outboxQueries };
}

function createMockRuntime({ adminRpcResult, wakeThrows = false, wakeResult = { ok: true, status: 200, data: { success: true } }, outboxStatus = 'PENDING' }) {
    const rpcCalls = [];
    const botCalls = [];
    const supabase = {
        from(table) {
            if (table === 'jadwal_konsultasi') {
                return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: existingBooking, error: null }; } };
            }
            if (table === 'booking_notification_outbox') {
                return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: { status: outboxStatus, last_error: null }, error: null }; } };
            }
            throw new Error(`Unexpected table ${table}`);
        },
        async rpc(name, args) {
            rpcCalls.push({ name, args });
            if (name === 'kdj_admin_update_booking') return { data: adminRpcResult, error: null };
            throw new Error(`Unexpected RPC ${name}`);
        }
    };
    const routeModule = buildRouteModule(
        { json: (body, init = {}) => ({ body, status: init.status || 200 }) },
        () => supabase,
        async () => ({ authorized: true }),
        async (endpoint, payload, options) => {
            botCalls.push({ endpoint, payload, options });
            if (wakeThrows) throw new Error('Bot timeout');
            return wakeResult;
        },
        (phone) => String(phone || '').replace(/[^0-9]/g, '').replace(/^62/, '0'),
        { error() {}, warn() {} }
    );
    return { routeModule, rpcCalls, botCalls };
}


// GET: latest event must follow latest_notification_id,
// even when another Outbox event has a newer created_at.
{
    const timestampNewestEvent = {
        id: '123e4567-e89b-42d3-a456-426614174010',
        booking_id: testBookingId,
        event_type: 'BOOKING_STATUS_UPDATED',
        status: 'SENT',
        created_at: '2026-11-03T05:10:00.000Z',
        last_error: null
    };

    const pointerEvent = {
        id: '123e4567-e89b-42d3-a456-426614174011',
        booking_id: testBookingId,
        event_type: 'BOOKING_RESCHEDULED',
        status: 'UNKNOWN',
        created_at: '2026-11-03T05:05:00.000Z',
        last_error: 'Send outcome uncertain'
    };

    const failedHistoryEvent = {
        id: '123e4567-e89b-42d3-a456-426614174012',
        booking_id: testBookingId,
        event_type: 'BOOKING_CANCELLED',
        status: 'FAILED',
        created_at: '2026-11-03T04:55:00.000Z',
        last_error: 'WA disconnected'
    };

    const booking = {
        ...existingBooking,
        latest_notification_id: pointerEvent.id,
        notification_status: 'SENT'
    };

    const runtime = createGetRuntime({
        bookings: [booking],
        historyRows: [
            timestampNewestEvent,
            pointerEvent,
            failedHistoryEvent
        ],
        pointerRows: [pointerEvent]
    });

    const response = await runtime.getModule.GET({});

    assert.equal(response.status, 200);

    const result = response.body.data[0];

    assert.equal(result.latest_notification.id, pointerEvent.id);
    assert.equal(result.latest_notification.status, 'UNKNOWN');
    assert.equal(result.notification_integrity, null);
    assert.equal(result.notification_status_source, 'OUTBOX');

    assert.deepEqual(
        result.notification_alerts.map((event) => event.id),
        [pointerEvent.id, failedHistoryEvent.id]
    );

    assert.equal(result.notification_alerts[0].is_latest, true);
    assert.equal(result.notification_alerts[1].is_latest, false);

    const pointerQuery = runtime.outboxQueries.find(
        (query) => query.column === 'id'
    );

    assert.ok(pointerQuery);
    assert.deepEqual(pointerQuery.values, [pointerEvent.id]);
}

// GET: a stale pointer must not promote an arbitrary historical event.
{
    const historicalEvent = {
        id: '123e4567-e89b-42d3-a456-426614174020',
        booking_id: testBookingId,
        event_type: 'BOOKING_RESCHEDULED',
        status: 'FAILED',
        created_at: '2026-11-03T05:00:00.000Z',
        last_error: 'Historical failure'
    };

    const booking = {
        ...existingBooking,
        latest_notification_id: '123e4567-e89b-42d3-a456-426614174099',
        notification_status: 'SENT'
    };

    const runtime = createGetRuntime({
        bookings: [booking],
        historyRows: [historicalEvent],
        pointerRows: []
    });

    const response = await runtime.getModule.GET({});
    const result = response.body.data[0];

    assert.equal(response.status, 200);
    assert.equal(result.latest_notification, null);
    assert.equal(result.notification_integrity.code, 'POINTER_TARGET_NOT_FOUND');
    assert.equal(result.notification_status_source, 'INTEGRITY_WARNING');
    assert.equal(result.notification_alerts[0].is_latest, false);
}

// GET: a NULL pointer with existing Outbox history is an integrity warning.
{
    const historicalEvent = {
        id: '123e4567-e89b-42d3-a456-426614174030',
        booking_id: testBookingId,
        event_type: 'BOOKING_CREATED',
        status: 'UNKNOWN',
        created_at: '2026-11-03T05:00:00.000Z',
        last_error: 'Outcome uncertain'
    };

    const booking = {
        ...existingBooking,
        latest_notification_id: null,
        notification_status: 'SENT'
    };

    const runtime = createGetRuntime({
        bookings: [booking],
        historyRows: [historicalEvent],
        pointerRows: []
    });

    const response = await runtime.getModule.GET({});
    const result = response.body.data[0];

    assert.equal(response.status, 200);
    assert.equal(result.latest_notification, null);
    assert.equal(result.notification_integrity.code, 'POINTER_MISSING_WITH_EVENTS');
    assert.equal(result.notification_status_source, 'INTEGRITY_WARNING');
    assert.equal(result.notification_alerts[0].is_latest, false);
}

// GET: legacy summary is allowed only when no pointer and no Outbox event exist.
{
    const booking = {
        ...existingBooking,
        latest_notification_id: null,
        notification_status: 'SENT'
    };

    const runtime = createGetRuntime({
        bookings: [booking],
        historyRows: [],
        pointerRows: []
    });

    const response = await runtime.getModule.GET({});
    const result = response.body.data[0];

    assert.equal(response.status, 200);
    assert.equal(result.latest_notification, null);
    assert.equal(result.notification_integrity, null);
    assert.equal(result.notification_status_source, 'LEGACY_SUMMARY');
    assert.equal(result.notification_status, 'SENT');
}

// GET: a pointer that resolves to an event belonging to another booking is invalid.
{
    const otherBookingId = '123e4567-e89b-42d3-a456-426614174099';

    const foreignEvent = {
        id: '123e4567-e89b-42d3-a456-426614174040',
        booking_id: otherBookingId,
        event_type: 'BOOKING_CREATED',
        status: 'SENT',
        created_at: '2026-11-03T05:00:00.000Z',
        last_error: null
    };

    const booking = {
        ...existingBooking,
        latest_notification_id: foreignEvent.id,
        notification_status: 'SENT'
    };

    const runtime = createGetRuntime({
        bookings: [booking],
        historyRows: [],
        pointerRows: [foreignEvent]
    });

    const response = await runtime.getModule.GET({});
    const result = response.body.data[0];

    assert.equal(response.status, 200);
    assert.equal(result.latest_notification, null);
    assert.equal(result.notification_integrity.code, 'POINTER_BOOKING_MISMATCH');
    assert.equal(result.notification_status_source, 'INTEGRITY_WARNING');
}

// GET: SUPERSEDED must never be accepted as the current event.
{
    const supersededEvent = {
        id: '123e4567-e89b-42d3-a456-426614174050',
        booking_id: testBookingId,
        event_type: 'BOOKING_RESCHEDULED',
        status: 'SUPERSEDED',
        created_at: '2026-11-03T05:00:00.000Z',
        last_error: null
    };

    const booking = {
        ...existingBooking,
        latest_notification_id: supersededEvent.id,
        notification_status: 'SENT'
    };

    const runtime = createGetRuntime({
        bookings: [booking],
        historyRows: [supersededEvent],
        pointerRows: [supersededEvent]
    });

    const response = await runtime.getModule.GET({});
    const result = response.body.data[0];

    assert.equal(response.status, 200);
    assert.equal(result.latest_notification, null);
    assert.equal(result.notification_integrity.code, 'POINTER_TARGET_SUPERSEDED');
    assert.equal(result.notification_status_source, 'INTEGRITY_WARNING');
}

{
    const { routeModule, rpcCalls } = createMockRuntime({ adminRpcResult: { ok: true } });
    const response = await routeModule.POST(makeRequest({
        id: testBookingId, jadwal_pilihan: '2026-11-03T09:00:00Z', metode: 'Zoom'
    }));
    assert.equal(response.status, 400);
    assert.equal(rpcCalls.length, 0);
}

// Inactive booking reschedule is rejected before RPC; DB independently repeats guard under row lock.
{
    const { routeModule, rpcCalls } = createMockRuntime({ adminRpcResult: { ok: true } });
    const response = await routeModule.POST(makeRequest({
        id: testBookingId, status: 'Batal',
        jadwal_pilihan: '2026-11-03T09:00:00+07:00', metode: 'Zoom'
    }));
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'INACTIVE_BOOKING_CANNOT_BE_RESCHEDULED');
    assert.equal(rpcCalls.length, 0);
}

// Status-only cancellation returns a durable event id; Portal asks the Bot worker to process queue.
{
    const { routeModule, rpcCalls, botCalls } = createMockRuntime({
        adminRpcResult: {
            ok: true, code: 'BOOKING_UPDATED', booking_id: testBookingId,
            schedule_changed: false, method_changed: false, status_changed: true,
            notification_required: true, notification_event_id: testEventId,
            previous_jadwal_pilihan: existingBooking.jadwal_pilihan,
            jadwal_pilihan: existingBooking.jadwal_pilihan, status: 'Batal', metode: 'Zoom'
        }
    });
    const response = await routeModule.POST(makeRequest({ id: testBookingId, status: 'Batal' }));
    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.notification_status, 'PENDING');
    assert.equal(response.body.wa_notified, false);
    assert.equal(botCalls.length, 1);
    assert.equal(botCalls[0].endpoint, '/process-booking-notifications');
    assert.equal(rpcCalls.length, 1);
    assert.equal(rpcCalls[0].args.p_metode, null);
}

// An HTTP 503 returned as a normal callWaBotApi result must not be mislabeled as a successful wake-up.
{
    const { routeModule } = createMockRuntime({
        adminRpcResult: {
            ok: true, code: 'BOOKING_UPDATED', booking_id: testBookingId,
            schedule_changed: true, method_changed: false, status_changed: false,
            notification_required: true, notification_event_id: testEventId,
            previous_jadwal_pilihan: existingBooking.jadwal_pilihan,
            jadwal_pilihan: '2026-11-03T04:00:00.000Z', status: 'Terjadwal', metode: 'Zoom'
        },
        wakeResult: { ok: false, status: 503, data: { success: false, message: 'WhatsApp belum siap.' } },
        outboxStatus: 'PENDING'
    });
    const response = await routeModule.POST(makeRequest({
        id: testBookingId, jadwal_pilihan: '2026-11-03T11:00:00+07:00'
    }));
    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.notification_status, 'PENDING');
    assert.equal(response.body.notification_error, 'WhatsApp belum siap.');
}

// Bot unavailable: event remains pending; schedule mutation still succeeds.
{
    const { routeModule, botCalls } = createMockRuntime({
        adminRpcResult: {
            ok: true, code: 'BOOKING_UPDATED', booking_id: testBookingId,
            schedule_changed: true, method_changed: false, status_changed: false,
            notification_required: true, notification_event_id: testEventId,
            previous_jadwal_pilihan: existingBooking.jadwal_pilihan,
            jadwal_pilihan: '2026-11-03T04:00:00.000Z', status: 'Terjadwal', metode: 'Zoom'
        },
        wakeThrows: true, outboxStatus: 'PENDING'
    });
    const response = await routeModule.POST(makeRequest({
        id: testBookingId, jadwal_pilihan: '2026-11-03T11:00:00+07:00'
    }));
    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.notification_status, 'PENDING');
    assert.equal(response.body.notification_error, 'Bot timeout');
    assert.equal(botCalls.length, 1);
}


// Test the admin retry API: UNKNOWN cannot be queued unless the admin explicitly confirms.
const retryModuleSource = retrySource
    .replace(/^import \{ NextResponse \} from 'next\/server';\r?\n/m, '')
    .replace(/^import \{[\s\S]*?\} from '@\/lib\/security';\r?\n/m, '')
    .replaceAll('export async function POST', 'async function POST');
const buildRetryModule = new Function(
    'NextResponse', 'getSupabaseAdmin', 'requireAdminPermission', 'callWaBotApi', 'normalizePhoneLocal', 'console',
    `${retryModuleSource}\nreturn { POST };`
);
{
    const rpcCalls = [];
    const botCalls = [];
    const retryModule = buildRetryModule(
        { json: (body, init = {}) => ({ body, status: init.status || 200 }) },
        () => ({
            async rpc(name, args) {
                rpcCalls.push({ name, args });
                return {
                    data: { ok: false, code: 'UNKNOWN_REQUIRES_CONFIRMATION', message: 'Periksa chat dulu.' },
                    error: null
                };
            }
        }),
        async () => ({ authorized: true }),
        async (...args) => { botCalls.push(args); return { ok: true, status: 200 }; },
        { error() {} }
    );
    const response = await retryModule.POST(makeRequest({ notification_id: testEventId }));
    assert.equal(response.status, 409);
    assert.equal(rpcCalls[0].args.p_confirm_unknown, false);
    assert.equal(botCalls.length, 0);
}

// Retry remains queued when Bot responds 503 through a resolved HTTP result.
{
    const retryModule = buildRetryModule(
        { json: (body, init = {}) => ({ body, status: init.status || 200 }) },
        () => ({
            async rpc() {
                return { data: { ok: true, code: 'NOTIFICATION_REQUEUED', notification_id: testEventId }, error: null };
            }
        }),
        async () => ({ authorized: true }),
        async () => ({ ok: false, status: 503, data: { message: 'WhatsApp belum siap.' } }),
        { error() {} }
    );
    const response = await retryModule.POST(makeRequest({ notification_id: testEventId }));
    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.wake_requested, false);
    assert.equal(response.body.wake_error, 'WhatsApp belum siap.');
}

// Explicit UNKNOWN confirmation requeues the same outbox row, then wakes the Bot.
{
    const rpcCalls = [];
    const botCalls = [];
    const retryModule = buildRetryModule(
        { json: (body, init = {}) => ({ body, status: init.status || 200 }) },
        () => ({
            async rpc(name, args) {
                rpcCalls.push({ name, args });
                return {
                    data: { ok: true, code: 'NOTIFICATION_REQUEUED', notification_id: testEventId, status: 'PENDING' },
                    error: null
                };
            }
        }),
        async () => ({ authorized: true }),
        async (endpoint, payload, options) => {
            botCalls.push({ endpoint, payload, options });
            return { ok: true, status: 200 };
        },
        { error() {} }
    );
    const response = await retryModule.POST(makeRequest({ notification_id: testEventId, confirm_unknown: true }));
    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.wake_requested, true);
    assert.equal(rpcCalls[0].name, 'kdj_retry_booking_notification');
    assert.equal(rpcCalls[0].args.p_confirm_unknown, true);
    assert.equal(botCalls.length, 1);
    assert.equal(botCalls[0].endpoint, '/process-booking-notifications');
}

console.log('[PASS] Validasi timestamp WIB dan normalisasi Zoom/Offline.');
console.log('[PASS] API admin memakai RPC dan tidak melakukan DML langsung ke jadwal_konsultasi.');
console.log('[PASS] Transactional outbox dan Bot worker wake-up menggantikan direct notification request.');
console.log('[PASS] Portal retry API mengamankan UNKNOWN dengan konfirmasi admin eksplisit.');
console.log('[PASS] UI menampilkan seluruh event FAILED/UNKNOWN dan menyediakan retry yang terkontrol.');
console.log('[PASS] Kegagalan wake-up Bot tidak membatalkan perubahan jadwal atau menghilangkan event.');
console.log('\n=== SELURUH TEST PORTAL SCHEDULING / OUTBOX LULUS ===');
console.log('[PASS] Latest Outbox event ditentukan oleh latest_notification_id, bukan created_at.');
console.log('[PASS] Pointer stale, null, mismatch, dan SUPERSEDED menghasilkan integrity warning.');
console.log('[PASS] Legacy summary hanya digunakan ketika tidak ada pointer dan event Outbox.');
