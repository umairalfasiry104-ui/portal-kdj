import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(req) {
  try {
    const formData = await req.formData();
    const file = formData.get('file');
    const jenis_dokumen = formData.get('jenis_dokumen'); // 'pasfoto' | 'paspor' | 'ijazah' | 'transkrip' | 'bukti_bayar'
    const no_wa = formData.get('no_wa');

    if (!file || !jenis_dokumen || !no_wa) {
      return NextResponse.json(
        { success: false, message: 'Data tidak lengkap: file, jenis_dokumen, dan no_wa wajib diisi' },
        { status: 400 }
      );
    }

    // 1. Ambil pendaftar_id dan status pendaftar berdasarkan no_wa
    const { data: pendaftar, error: pendaftarError } = await supabase
      .from('pendaftar')
      .select('id, status_pendaftaran')
      .eq('no_wa', no_wa)
      .single();

    if (pendaftarError || !pendaftar) {
      return NextResponse.json(
        { success: false, message: 'Data pendaftar tidak ditemukan' },
        { status: 404 }
      );
    }

    // 2. Beri nama file unik dan rapi di storage
    const fileExt = file.name.split('.').pop();
    const filePath = `${no_wa}/${jenis_dokumen}-${Date.now()}.${fileExt}`;
    const fileBuffer = Buffer.from(await file.arrayBuffer());

    // 3. Upload file ke Supabase Storage (bucket: berkas_kdj)
    const { error: uploadError } = await supabase.storage
      .from('berkas_kdj')
      .upload(filePath, fileBuffer, {
        contentType: file.type,
        upsert: true,
      });

    if (uploadError) throw uploadError;

    // 4. Dapatkan public URL file
    const {
      data: { publicUrl },
    } = supabase.storage.from('berkas_kdj').getPublicUrl(filePath);

    // 5. Penanganan Berdasarkan Jenis Dokumen
    if (jenis_dokumen === 'bukti_bayar') {
      // Jika bukti pembayaran, update langsung kolom di tabel pendaftar
      const { error: updatePayError } = await supabase
        .from('pendaftar')
        .update({
          bukti_bayar_url: publicUrl,
          status_pembayaran: 'Menunggu Verifikasi',
          updated_at: new Date().toISOString(),
        })
        .eq('id', pendaftar.id);

      if (updatePayError) throw updatePayError;

      return NextResponse.json({
        success: true,
        message: 'Bukti pembayaran berhasil diunggah',
        url: publicUrl,
      });
    }

    // Jika dokumen pendaftaran biasa: lakukan UPSERT ke tabel dokumen_pendaftar
    const { data: docRecord, error: docError } = await supabase
      .from('dokumen_pendaftar')
      .upsert(
        {
          pendaftar_id: pendaftar.id,
          jenis_dokumen,
          file_path: publicUrl,
          status_dokumen: 'pending',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'pendaftar_id,jenis_dokumen' }
      )
      .select()
      .single();

    if (docError) throw docError;

    return NextResponse.json({
      success: true,
      message: `Dokumen ${jenis_dokumen} berhasil disimpan`,
      doc: docRecord,
      url: publicUrl,
    });
  } catch (error) {
    console.error('Error upload:', error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}

// Endpoint GET untuk mengambil daftar dokumen yang sudah diunggah
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const no_wa = searchParams.get('no_wa');

    if (!no_wa) {
      return NextResponse.json(
        { success: false, message: 'Parameter no_wa dibutuhkan' },
        { status: 400 }
      );
    }

    const { data: pendaftar } = await supabase
      .from('pendaftar')
      .select('id, bukti_bayar_url, status_pembayaran, status_pendaftaran, catatan_admin, catatan_pembayaran')
      .eq('no_wa', no_wa)
      .single();

    if (!pendaftar) {
      return NextResponse.json({ success: true, documents: [], pendaftar: null });
    }

    const { data: docs } = await supabase
      .from('dokumen_pendaftar')
      .select('*')
      .eq('pendaftar_id', pendaftar.id);

    return NextResponse.json({
      success: true,
      documents: docs || [],
      pendaftar,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}