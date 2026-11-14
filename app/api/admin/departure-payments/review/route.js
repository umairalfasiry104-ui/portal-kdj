import { NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAdminSession, callWaBotApi } from '@/lib/security';

function formatRupiah(number) {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(number);
}

// POST: Verifikasi atau Tolak Cicilan Paket Keberangkatan
export async function POST(req) {
    const auth = await requireAdminSession(req);
    if (!auth.authorized) return auth.response;

    const allowedRoles = ['Super Admin', 'Admin Verifikator'];
    if (!allowedRoles.includes(auth.admin.role)) {
        return NextResponse.json(
            { success: false, message: 'Hanya Super Admin dan Admin Verifikator yang berhak memverifikasi cicilan.' },
            { status: 403 }
        );
    }

    try {
        const body = await req.json();
        const { installment_id, action, reason } = body;

        if (!installment_id || !['APPROVE', 'REJECT'].includes(action)) {
            return NextResponse.json({ success: false, message: 'Parameter review cicilan tidak valid.' }, { status: 400 });
        }

        if (action === 'REJECT' && (!reason || reason.trim().length < 3)) {
            return NextResponse.json({ success: false, message: 'Alasan penolakan wajib diisi minimal 3 karakter.' }, { status: 400 });
        }

        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase.rpc('kdj_admin_review_departure_installment', {
            p_installment_id: installment_id,
            p_action: action,
            p_actor_admin_id: auth.admin.id,
            p_reason: reason ? reason.trim() : null
        });

        if (error) {
            console.error('[-] Error kdj_admin_review_departure_installment RPC:', error);
            if (error.code === '42501') {
                return NextResponse.json({ success: false, message: 'Akses ditolak.' }, { status: 403 });
            }
            if (error.code === '22023') {
                return NextResponse.json({ success: false, message: error.message }, { status: 409 });
            }
            throw error;
        }

        const student = data.student || {};
        const order = data.order || {};
        const installment = data.installment || {};
        const isPaid = order.payment_status === 'PAID';

        // Susun Notifikasi WhatsApp ke Santri & Orang Tua / Wali
        const santriPhone = student.no_wa;
        const waliPhone = student.no_wa_orang_tua_wali;
        const santriName = student.nama_lengkap || 'Calon Mahasiswa';

        let notifyNote = '';
        let notifyStatus = '';

        if (action === 'APPROVE') {
            notifyStatus = isPaid ? 'PAKET KEBERANGKATAN LUNAS 100%' : 'CICILAN DIVERIFIKASI';
            notifyNote =
                `Alhamdulillah, pembayaran cicilan paket keberangkatan telah diverifikasi oleh Admin KDJ.\n\n` +
                `📋 *Rincian Pembayaran:*\n` +
                `• Nama: ${santriName}\n` +
                `• Paket: ${order.package_name}\n` +
                `• Nominal Masuk: ${formatRupiah(installment.amount_idr)}\n` +
                `• Total Terbayar: ${formatRupiah(order.paid_amount_idr)}\n` +
                `• Sisa Pelunasan: ${formatRupiah(order.remaining_amount_idr)}\n` +
                `• Status: ${isPaid ? 'LUNAS (100%)' : 'BELUM LUNAS (Maksimal H-45 sebelum keberangkatan)'}\n\n` +
                (isPaid
                    ? '🎉 Pembayaran telah Lunas 100%! Seluruh dokumen Suketmah & LOA kini dapat diunduh di portal, dan pengurusan Visa & Tiket akan segera diproses.'
                    : 'Pantau riwayat cicilan & perkembangan berkas Anda di: pendaftaran.kuliahdijordan.com');
        } else {
            notifyStatus = 'BUKTI CICILAN PERLU REVISI';
            notifyNote =
                `Mohon maaf, bukti pembayaran cicilan sebesar ${formatRupiah(installment.amount_idr)} belum dapat disetujui.\n\n` +
                `Alasan: "${reason.trim()}"\n\n` +
                `Silakan unggah ulang bukti transfer yang jelas melalui portal: pendaftaran.kuliahdijordan.com`;
        }

        // Kirim WhatsApp secara asinkron ke Santri & Wali (jika nomor wali tersedia)
        const recipientPhones = [santriPhone];
        if (waliPhone && waliPhone !== santriPhone) {
            recipientPhones.push(waliPhone);
        }

        for (const phone of recipientPhones) {
            try {
                await callWaBotApi(
                    '/notify-status',
                    {
                        phone,
                        name: santriName,
                        status: notifyStatus,
                        note: notifyNote
                    },
                    { retryOnNetworkError: false }
                );
            } catch (notifyErr) {
                console.error(`[-] Gagal kirim WA cicilan ke ${phone}:`, notifyErr.message);
            }
        }

        return NextResponse.json({
            success: true,
            action,
            installment,
            order
        });
    } catch (error) {
        console.error('[-] Error admin review departure installment:', error.message);
        return NextResponse.json({ success: false, message: error.message || 'Gagal memverifikasi cicilan.' }, { status: 500 });
    }
}
