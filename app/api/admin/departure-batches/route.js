import { NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAdminSession } from '@/lib/security';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(value) {
    if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isMonthStart(value) {
    return isCalendarDate(value) && value.endsWith('-01');
}

function getJakartaDateParts() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());
    return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function currentJakartaDate() {
    const parts = getJakartaDateParts();
    return parts.year && parts.month && parts.day
        ? `${parts.year}-${parts.month}-${parts.day}`
        : null;
}

function currentJakartaMonthStart() {
    const date = currentJakartaDate();
    return date ? `${date.slice(0, 7)}-01` : null;
}

function featureDisabledResponse() {
    return NextResponse.json(
        {
            success: false,
            code: 'DEPARTURE_BATCH_FEATURE_DISABLED',
            message: 'Pengelolaan gelombang keberangkatan belum diaktifkan pada environment ini.'
        },
        { status: 503 }
    );
}

async function authorizeBatchAdmin(req) {
    const auth = await requireAdminSession(req);
    if (!auth.authorized) return { ok: false, response: auth.response };

    if (auth.admin?.role !== 'Super Admin') {
        return {
            ok: false,
            response: NextResponse.json(
                { success: false, code: 'FORBIDDEN_ROLE_PERMISSION', message: 'Hanya Super Admin yang dapat mengelola gelombang keberangkatan.' },
                { status: 403 }
            )
        };
    }

    if (process.env.KDJ_DEPARTURE_BATCH_FEATURE_ENABLED !== 'true') {
        return { ok: false, response: featureDisabledResponse() };
    }

    return { ok: true, admin: auth.admin };
}

function validateReason(reason) {
    return typeof reason === 'string' && reason.trim().length >= 3 && reason.length <= 1000;
}

function mapRpcError(error) {
    if (error?.code === '42501') return 403;
    if (error?.code === 'P0002') return 404;
    if (error?.code === '22023') return 409;
    return 500;
}

export async function GET(req) {
    const auth = await authorizeBatchAdmin(req);
    if (!auth.ok) return auth.response;

    try {
        const { searchParams } = new URL(req.url);
        const batchId = searchParams.get('batch_id');
        if (batchId && !UUID_PATTERN.test(batchId)) {
            return NextResponse.json({ success: false, message: 'batch_id tidak valid.' }, { status: 400 });
        }

        const supabase = getSupabaseAdmin();
        let query = supabase
            .from('kdj_departure_batches')
            .select('id, batch_code, name, departure_month, estimated_departure_date, confirmed_departure_date, status, note, created_at, updated_at')
            .order('departure_month', { ascending: false })
            .order('batch_code', { ascending: true });

        if (batchId) query = query.eq('id', batchId);

        const { data: batches, error } = await query;
        if (error) throw error;

        let events = [];
        if (batchId) {
            const { data, error: eventError } = await supabase
                .from('kdj_departure_batch_events')
                .select('id, order_id, previous_batch_id, new_batch_id, event_type, previous_departure_month, new_departure_month, previous_estimated_departure_date, new_estimated_departure_date, previous_confirmed_departure_date, new_confirmed_departure_date, previous_status, new_status, actor_admin_id, reason, created_at')
                .or(`batch_id.eq.${batchId},previous_batch_id.eq.${batchId},new_batch_id.eq.${batchId}`)
                .order('created_at', { ascending: false });

            if (eventError) throw eventError;
            events = data || [];
        }

        const { data: ordersData, error: ordersError } = await supabase
            .from('kdj_departure_orders')
            .select('id, pendaftar_id, package_name, total_amount_idr, paid_amount_idr, remaining_amount_idr, payment_status, departure_batch_id, created_at')
            .order('created_at', { ascending: true })
            .limit(1000);

        if (ordersError) throw ordersError;

        const pendaftarIds = [...new Set((ordersData || []).map((order) => order.pendaftar_id).filter(Boolean))];
        let studentsById = new Map();
        if (pendaftarIds.length > 0) {
            const { data: students, error: studentsError } = await supabase
                .from('pendaftar')
                .select('id, nama_lengkap, nama_leads')
                .in('id', pendaftarIds);
            if (studentsError) throw studentsError;
            studentsById = new Map((students || []).map((student) => [student.id, student]));
        }

        const orders = (ordersData || []).map((order) => {
            const student = studentsById.get(order.pendaftar_id) || {};
            return {
                ...order,
                student_name: student.nama_lengkap || student.nama_leads || 'Nama belum tersedia'
            };
        });

        return NextResponse.json({ success: true, batches: batches || [], events, orders });
    } catch (error) {
        console.error('[-] Error GET /api/admin/departure-batches:', error?.code, error?.message);
        return NextResponse.json(
            { success: false, message: 'Gagal memuat data gelombang keberangkatan.' },
            { status: 500 }
        );
    }
}

