import { NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAdminSession } from '@/lib/security';

const ALLOWED_JADWAL_STATUS = ['Terjadwal', 'Selesai', 'Batal'];

export async function GET(req) {
    try {
        const authCheck = await requireAdminSession(req);
        if (!authCheck.authorized) {
            return authCheck.response;
        }

        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
            .from('jadwal_konsultasi')
            .select('*')
            .order('jadwal_pilihan', { ascending: false });

        if (error) throw error;
        return NextResponse.json({ success: true, data });
    } catch (error) {
        console.error('[-] Error /api/admin/jadwal GET:', error.message);
        return NextResponse.json(
            { success: false, message: 'Gagal memuat jadwal konsultasi.' },
            { status: 500 }
        );
    }
}

export async function POST(req) {
    try {
        const authCheck = await requireAdminSession(req);
        if (!authCheck.authorized) {
            return authCheck.response;
        }

        const body = await req.json().catch(() => null);
        const { id, status } = body || {};

        if (!id || !ALLOWED_JADWAL_STATUS.includes(status)) {
            return NextResponse.json(
                { success: false, message: 'ID jadwal atau status jadwal tidak valid.' },
                { status: 400 }
            );
        }

        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
            .from('jadwal_konsultasi')
            .update({ status })
            .eq('id', id)
            .select('id')
            .maybeSingle();

        if (error) throw error;
        if (!data) {
            return NextResponse.json(
                { success: false, message: 'Data jadwal tidak ditemukan.' },
                { status: 404 }
            );
        }

        return NextResponse.json({ success: true, message: 'Status jadwal berhasil diperbarui' });
    } catch (error) {
        console.error('[-] Error /api/admin/jadwal POST:', error.message);
        return NextResponse.json(
            { success: false, message: 'Gagal memperbarui jadwal konsultasi.' },
            { status: 500 }
        );
    }
}