import { NextResponse } from 'next/server';
import {
  getSupabaseAdmin,
  requireAdminSession,
  hasAdminPermission,
  createSignedStorageUrl,
  callWaBotApi
} from '@/lib/security';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_STATUS_PENDAFTARAN = [
  'Draft',
  'draft_berkas',
  'Submitted',
  'Revisi Diajukan',
  'Approved',
  'Rejected'
];
const VERIFIKATOR_ALLOWED_STATUS_PENDAFTARAN = [
  'Submitted',
  'Revisi Diajukan',
  'Approved',
  'Rejected'
];
const ALLOWED_STATUS_PEMBAYARAN = [
  'Belum Bayar',
  'Menunggu Verifikasi',
  'Lunas',
  'Ditolak'
];
const ACADEMIC_DOC_TYPES = new Set(['pasfoto', 'paspor', 'ijazah', 'transkrip', 'akta_kelahiran']);
const ALLOWED_DOC_STATUSES = new Set(['pending', 'approved', 'rejected']);

function forbidden(message) {
  return NextResponse.json(
    { success: false, code: 'FORBIDDEN_ROLE_PERMISSION', message },
    { status: 403 }
  );
}

function toAdminPendaftarDto(item, { canReadVerification, canReadFinance, signedDocs, signedBukti }) {
  const result = {
    id: item.id,
    no_wa: item.no_wa,
    nama_leads: item.nama_leads ?? null,
    nama_lengkap: item.nama_lengkap ?? null,
    pilihan_kampus: item.pilihan_kampus ?? null,
    pilihan_jurusan: item.pilihan_jurusan ?? null,
    updated_at: item.updated_at ?? null
  };

  if (canReadVerification) {
    Object.assign(result, {
      tempat_lahir: item.tempat_lahir ?? null,
      tanggal_lahir: item.tanggal_lahir ?? null,
      nama_orang_tua_wali: item.nama_orang_tua_wali ?? null,
      no_wa_orang_tua_wali: item.no_wa_orang_tua_wali ?? null,
      jenis_kelamin: item.jenis_kelamin ?? null,
      no_paspor: item.no_paspor ?? null,
      alamat_lengkap: item.alamat_lengkap ?? null,
      asal_sekolah: item.asal_sekolah ?? null,
      tahun_lulus: item.tahun_lulus ?? null,
      status_pendaftaran: item.status_pendaftaran ?? null,
      dokumen_pendaftar: signedDocs,
      catatan_admin: item.catatan_admin ?? ''
    });
  }

  if (canReadFinance) {
    Object.assign(result, {
      status_pembayaran: item.status_pembayaran ?? 'Belum Bayar',
      nominal_tagihan: item.nominal_tagihan ?? null,
      bukti_bayar_url: signedBukti
    });
  }

  return result;
}

