import crypto from 'crypto';
import { NextResponse } from 'next/server';
import {
    getSupabaseAdmin,
    normalizePhoneLocal,
    getPhoneCandidates,
    checkRateLimit,
    callWaBotApi
} from '@/lib/security';

const OTP_COOLDOWN_MS = 60 * 1000; // Cooldown 60 detik per nomor

export async function POST(req) {
    try {
        const body = await req.json().catch(() => null);
        const normalizedPhone = normalizePhoneLocal(body?.phone);

        if (!normalizedPhone) {
            return NextResponse.json(
                { success: false, message: 'Format nomor WhatsApp tidak valid (gunakan format 08xxxxxxxxxx).' },
                { status: 400 }
            );
        }

        // 1. Rate limit per nomor (maksimal 4 request / 10 menit)
        const rateCheck = checkRateLimit(`req-otp:${normalizedPhone}`, 4, 10 * 60 * 1000);
        if (!rateCheck.allowed) {
            return NextResponse.json(
                {
                    success: false,
                    message: `Terlalu banyak permintaan OTP. Silakan tunggu ${rateCheck.retryAfterSec} detik lagi.`
                },
                { status: 429 }
            );
        }

        const supabase = getSupabaseAdmin();
        const candidates = getPhoneCandidates(normalizedPhone);

        // 2. Cek cooldown 60 detik berbasis database (aman di lingkungan serverless)
        const {
    data: latestOtp,
    error: latestOtpError
} = await supabase
    .from('otp_auth')
    .select('id, created_at')
    .in('no_wa', candidates)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

if (latestOtpError) {
    console.error(
        '[-] Gagal memeriksa cooldown OTP:',
        latestOtpError.message
    );

    return NextResponse.json(
        {
            success: false,
            message: 'Gagal memeriksa status OTP. Silakan coba lagi.'
        },
        { status: 500 }
    );
}

        // 3. Invalidasi seluruh OTP lama yang belum dipakai untuk nomor ini
        const { error: invalidateError } = await supabase
    .from('otp_auth')
    .update({ is_used: true })
    .in('no_wa', candidates)
    .eq('is_used', false);

if (invalidateError) {
    console.error(
        '[-] Gagal menonaktifkan OTP lama:',
        invalidateError.message
    );

    return NextResponse.json(
        {
            success: false,
            message: 'Gagal memproses permintaan OTP. Silakan coba lagi.'
        },
        { status: 500 }
    );
}
        // 4. Buat kode OTP 6 digit kriptografis dan masa aktif 5 menit
        const otp = crypto.randomInt(100000, 1000000).toString();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

        const { data: insertedOtp, error: dbError } = await supabase
            .from('otp_auth')
            .insert({
                no_wa: normalizedPhone,
                kode_otp: otp,
                expires_at: expiresAt,
                is_used: false
            })
            .select('id')
            .single();

        if (dbError || !insertedOtp) {
            console.error('[-] Gagal menyimpan OTP ke DB:', dbError?.message);
            return NextResponse.json(
                { success: false, message: 'Gagal memproses permintaan OTP.' },
                { status: 500 }
            );
        }

        // 5. Kirim OTP melalui API internal WhatsApp Bot dengan header autentikasi
        try {
            const botResult = await callWaBotApi('/send-otp', {
                phone: normalizedPhone,
                otp
            });

            if (!botResult.ok) {
                // Batalkan OTP di DB jika pengiriman WA gagal agar tidak meninggalkan OTP aktif
                await supabase.from('otp_auth').update({ is_used: true }).eq('id', insertedOtp.id);
                const statusHttp = botResult.status === 503 ? 503 : 502;
                return NextResponse.json(
                    {
                        success: false,
                        message:
                            botResult.status === 503
                                ? 'Layanan WhatsApp sedang tidak terhubung. Silakan coba beberapa saat lagi.'
                                : 'Gagal mengirim OTP ke WhatsApp. Pastikan nomor aktif.'
                    },
                    { status: statusHttp }
                );
            }
        } catch (fetchErr) {
            await supabase.from('otp_auth').update({ is_used: true }).eq('id', insertedOtp.id);
            console.error('[-] Error koneksi ke WA Bot saat kirim OTP:', fetchErr.message);
            return NextResponse.json(
                { success: false, message: 'Layanan pengiriman WhatsApp sedang tidak dapat dijangkau.' },
                { status: 503 }
            );
        }

        return NextResponse.json({
            success: true,
            message: 'Kode OTP berhasil dikirim ke WhatsApp!'
        });
    } catch (error) {
        console.error('[-] Unhandled error request-otp:', error.message);
        return NextResponse.json(
            { success: false, message: 'Terjadi kesalahan internal pada server.' },
            { status: 500 }
        );
    }
}