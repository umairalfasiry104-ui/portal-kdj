import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 1. Cek apakah nomor terdaftar sebagai Admin (sebelum/sesudah OTP)
export async function POST(req) {
    try {
        const { action, phone, otp, new_admin_phone, new_admin_name, new_admin_role } = await req.json();

        // Aksi A: Cek nomor sebelum kirim OTP Admin
        if (action === 'check_admin') {
            const { data: admin } = await supabase
                .from('admins')
                .select('*')
                .eq('no_wa', phone)
                .single();

            if (!admin) {
                return NextResponse.json({ 
                    success: false, 
                    message: 'Akses Ditolak! Nomor WA ini tidak terdaftar sebagai Admin.' 
                }, { status: 403 });
            }
            return NextResponse.json({ success: true, admin });
        }

        // Aksi B: Verifikasi OTP Login Admin
        if (action === 'verify_admin_otp') {
            const { data: validOtp } = await supabase
                .from('otp_auth')
                .select('*')
                .eq('no_wa', phone)
                .eq('kode_otp', otp)
                .eq('is_used', false)
                .gt('expires_at', new Date().toISOString())
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            if (!validOtp) {
                return NextResponse.json({ success: false, message: 'Kode OTP salah atau kedaluwarsa!' }, { status: 400 });
            }

            await supabase.from('otp_auth').update({ is_used: true }).eq('id', validOtp.id);

            const { data: admin } = await supabase
                .from('admins')
                .select('*')
                .eq('no_wa', phone)
                .single();

            return NextResponse.json({ success: true, admin });
        }

        // Aksi C: Tambah Admin Baru dari Dashboard
        if (action === 'add_admin') {
            const { data, error } = await supabase
                .from('admins')
                .insert({
                    no_wa: new_admin_phone,
                    nama_admin: new_admin_name,
                    role: new_admin_role || 'Admin Verifikator'
                })
                .select()
                .single();

            if (error) throw error;
            return NextResponse.json({ success: true, admin: data });
        }

        return NextResponse.json({ success: false, message: 'Invalid action' }, { status: 400 });
    } catch (error) {
        return NextResponse.json({ success: false, message: error.message }, { status: 500 });
    }
}

// Ambil daftar seluruh admin
export async function GET() {
    try {
        const { data: admins, error } = await supabase
            .from('admins')
            .select('*')
            .order('created_at', { ascending: true });

        if (error) throw error;
        return NextResponse.json({ success: true, admins });
    } catch (error) {
        return NextResponse.json({ success: false, message: error.message }, { status: 500 });
    }
}