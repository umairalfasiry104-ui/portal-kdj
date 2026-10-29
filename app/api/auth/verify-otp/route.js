import { NextResponse } from 'next/server';
import {
    getSupabaseAdmin,
    consumeOtpAtomically,
    getPhoneCandidates,
    setUserSessionCookie,
    clearSessionCookie,
    USER_COOKIE_NAME,
    createSignedStorageUrl
} from '@/lib/security';

export async function POST(req) {
    try {
        const body = await req.json().catch(() => null);
        const phone = body?.phone;
        const otp = body?.otp;

        if (!phone || !otp) {
            return NextResponse.json(
                { success: false, message: 'Nomor WA dan OTP wajib diisi' },
                { status: 400 }
            );
        }

        const supabase = getSupabaseAdmin();
        const otpResult = await consumeOtpAtomically(supabase, phone, otp);

        if (!otpResult.valid) {
            return NextResponse.json(
                { success: false, message: otpResult.message },
                { status: otpResult.status }
            );
        }

        const normalizedPhone = otpResult.normalizedPhone;
        const candidates = getPhoneCandidates(normalizedPhone);

        // Cek apakah pendaftar sudah ada (mendukung format 08xx maupun 628xx lama)
        const { data: existingUser } = await supabase
            .from('pendaftar')
            .select('*')
            .in('no_wa', candidates)
            .maybeSingle();

        let user = existingUser;

        if (!user) {
            // Pendaftar baru: set status_pendaftaran eksplisit ke 'draft_berkas'
            // agar tidak terkena default kolom DB 'Submitted' yang langsung mengunci form!
            const { data: createdUser, error: insertError } = await supabase
                .from('pendaftar')
                .insert({
                    no_wa: normalizedPhone,
                    status_pendaftaran: 'draft_berkas',
                    status_pembayaran: 'Belum Bayar'
                })
                .select('*')
                .single();

            if (insertError) throw insertError;
            user = createdUser;
        }

        if (user?.bukti_bayar_url) {
            user.bukti_bayar_url = await createSignedStorageUrl(supabase, user.bukti_bayar_url);
        }

        const response = NextResponse.json({ success: true, user });
        setUserSessionCookie(response, user);
        return response;
    } catch (error) {
        console.error('[-] Error verify-otp:', error.message);
        return NextResponse.json(
            { success: false, message: 'Gagal memverifikasi kode OTP.' },
            { status: 500 }
        );
    }
}

export async function DELETE() {
    const response = NextResponse.json({ success: true, message: 'Sesi pengguna dihapus.' });
    clearSessionCookie(response, USER_COOKIE_NAME);
    return response;
}