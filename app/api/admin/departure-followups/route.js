import { NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAdminSession } from '@/lib/security';

const VIEW_ROLES = ['Super Admin', 'Admin Verifikator', 'Admin Viewer'];

function maskPhone(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return null;
    if (digits.length < 7) return '••••';
    return digits.slice(0, 4) + '••••' + digits.slice(-3);
}

export async function GET(req) {
    const auth = await requireAdminSession(req);
    if (!auth.authorized) return auth.response;

    if (!VIEW_ROLES.includes(auth.admin?.role)) {
        return NextResponse.json(
            { success: false, code: 'FORBIDDEN_ROLE_PERMISSION', message: 'Akses monitoring pembayaran tidak diizinkan.' },
            { status: 403 }
        );
    }

    if (process.env.KDJ_DEPARTURE_BATCH_FEATURE_ENABLED !== 'true') {
        return NextResponse.json(
            {
                success: false,
                code: 'DEPARTURE_FOLLOWUP_FEATURE_DISABLED',
                message: 'Monitoring pelunasan belum diaktifkan pada environment ini.'
            },
            { status: 503 }
        );
    }

    try {
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase.rpc('kdj_admin_list_departure_h45_followups');
        if (error) {
            console.error('[-] Departure follow-up read model failed:', error.code);
            if (error.code === 'PGRST202' || error.code === '42883') {
                return NextResponse.json(
                    { success: false, code: 'DEPARTURE_FOLLOWUP_SCHEMA_NOT_READY', message: 'Database monitoring belum tersedia. Pastikan migration gelombang sudah diterapkan.' },
                    { status: 503 }
                );
            }
            throw error;
        }

        const rows = (Array.isArray(data) ? data : []).map((row) => {
            const { whatsapp, ...safeRow } = row;
            return {
                ...safeRow,
                phone_masked: maskPhone(whatsapp)
            };
        });

        const determined = rows.filter((row) => row.h45_followup_determinable === true);
        const triggered = determined.filter((row) => row.h45_followup_triggered === true);

        return NextResponse.json({
            success: true,
            generated_at: new Date().toISOString(),
            summary: {
                outstanding_orders: rows.length,
                h45_followup: triggered.length,
                h30_target: determined.filter((row) => Number(row.days_until_departure) <= 30).length,
                h7_urgent: determined.filter((row) => Number(row.days_until_departure) <= 7).length,
                departure_date_pending: rows.length - determined.length,
                pending_payment_proofs: rows.reduce((sum, row) => sum + (Number(row.pending_verification_count) || 0), 0)
            },
            orders: rows
        }, {
            headers: {
                'Cache-Control': 'private, no-store, max-age=0'
            }
        });
    } catch (error) {
        console.error('[-] Error GET /api/admin/departure-followups:', error?.code, error?.message);
        return NextResponse.json(
            { success: false, message: 'Gagal memuat monitoring pelunasan.' },
            { status: 500 }
        );
    }
}
