import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(req) {
    try {
        const body = await req.json();
        const { 
            no_wa, nama_lengkap, tempat_lahir, tanggal_lahir, 
            jenis_kelamin, no_paspor, alamat_lengkap, asal_sekolah, 
            tahun_lulus, pilihan_kampus, pilihan_jurusan, is_final_submit, is_revision 
        } = body;

        // Tentukan status pendaftaran berdasarkan aksi user
        let statusBaru = 'draft_berkas';
        if (is_final_submit) {
            statusBaru = is_revision ? 'Revisi Diajukan' : 'Submitted';
        }

        const { data, error } = await supabase
            .from('pendaftar')
            .update({
                nama_lengkap,
                tempat_lahir,
                tanggal_lahir: tanggal_lahir || null,
                jenis_kelamin,
                no_paspor,
                alamat_lengkap,
                asal_sekolah,
                tahun_lulus: tahun_lulus ? parseInt(tahun_lulus) : null,
                pilihan_kampus,
                pilihan_jurusan,
                status_pendaftaran: statusBaru,
                updated_at: new Date().toISOString()
            })
            .eq('no_wa', no_wa)
            .select()
            .single();

        if (error) throw error;

        // Trigger Notifikasi WA Otomatis saat pendaftar melakukan final submit / kirim revisi
        if (is_final_submit) {
            try {
                const botUrl = process.env.WA_BOT_API_URL || 'http://localhost:3001';
                await fetch(`${botUrl}/notify-status`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        nomor_wa: no_wa,
                        nama_lengkap: nama_lengkap,
                        status: statusBaru,
                        catatan: is_revision 
                            ? 'Pendaftar telah memperbarui berkas dan bukti pembayaran revisi.' 
                            : `Pendaftaran ke ${pilihan_kampus} (${pilihan_jurusan}) beserta bukti pembayaran telah diterima.`
                    })
                });
            } catch (waErr) {
                console.error('Gagal mengirim notifikasi WA:', waErr.message);
            }
        }

        return NextResponse.json({ success: true, user: data });
    } catch (error) {
        return NextResponse.json({ success: false, message: error.message }, { status: 500 });
    }
}