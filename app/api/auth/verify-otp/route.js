import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(req) {
    try {
        const { phone, otp } = await req.json();
        if (!phone || !otp) {
            return NextResponse.json({ success: false, message: 'Nomor WA dan OTP wajib diisi' }, { status: 400 });
        }

        const { data: validOtp, error: queryError } = await supabase
            .from('otp_auth')
            .select('*')
            .eq('no_wa', phone)
            .eq('kode_otp', otp)
            .eq('is_used', false)
            .gt('expires_at', new Date().toISOString())
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (queryError || !validOtp) {
            return NextResponse.json({ success: false, message: 'Kode OTP salah atau kedaluwarsa!' }, { status: 400 });
        }

        await supabase.from('otp_auth').update({ is_used: true }).eq('id', validOtp.id);

        // Ambil atau buat data pendaftar lalu kembalikan ke frontend
        const { data: user, error: userError } = await supabase
            .from('pendaftar')
            .upsert({ no_wa: phone }, { onConflict: 'no_wa' })
            .select()
            .single();

        if (userError) throw userError;

        return NextResponse.json({ success: true, user });
    } catch (error) {
        return NextResponse.json({ success: false, message: error.message }, { status: 500 });
    }
}