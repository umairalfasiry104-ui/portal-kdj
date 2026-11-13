import { NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAdminSession } from '@/lib/security';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_ACTIONS = new Set([
    'RETRY_FAILED',
    'RECONCILE_UNKNOWN_SENT',
    'RECONCILE_UNKNOWN_FAILED'
]);

function jsonError(message, status = 400, code = 'INVALID_REQUEST') {
    return NextResponse.json({ success: false, code, message }, { status });
}

function maskPhone(value) {
    const digits = String(value || '').replace(/[^0-9]/g, '');
    if (!digits) return 'Tidak tersedia';
    return `••••••${digits.slice(-4)}`;
}

async function requireSuperAdmin(req) {
    const auth = await requireAdminSession(req);
    if (!auth.authorized) return { ok: false, response: auth.response };
    if (auth.admin?.role !== 'Super Admin') {
        return {
            ok: false,
            response: jsonError('Pemulihan pengiriman laporan hanya dapat dilakukan oleh Super Admin.', 403, 'FORBIDDEN_ROLE_PERMISSION')
        };
    }
    return { ok: true, admin: auth.admin };
}

export async function GET(req) {
    const auth = await requireSuperAdmin(req);
    if (!auth.ok) return auth.response;

    try {
        const supabase = getSupabaseAdmin();
        const { data: deliveries, error } = await supabase
            .from('kdj_admin_daily_report_deliveries')
            .select('id, report_run_id, admin_role, recipient_phone, status, attempts, last_error, provider_message_id, updated_at')
            .in('status', ['FAILED', 'UNKNOWN'])
            .order('updated_at', { ascending: false })
            .limit(100);

        if (error) throw error;

        const runIds = [...new Set((deliveries || []).map((row) => row.report_run_id).filter(Boolean))];
        let reportDateByRunId = new Map();
        if (runIds.length > 0) {
            const { data: runs, error: runsError } = await supabase
                .from('kdj_admin_daily_report_runs')
                .select('id, report_date')
                .in('id', runIds);
            if (runsError) throw runsError;
            reportDateByRunId = new Map((runs || []).map((run) => [run.id, run.report_date]));
        }

        return NextResponse.json({
            success: true,
            deliveries: (deliveries || []).map((row) => ({
                id: row.id,
                report_date: reportDateByRunId.get(row.report_run_id) || null,
                admin_role: row.admin_role,
                recipient_masked: maskPhone(row.recipient_phone),
                status: row.status,
                attempts: row.attempts,
                last_error: typeof row.last_error === 'string' ? row.last_error.slice(0, 500) : null,
                provider_message_id: row.provider_message_id,
                updated_at: row.updated_at
            }))
        }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        console.error('[-] /api/admin/daily-report/recovery GET:', error?.code, error?.message);
        return jsonError('Gagal memuat antrean pemulihan laporan.', 500, 'RECOVERY_LIST_FAILED');
    }
}

export async function POST(req) {
    const auth = await requireSuperAdmin(req);
    if (!auth.ok) return auth.response;

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return jsonError('Payload pemulihan laporan tidak valid.');
    }

    const action = body.action;
    const deliveryId = body.delivery_id;
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!ALLOWED_ACTIONS.has(action) || typeof deliveryId !== 'string' || !UUID_PATTERN.test(deliveryId)) {
        return jsonError('Aksi atau ID delivery tidak valid.');
    }
    if (reason.length < 3 || reason.length > 1000) {
        return jsonError('Alasan tindakan wajib 3–1.000 karakter.');
    }

    let rpcName;
    let rpcArgs;
    if (action === 'RETRY_FAILED') {
        rpcName = 'kdj_admin_retry_failed_daily_report_delivery';
        rpcArgs = {
            p_delivery_id: deliveryId,
            p_reason: reason,
            p_actor_admin_id: auth.admin.id
        };
    } else {
        const resolution = action === 'RECONCILE_UNKNOWN_SENT' ? 'SENT' : 'FAILED';
        const providerMessageId = typeof body.provider_message_id === 'string'
            ? body.provider_message_id.trim()
            : '';

        if (resolution === 'SENT' && (providerMessageId.length < 1 || providerMessageId.length > 255)) {
            return jsonError('Referensi pesan dari provider wajib diisi untuk rekonsiliasi SENT.');
        }
        if (resolution === 'FAILED' && body.confirmed_no_message !== true) {
            return jsonError('Konfirmasi bahwa pesan tidak terkirim wajib diberikan sebelum UNKNOWN ditandai FAILED.', 422, 'UNKNOWN_REQUIRES_EXPLICIT_CONFIRMATION');
        }

        rpcName = 'kdj_admin_reconcile_daily_report_delivery';
        rpcArgs = {
            p_delivery_id: deliveryId,
            p_resolution: resolution,
            p_reason: reason,
            p_actor_admin_id: auth.admin.id,
            p_provider_message_id: resolution === 'SENT' ? providerMessageId : null
        };
    }

    try {
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase.rpc(rpcName, rpcArgs);
        if (error) {
            if (error.code === '42501') return jsonError('Akses pemulihan laporan ditolak.', 403, 'FORBIDDEN');
            if (error.code === '40001') return jsonError('Status delivery sudah berubah. Muat ulang daftar sebelum melanjutkan.', 409, 'DELIVERY_STATE_CHANGED');
            if (error.code === 'P0002') return jsonError('Delivery tidak ditemukan.', 404, 'DELIVERY_NOT_FOUND');
            if (error.code === '22023') return jsonError('Status atau data pemulihan tidak memenuhi aturan.', 409, 'INVALID_DELIVERY_TRANSITION');
            throw error;
        }
        if (data?.success !== true) {
            return jsonError('Database belum mengonfirmasi perubahan status delivery.', 409, 'DELIVERY_UPDATE_NOT_CONFIRMED');
        }
        return NextResponse.json({ success: true, action, delivery: data });
    } catch (error) {
        console.error('[-] /api/admin/daily-report/recovery POST:', error?.code, error?.message);
        return jsonError('Gagal memproses pemulihan delivery laporan.', 500, 'RECOVERY_ACTION_FAILED');
    }
}