export async function POST(req) {
    const auth = await authorizeBatchAdmin(req);
    if (!auth.ok) return auth.response;

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.action !== 'string') {
        return NextResponse.json(
            { success: false, message: 'Payload pengelolaan gelombang tidak valid.' },
            { status: 400 }
        );
    }

    const reason = body.reason;
    if (!validateReason(reason)) {
        return NextResponse.json(
            { success: false, message: 'Alasan wajib diisi minimal 3 karakter.' },
            { status: 400 }
        );
    }

    const supabase = getSupabaseAdmin();
    let functionName;
    let params;

    switch (body.action) {
        case 'CREATE': {
            if (
                typeof body.batch_code !== 'string' ||
                !/^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$/.test(body.batch_code.trim()) ||
                typeof body.name !== 'string' ||
                body.name.trim().length < 1 ||
                body.name.length > 120 ||
                !isMonthStart(body.departure_month) ||
                !currentJakartaMonthStart() ||
                body.departure_month < currentJakartaMonthStart() ||
                (body.estimated_departure_date !== null &&
                    body.estimated_departure_date !== undefined &&
                    (!isCalendarDate(body.estimated_departure_date) ||
                        !currentJakartaDate() ||
                        body.estimated_departure_date < currentJakartaDate()))
            ) {
                return NextResponse.json(
                    { success: false, message: 'Kode, nama, bulan gelombang, atau tanggal estimasi tidak valid.' },
                    { status: 400 }
                );
            }
            functionName = 'kdj_admin_create_departure_batch';
            params = {
                p_batch_code: body.batch_code.trim().toUpperCase(),
                p_name: body.name.trim(),
                p_departure_month: body.departure_month,
                p_estimated_departure_date: body.estimated_departure_date || null,
                p_reason: reason.trim(),
                p_actor_admin_id: auth.admin.id
            };
            break;
        }
        case 'UPDATE_ESTIMATE': {
            if (!UUID_PATTERN.test(String(body.batch_id || '')) ||
                (body.estimated_departure_date !== null &&
                    body.estimated_departure_date !== undefined &&
                    (!isCalendarDate(body.estimated_departure_date) ||
                        !currentJakartaDate() ||
                        body.estimated_departure_date < currentJakartaDate()))) {
                return NextResponse.json(
                    { success: false, message: 'ID gelombang atau tanggal estimasi tidak valid.' },
                    { status: 400 }
                );
            }
            functionName = 'kdj_admin_update_departure_batch_estimate';
            params = {
                p_batch_id: body.batch_id,
                p_estimated_departure_date: body.estimated_departure_date || null,
                p_reason: reason.trim(),
                p_actor_admin_id: auth.admin.id
            };
            break;
        }
        case 'CONFIRM_DATE':
        case 'CHANGE_DATE': {
            if (
                !UUID_PATTERN.test(String(body.batch_id || '')) ||
                !isCalendarDate(body.confirmed_departure_date) ||
                !currentJakartaDate() ||
                body.confirmed_departure_date < currentJakartaDate()
            ) {
                return NextResponse.json(
                    { success: false, message: 'ID gelombang atau tanggal final tidak valid.' },
                    { status: 400 }
                );
            }
            functionName = body.action === 'CONFIRM_DATE'
                ? 'kdj_admin_confirm_departure_batch'
                : 'kdj_admin_change_departure_batch_date';
            params = body.action === 'CONFIRM_DATE'
                ? {
                    p_batch_id: body.batch_id,
                    p_confirmed_departure_date: body.confirmed_departure_date,
                    p_reason: reason.trim(),
                    p_actor_admin_id: auth.admin.id
                }
                : {
                    p_batch_id: body.batch_id,
                    p_new_confirmed_departure_date: body.confirmed_departure_date,
                    p_reason: reason.trim(),
                    p_actor_admin_id: auth.admin.id
                };
            break;
        }
        case 'ASSIGN_ORDER': {
            if (!UUID_PATTERN.test(String(body.order_id || '')) || !UUID_PATTERN.test(String(body.batch_id || ''))) {
                return NextResponse.json(
                    { success: false, message: 'ID order atau gelombang tidak valid.' },
                    { status: 400 }
                );
            }
            functionName = 'kdj_admin_assign_departure_order_batch';
            params = {
                p_order_id: body.order_id,
                p_batch_id: body.batch_id,
                p_reason: reason.trim(),
                p_actor_admin_id: auth.admin.id
            };
            break;
        }
        default:
            return NextResponse.json(
                { success: false, message: 'Aksi pengelolaan gelombang tidak dikenal.' },
                { status: 400 }
            );
    }

    try {
        const { data, error } = await supabase.rpc(functionName, params);
        if (error) {
            const status = mapRpcError(error);
            console.error('[-] Departure batch RPC failed:', functionName, error.code);
            return NextResponse.json(
                { success: false, code: error.code || 'DEPARTURE_BATCH_RPC_FAILED', message: 'Perubahan gelombang tidak dapat diproses.' },
                { status }
            );
        }

        if (data?.success !== true) {
            return NextResponse.json(
                { success: false, message: 'Database belum mengonfirmasi perubahan gelombang.' },
                { status: 409 }
            );
        }

        return NextResponse.json({ success: true, result: data });
    } catch (error) {
        console.error('[-] Error POST /api/admin/departure-batches:', error?.code, error?.message);
        return NextResponse.json(
            { success: false, message: 'Gagal memproses perubahan gelombang.' },
            { status: 500 }
        );
    }
}
