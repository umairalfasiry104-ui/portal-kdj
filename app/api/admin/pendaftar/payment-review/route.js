import { NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAdminSession, createSignedStorageUrl } from '@/lib/security';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req) {
    try {
        const authCheck = await requireAdminSession(req);
        if (!authCheck.authorized) return authCheck.response;

        if (authCheck.admin?.role !== 'Super Admin') {
            return NextResponse.json(
                { success: false, code: 'FORBIDDEN_ROLE_PERMISSION', message: 'Akses pembayaran hanya untuk Super Admin.' },
                { status: 403 }
            );
        }

        const { searchParams } = new URL(req.url);
        const pendaftarId = searchParams.get('pendaftar_id');
        if (typeof pendaftarId !== 'string' || !UUID_PATTERN.test(pendaftarId)) {
            return NextResponse.json(
                { success: false, message: 'pendaftar_id tidak valid.' },
                { status: 400 }
            );
        }

        const supabase = getSupabaseAdmin();
        const { data: payment, error: paymentError } = await supabase
            .from('kdj_registration_payments')
            .select('id, pendaftar_id, invoice_ref, amount_idr, currency, status, initial_submission_at, deadline_at, paid_at, verified_by, verified_at, current_proof_id')
            .eq('pendaftar_id', pendaftarId)
            .maybeSingle();

        if (paymentError) throw paymentError;
        if (!payment) {
            return NextResponse.json({ success: true, payment: null, proof: null });
        }

        let proof = null;
        if (payment.current_proof_id) {
            const { data, error } = await supabase
                .from('kdj_registration_payment_proofs')
                .select('id, attempt_no, object_path, original_filename, mime_type, size_bytes, status, submitted_at, reviewed_at, review_reason')
                .eq('id', payment.current_proof_id)
                .eq('payment_id', payment.id)
                .maybeSingle();

            if (error) throw error;
            if (data) {
                const signedUrl = await createSignedStorageUrl(supabase, data.object_path);
                proof = { ...data, signed_url: signedUrl, object_path: undefined };
            }
        }

        const deadlineMs = Date.parse(payment.deadline_at || '');
        const effectiveStatus = ['PENDING_PAYMENT', 'REOPENED'].includes(payment.status)
            && Number.isFinite(deadlineMs)
            && deadlineMs <= Date.now()
                ? 'EXPIRED'
                : payment.status;

        return NextResponse.json({
            success: true,
            payment: { ...payment, effective_status: effectiveStatus },
            proof
        });
    } catch (error) {
        console.error('[-] Error /api/admin/pendaftar/payment-review GET:', error?.code, error?.message);
        return NextResponse.json(
            { success: false, message: 'Gagal memuat data verifikasi pembayaran.' },
            { status: 500 }
        );
    }
}

export async function POST(req) {
    try {
        const authCheck = await requireAdminSession(req);
        if (!authCheck.authorized) return authCheck.response;

        if (authCheck.admin?.role !== 'Super Admin') {
            return NextResponse.json(
                {
                    success: false,
                    code: 'FORBIDDEN_ROLE_PERMISSION',
                    message: 'Verifikasi pembayaran hanya dapat dilakukan oleh Super Admin.'
                },
                { status: 403 }
            );
        }

        const body = await req.json().catch(() => null);
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            return NextResponse.json(
                { success: false, message: 'Payload verifikasi pembayaran tidak valid.' },
                { status: 400 }
            );
        }

        const { payment_id, proof_id, decision, reason } = body;
        if (
            typeof payment_id !== 'string' || !UUID_PATTERN.test(payment_id) ||
            typeof proof_id !== 'string' || !UUID_PATTERN.test(proof_id) ||
            !['APPROVE', 'REJECT'].includes(decision) ||
            typeof reason !== 'string' || reason.trim().length < 3 || reason.length > 1000
        ) {
            return NextResponse.json(
                { success: false, message: 'ID pembayaran, bukti, keputusan, atau alasan tidak valid.' },
                { status: 400 }
            );
        }

        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase.rpc(
            'kdj_admin_review_registration_payment',
            {
                p_payment_id: payment_id,
                p_proof_id: proof_id,
                p_decision: decision,
                p_reason: reason.trim(),
                p_actor_admin_id: authCheck.admin.id
            }
        );

        if (error) {
            if (error.code === '42501') {
                return NextResponse.json(
                    { success: false, message: 'Akses verifikasi pembayaran ditolak.' },
                    { status: 403 }
                );
            }
            if (error.code === '40001') {
                return NextResponse.json(
                    { success: false, message: 'Bukti pembayaran sudah berubah atau sudah diperiksa. Muat ulang data sebelum melanjutkan.' },
                    { status: 409 }
                );
            }
            if (error.code === 'P0002') {
                return NextResponse.json(
                    { success: false, message: 'Data pembayaran tidak ditemukan.' },
                    { status: 404 }
                );
            }
            if (error.code === '22023') {
                return NextResponse.json(
                    { success: false, message: 'Status atau keputusan pembayaran tidak valid.' },
                    { status: 400 }
                );
            }
            throw error;
        }

        if (data?.success !== true) {
            return NextResponse.json(
                { success: false, message: 'Database belum mengonfirmasi perubahan pembayaran.' },
                { status: 409 }
            );
        }

        return NextResponse.json({ success: true, payment: data });
    } catch (error) {
        console.error('[-] Error /api/admin/pendaftar/payment-review POST:', error?.code, error?.message);
        return NextResponse.json(
            { success: false, message: 'Gagal memproses verifikasi pembayaran.' },
            { status: 500 }
        );
    }
}
