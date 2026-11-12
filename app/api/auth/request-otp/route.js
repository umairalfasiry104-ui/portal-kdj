import crypto from 'crypto';
import { NextResponse } from 'next/server';
import {
    getSupabaseAdmin,
    normalizePhoneLocal,
    requestOtpAtomically,
    checkSharedRateLimit,
    getClientIpAddress,
    SHARED_AUTH_RATE_LIMITS,
    callWaBotApi
} from '@/lib/security';

async function invalidateIssuedOtp(supabase, otpId) {
    const { error } = await supabase
        .from('otp_auth')
        .update({ is_used: true })
        .eq('id', otpId)
        .eq('is_used', false);

    if (error) {
        console.error('[-] Gagal menonaktifkan OTP yang gagal dikirim:', error.code || 'DB_ERROR');
        throw new Error('Gagal menonaktifkan OTP yang gagal dikirim.');
    }
}

export async function POST(req) {
    try {
        const supabase = getSupabaseAdmin();
        const clientIp = getClientIpAddress(req);
        const ipRateLimit = SHARED_AUTH_RATE_LIMITS.customerOtpRequestIp;
        const ipRateCheck = await checkSharedRateLimit(
            supabase,
            ipRateLimit.scope,
            clientIp,
            ipRateLimit.maxRequests,
            ipRateLimit.windowMs
        );

        if (!ipRateCheck.allowed) {
            return NextResponse.json(
                {
                    success: false,
                    message: 'Terlalu banyak permintaan OTP dari jaringan ini. Silakan coba lagi nanti.'
                },
                {
                    status: 429,
                    headers: { 'Retry-After': String(ipRateCheck.retryAfterSec) }
                }
            );
        }

        const body = await req.json().catch(() => null);
        const normalizedPhone = normalizePhoneLocal(body?.phone);
        if (!normalizedPhone) {
            return NextResponse.json(
                { success: false, message: 'Format nomor WhatsApp tidak valid (gunakan format 08xxxxxxxxxx).' },
                { status: 400 }
            );
        }

        // Database transaction enforces 60s per-phone cooldown, 4/10m quota,
        // invalidation of the previous OTP and insertion of the new OTP.
        const otp = crypto.randomInt(100000, 1000000).toString();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        const issueResult = await requestOtpAtomically(supabase, normalizedPhone, otp, expiresAt);

        if (!issueResult?.allowed) {
            const retryAfterSec = Math.max(1, Number(issueResult?.retry_after_sec) || 1);
            const message = issueResult?.reason === 'COOLDOWN'
                ? 'Permintaan OTP terlalu cepat. Silakan tunggu sebelum meminta kode baru.'
                : issueResult?.reason === 'LOCKED'
                    ? 'Terlalu banyak percobaan OTP yang salah. Silakan tunggu sebelum mencoba lagi.'
                    : 'Terlalu banyak permintaan OTP. Silakan coba lagi nanti.';

            return NextResponse.json(
                { success: false, message },
                { status: 429, headers: { 'Retry-After': String(retryAfterSec) } }
            );
        }

        const otpId = issueResult.otp_id;
        if (!otpId) {
            return NextResponse.json(
                { success: false, message: 'Gagal memproses permintaan OTP.' },
                { status: 500 }
            );
        }

        try {
            const botResult = await callWaBotApi('/send-otp', { phone: normalizedPhone, otp });
            if (!botResult.ok) {
                await invalidateIssuedOtp(supabase, otpId);
                return NextResponse.json(
                    {
                        success: false,
                        message: botResult.status === 503
                            ? 'Layanan WhatsApp sedang tidak terhubung. Silakan coba beberapa saat lagi.'
                            : 'Gagal mengirim OTP ke WhatsApp. Pastikan nomor aktif.'
                    },
                    { status: botResult.status === 503 ? 503 : 502 }
                );
            }
        } catch (fetchErr) {
            await invalidateIssuedOtp(supabase, otpId);
            console.error('[-] Error koneksi ke WA Bot saat kirim OTP:', fetchErr.message);
            return NextResponse.json(
                { success: false, message: 'Layanan pengiriman WhatsApp sedang tidak dapat dijangkau.' },
                { status: 503 }
            );
        }

        return NextResponse.json({ success: true, message: 'Kode OTP berhasil dikirim ke WhatsApp!' });
    } catch (error) {
        console.error('[-] Unhandled error request-otp:', error.message);
        return NextResponse.json(
            { success: false, message: 'Terjadi kesalahan internal pada server.' },
            { status: 500 }
        );
    }
}
