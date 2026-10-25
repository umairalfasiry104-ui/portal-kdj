import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 1. Ambil semua data pendaftar beserta berkasnya
export async function GET() {
    try {
        const { data: pendaftar, error } = await supabase
            .from('pendaftar')
            .select(`
                *,
                dokumen_pendaftar (*)
            `)
            .order('updated_at', { ascending: false });

        if (error) throw error;
        return NextResponse.json({ success: true, data: pendaftar });
    } catch (error) {
        return NextResponse.json({ success: false, message: error.message }, { status: 500 });
    }
}

// 2. Update status pendaftaran, pembayaran / berkas & tembak Notifikasi WA
export async function POST(req) {
    try {
        const { 
            pendaftar_id, 
            no_wa, 
            nama_lengkap, 
            status_pendaftaran, 
            status_pembayaran, // <-- Ditambahkan di sini
            catatan_admin, 
            doc_updates 
        } = await req.json();

        // Update status tiap dokumen jika diubah oleh admin
        if (doc_updates && doc_updates.length > 0) {
            for (const doc of doc_updates) {
                await supabase
                    .from('dokumen_pendaftar')
                    .update({ status_dokumen: doc.status_dokumen })
                    .eq('id', doc.id);
            }
        }

        // Update status utama pendaftar dan status pembayaran
        const { data: updatedUser, error } = await supabase
            .from('pendaftar')
            .update({
                status_pendaftaran,
                status_pembayaran, // <-- Disertakan ke database
                catatan_admin,     // <-- Disertakan juga agar catatan tersimpan
                updated_at: new Date().toISOString()
            })
            .eq('id', pendaftar_id)
            .select()
            .single();

        if (error) throw error;

        // Tembak Notifikasi WA otomatis ke calon mahasiswa
        const readableStatus = status_pendaftaran.replace('_', ' ').toUpperCase();
        await fetch(`${process.env.WA_BOT_API_URL}/notify-status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phone: no_wa,
                name: nama_lengkap,
                status: readableStatus,
                note: catatan_admin || ''
            })
        });

        return NextResponse.json({ success: true, user: updatedUser });
    } catch (error) {
        return NextResponse.json({ success: false, message: error.message }, { status: 500 });
    }
}