export async function GET(req) {
  try {
    const authCheck = await requireAdminSession(req);
    if (!authCheck.authorized) return authCheck.response;

    const role = authCheck.admin.role;
    const canReadVerification = hasAdminPermission(role, 'pendaftar.verification.read');
    const canReadFinance = hasAdminPermission(role, 'pendaftar.finance.read');

    if (!canReadVerification && !canReadFinance) {
      return forbidden('Peran Admin Anda tidak memiliki izin untuk melihat data pendaftar.');
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('pendaftar')
      .select('id, no_wa, nama_leads, nama_lengkap, pilihan_kampus, pilihan_jurusan, updated_at, tempat_lahir, tanggal_lahir, nama_orang_tua_wali, no_wa_orang_tua_wali, jenis_kelamin, no_paspor, alamat_lengkap, asal_sekolah, tahun_lulus, status_pendaftaran, catatan_admin, status_pembayaran, nominal_tagihan, bukti_bayar_url, dokumen_pendaftar (*)')
      .order('updated_at', { ascending: false });

    if (error) throw error;

    const enriched = await Promise.all((data || []).map(async (item) => {
      const signedDocs = canReadVerification
        ? await Promise.all((item.dokumen_pendaftar || [])
            .filter((doc) => ACADEMIC_DOC_TYPES.has(doc.jenis_dokumen))
            .map(async (doc) => ({
              ...doc,
              file_path: await createSignedStorageUrl(supabase, doc.file_path)
            })))
        : [];

      const signedBukti = canReadFinance && item.bukti_bayar_url
        ? await createSignedStorageUrl(supabase, item.bukti_bayar_url)
        : null;

      return toAdminPendaftarDto(item, {
        canReadVerification,
        canReadFinance,
        signedDocs,
        signedBukti
      });
    }));

    return NextResponse.json({ success: true, data: enriched });
  } catch (error) {
    console.error('[-] Error /api/admin/pendaftar GET:', error?.code, error?.message);
    return NextResponse.json(
      { success: false, message: 'Gagal memuat data pendaftar.' },
      { status: 500 }
    );
  }
}

export async function POST(req) {
  try {
    const authCheck = await requireAdminSession(req);
    if (!authCheck.authorized) return authCheck.response;

    const role = authCheck.admin.role;
    const canWriteVerification = hasAdminPermission(role, 'pendaftar.verification.write');
    const canWriteFinance = hasAdminPermission(role, 'pendaftar.finance.write');
    const canWriteAdminNote = hasAdminPermission(role, 'pendaftar.catatan_admin.write');

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json(
        { success: false, message: 'Payload pembaruan tidak valid.' },
        { status: 400 }
      );
    }

    const { pendaftar_id, status_pendaftaran, status_pembayaran, catatan_admin } = body;
    const docUpdates = body.doc_updates === undefined || body.doc_updates === null
      ? []
      : body.doc_updates;

    if (typeof pendaftar_id !== 'string' || !UUID_PATTERN.test(pendaftar_id)) {
      return NextResponse.json(
        { success: false, message: 'ID pendaftar tidak valid.' },
        { status: 400 }
      );
    }

    if (!Array.isArray(docUpdates) || docUpdates.length > 10) {
      return NextResponse.json(
        { success: false, message: 'Daftar pembaruan dokumen tidak valid.' },
        { status: 400 }
      );
    }

    const hasRegistrationChange = status_pendaftaran !== undefined && status_pendaftaran !== null;
    const hasPaymentChange = status_pembayaran !== undefined && status_pembayaran !== null;
    const hasNoteChange = catatan_admin !== undefined && catatan_admin !== null;
    const hasDocumentChanges = docUpdates.length > 0;

    if (!hasRegistrationChange && !hasPaymentChange && !hasNoteChange && !hasDocumentChanges) {
      return NextResponse.json(
        { success: false, code: 'NO_CHANGES', message: 'Tidak ada perubahan yang dikirim.' },
        { status: 400 }
      );
    }

    if ((hasRegistrationChange || hasDocumentChanges) && !canWriteVerification) {
      return forbidden('Peran Admin Anda tidak diizinkan mengubah status pendaftaran atau dokumen akademik.');
    }
    if (hasNoteChange && !canWriteAdminNote) {
      return forbidden('Peran Admin Anda tidak diizinkan mengubah catatan berkas.');
    }
    if (hasPaymentChange && !canWriteFinance) {
      return forbidden('Verifikasi dan perubahan pembayaran hanya dapat dilakukan oleh Super Admin.');
    }

    if (hasRegistrationChange) {
      const allowedStatuses = role === 'Admin Verifikator'
        ? VERIFIKATOR_ALLOWED_STATUS_PENDAFTARAN
        : ALLOWED_STATUS_PENDAFTARAN;
      if (typeof status_pendaftaran !== 'string' || !allowedStatuses.includes(status_pendaftaran)) {
        return NextResponse.json(
          { success: false, message: 'Status pendaftaran tidak valid atau tidak diizinkan untuk role ini.' },
          { status: 400 }
        );
      }
    }

    if (hasPaymentChange && !ALLOWED_STATUS_PEMBAYARAN.includes(status_pembayaran)) {
      return NextResponse.json(
        { success: false, message: 'Status pembayaran tidak valid.' },
        { status: 400 }
      );
    }

    let cleanAdminNote;
    if (hasNoteChange) {
      if (typeof catatan_admin !== 'string' || catatan_admin.length > 2000) {
        return NextResponse.json(
          { success: false, message: 'Catatan berkas harus berupa teks maksimal 2.000 karakter.' },
          { status: 400 }
        );
      }
      cleanAdminNote = catatan_admin.trim();
    }

    const docIds = [];
    const seenDocIds = new Set();
    for (const update of docUpdates) {
      if (
        !update || typeof update !== 'object' || Array.isArray(update) ||
        typeof update.id !== 'string' || !UUID_PATTERN.test(update.id) ||
        !ALLOWED_DOC_STATUSES.has(update.status_dokumen)
      ) {
        return NextResponse.json(
          { success: false, message: 'Item pembaruan dokumen tidak valid.' },
          { status: 400 }
        );
      }
      if (seenDocIds.has(update.id)) {
        return NextResponse.json(
          { success: false, message: 'ID dokumen yang sama tidak boleh dikirim lebih dari satu kali.' },
          { status: 400 }
        );
      }
      seenDocIds.add(update.id);
      docIds.push(update.id);
    }

    const supabase = getSupabaseAdmin();
    const { data: existing, error: findError } = await supabase
      .from('pendaftar')
      .select('id, no_wa, nama_leads, nama_lengkap, status_pendaftaran, status_pembayaran, catatan_admin')
      .eq('id', pendaftar_id)
      .maybeSingle();

    if (findError) throw findError;
    if (!existing) {
      return NextResponse.json(
        { success: false, message: 'Data pendaftar tidak ditemukan.' },
        { status: 404 }
      );
    }

    if (docIds.length > 0) {
      const { data: ownedDocs, error: docLookupError } = await supabase
        .from('dokumen_pendaftar')
        .select('id, jenis_dokumen')
        .eq('pendaftar_id', pendaftar_id)
        .in('id', docIds);

      if (docLookupError) throw docLookupError;
      const ownedAcademicIds = new Set((ownedDocs || [])
        .filter((doc) => ACADEMIC_DOC_TYPES.has(doc.jenis_dokumen))
        .map((doc) => doc.id));
      if (ownedAcademicIds.size !== docIds.length) {
        return NextResponse.json(
          { success: false, message: 'Dokumen tidak ditemukan, bukan milik pendaftar ini, atau bukan dokumen akademik.' },
          { status: 400 }
        );
      }
    }

    const finalStatusRegistration = hasRegistrationChange
      ? status_pendaftaran
      : (existing.status_pendaftaran || 'Submitted');
    const finalStatusPayment = hasPaymentChange
      ? status_pembayaran
      : (existing.status_pembayaran || 'Belum Bayar');
    const finalAdminNote = hasNoteChange
      ? cleanAdminNote
      : (existing.catatan_admin || '');

    const { data: updatedRecord, error: updateError } = await supabase.rpc(
      'kdj_admin_update_pendaftar_with_docs',
      {
        p_pendaftar_id: pendaftar_id,
        p_status_pendaftaran: finalStatusRegistration,
        p_status_pembayaran: finalStatusPayment,
        p_catatan_admin: finalAdminNote,
        p_doc_updates: docUpdates
      }
    );

    if (updateError) {
      if (updateError.code === 'P0002') {
        return NextResponse.json(
          { success: false, message: 'Data pendaftar tidak ditemukan.' },
          { status: 404 }
        );
      }
      if (updateError.code === '22023') {
        return NextResponse.json(
          { success: false, message: 'Status atau data pembaruan dokumen tidak valid.' },
          { status: 400 }
        );
      }
      throw updateError;
    }

    const registrationChanged = finalStatusRegistration !== existing.status_pendaftaran;
    const paymentChanged = finalStatusPayment !== existing.status_pembayaran;
    let waNotified = false;
    let notificationAttempted = false;

    if (registrationChanged || paymentChanged) {
      notificationAttempted = true;
      const paymentOnly = paymentChanged && !registrationChanged;
      const statusLabel = paymentOnly
        ? `PEMBAYARAN ${finalStatusPayment.toUpperCase()}`
        : registrationChanged
          ? `PENDAFTARAN ${finalStatusRegistration.replace('_', ' ').toUpperCase()}`
          : 'STATUS PENDAFTARAN & PEMBAYARAN DIPERBARUI';
      const notificationDetails = [];
      if (registrationChanged) notificationDetails.push(`Status pendaftaran: ${finalStatusRegistration}.`);
      if (paymentChanged) notificationDetails.push(`Status pembayaran: ${finalStatusPayment}.`);
      if (finalAdminNote) notificationDetails.push(`Catatan Admin: ${finalAdminNote}`);

      try {
        const waResult = await callWaBotApi('/notify-status', {
          phone: existing.no_wa,
          name: existing.nama_leads || existing.nama_lengkap || 'Calon Mahasiswa',
          status: statusLabel,
          note: notificationDetails.join(' ').slice(0, 500)
        });
        waNotified = Boolean(waResult?.ok);
      } catch (waError) {
        console.error('[-] Gagal mengirim notifikasi WA dari admin update:', waError?.message);
      }
    }

    return NextResponse.json({
      success: true,
      user: {
        id: updatedRecord?.id || pendaftar_id,
        status_pendaftaran: finalStatusRegistration,
        ...(canReadFinance ? { status_pembayaran: finalStatusPayment } : {}),
        catatan_admin: finalAdminNote
      },
      notification_attempted: notificationAttempted,
      wa_notified: waNotified
    });
  } catch (error) {
    console.error('[-] Error /api/admin/pendaftar POST:', error?.code, error?.message);
    return NextResponse.json(
      { success: false, message: 'Gagal memperbarui data pendaftar.' },
      { status: 500 }
    );
  }
}
