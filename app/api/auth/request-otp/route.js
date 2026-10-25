import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(req) {
    try {
        const { phone } = await req.json();
        if (!phone) {
            return NextResponse.json({ success: false, message: 'Nomor WhatsApp wajib diisi' }, { status: 400 });
        }

        // 1. Buat kode OTP acak 6 digit dan masa aktif 5 menit
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

        // 2. Simpan OTP ke tabel 'otp_auth' (menggunakan kolom no_wa & kode_otp)
        // Kita set is_used = false untuk OTP baru
        const { error: dbError } = await supabase
            .from('otp_auth')
            .insert({ 
                no_wa: phone, 
                kode_otp: otp, 
                expires_at: expiresAt, 
                is_used: false 
            });

        if (dbError) throw dbError;

        // 3. Tembak API Bot WhatsApp yang berjalan di port 3001
        const botRes = await fetch(`${process.env.WA_BOT_API_URL}/send-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, otp })
        });

        const botData = await botRes.json();
        if (!botRes.ok || !botData.success) {
            throw new Error(botData.message || 'Gagal mengirim OTP via Bot WhatsApp');
        }

        return NextResponse.json({ success: true, message: 'Kode OTP berhasil dikirim ke WhatsApp!' });
    } catch (error) {
        return NextResponse.json({ success: false, message: error.message }, { status: 500 });
    }
}