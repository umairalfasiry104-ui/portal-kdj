import { NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAdminSession } from '@/lib/security';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req) {
    try {
        const authCheck = await requireAdminSession(req);
        if (!authCheck.authorized) return authCheck.response;

        if (authCheck.admin?.role !== 'Super Admin') {
            return NextResponse.json(
                { success: false, message: 'Pembukaan kembali tagihan hanya dapat dilakukan oleh Super Admin.' },
                { status: 403 }
            );
        }

        const body = await req.json().catch(() => null);
        const paymentId = body?.payment_id;
        const deadlineValue = body?.new_deadline_at;
        const reason = body?.reason;

        if (
            typeof paymentId !== 'string' ||
            !UUID_PATTERN.test(paymentId) ||
            typeof deadlineValue !== 'string' ||
            !Number.isFinite(Date.parse(deadlineValue)) ||
            typeof reason !== 'string' ||
            reason.trim().length < 3 ||
            reason.length > 1000
        ) {
            return NextResponse.json(
                { success: false, message: 'ID tagihan, deadline baru, atau alasan pembukaan tidak valid.' },
                { status: 400 }
            );
        }

        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase.rpc(
            'kdj_admin_reopen_registration_payment',
            {
                p_payment_id: paymentId,
                p_new_deadline: new Date(deadlineValue).toISOString(),
                p_reason: reason.trim(),
                p_actor_admin_id: authCheck.admin.id
            }
        );

        if (error) {
            if (error.code === '42501') {
                return NextResponse.json({ success: false, message: 'Akses pembukaan tagihan ditolak.' }, { status: 403 });
            }
            if (error.code === 'P0002') {
                return NextResponse.json({ success: false, message: 'Tagihan tidak ditemukan.' }, { status: 404 });
            }
            if (error.code === '22023') {
                return NextResponse.json({ success: false, message: 'Status tagihan atau deadline baru tidak memenuhi aturan.' }, { status: 409 });
            }
            throw error;
        }

        if (data?.success !== true) {
            return NextResponse.json({ success: false, message: 'Database belum mengonfirmasi pembukaan tagihan.' }, { status: 409 });
        }

        return NextResponse.json({ success: true, payment: data });
    } catch (error) {
        console.error('[-] Error /api/admin/pendaftar/payment-review/reopen POST:', error?.code, error?.message);
        return NextResponse.json(
            { success: false, message: 'Gagal membuka kembali tagihan.' },
            { status: 500 }
        );
    }
}
