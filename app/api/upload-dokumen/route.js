import { NextResponse } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import {
  getSupabaseAdmin,
  getUserSession,
  requireAdminSession,
  hasAdminPermission,
  normalizePhoneLocal,
  getPhoneCandidates,
  STORAGE_BUCKET,
  createSignedStorageUrl
} from '@/lib/security';

const ALLOWED_DOC_TYPES = ['pasfoto', 'ijazah', 'transkrip', 'akta_kelahiran', 'bukti_bayar'];
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME_MAP = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png'
};

function verifyFileMagicBytes(buffer, mimeType) {
  if (!buffer || buffer.length < 4) return false;
  if (mimeType === 'application/pdf') {
    return buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46; // %PDF
  }
  if (mimeType === 'image/jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff; // JPEG SOI
  }
  if (mimeType === 'image/png') {
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    ); // PNG signature
  }
  return false;
}

export async function POST(req) {
  try {
    const session = await getUserSession(req);
    if (!session) {
      return NextResponse.json(
        { success: false, message: 'Sesi login tidak valid atau telah kedaluwarsa.' },
        { status: 401 }
      );
    }

    const formData = await req.formData();
    const file = formData.get('file');
    const jenis_dokumen = formData.get('jenis_dokumen');
    const requestedPhone = formData.get('no_wa');

    if (!file || !jenis_dokumen) {
      return NextResponse.json(
        { success: false, message: 'Data tidak lengkap: file dan jenis_dokumen wajib diisi.' },
        { status: 400 }
      );
    }

    if (!ALLOWED_DOC_TYPES.includes(jenis_dokumen)) {
      return NextResponse.json(
        { success: false, message: 'Jenis dokumen tidak diizinkan.' },
        { status: 400 }
      );
    }

    const sessionPhone = normalizePhoneLocal(session.no_wa);
    const payloadPhone = requestedPhone ? normalizePhoneLocal(requestedPhone) : sessionPhone;

    if (!sessionPhone || (payloadPhone && payloadPhone !== sessionPhone)) {
      return NextResponse.json(
        { success: false, message: 'Akses ditolak: Anda hanya dapat mengunggah dokumen milik sendiri.' },
        { status: 403 }
      );
    }

    if (typeof file.size !== 'number' || file.size <= 0 || file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { success: false, message: 'Ukuran file harus di antara 1 byte hingga maksimal 5 MB.' },
        { status: 400 }
      );
    }

    const canonicalExt = ALLOWED_MIME_MAP[file.type];
    if (!canonicalExt) {
      return NextResponse.json(
        { success: false, message: 'Format file tidak didukung. Gunakan PDF, JPG, atau PNG.' },
        { status: 400 }
      );
    }

    const ALLOWED_EXTENSIONS = new Set(['pdf', 'jpg', 'jpeg', 'png']);
    const rawFileName = typeof file.name === 'string' ? file.name.trim() : '';
    const extParts = rawFileName.toLowerCase().split('.');
    const originalExt = extParts.length > 1 ? extParts.pop() : '';

    if (!ALLOWED_EXTENSIONS.has(originalExt)) {
      return NextResponse.json(
        { success: false, message: 'Ekstensi file tidak diizinkan. Gunakan file .pdf, .jpg, .jpeg, atau .png.' },
        { status: 400 }
      );
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    if (!verifyFileMagicBytes(fileBuffer, file.type)) {
      return NextResponse.json(
        { success: false, message: 'Isi file tidak sesuai dengan format PDF, JPG, atau PNG yang sah.' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    const {
      data: pendaftar,
      error: pendaftarError
    } = await supabase
      .from('pendaftar')
      .select('id, no_wa, status_pendaftaran, status_pembayaran, bukti_bayar_url')
      .eq('id', session.sub)
      .maybeSingle();

    if (pendaftarError) throw pendaftarError;

    if (!pendaftar) {
      return NextResponse.json(
        { success: false, message: 'Data pendaftar tidak ditemukan.' },
        { status: 404 }
      );
    }

    const normStatus = (pendaftar.status_pendaftaran || '').toLowerCase();
    if (['submitted', 'menunggu verifikasi', 'revisi diajukan', 'approved', 'final_submit'].includes(normStatus)) {
      return NextResponse.json(
        { success: false, message: 'Dokumen tidak dapat diubah karena pendaftaran sedang diverifikasi atau sudah disetujui.' },
        { status: 403 }
      );
    }

    let paymentRecord = null;
    if (jenis_dokumen === 'bukti_bayar') {
      const { data, error } = await supabase
        .from('kdj_registration_payments')
        .select('id, status, deadline_at')
        .eq('pendaftar_id', pendaftar.id)
        .maybeSingle();
      if (error) throw error;
      paymentRecord = data;

      if (!paymentRecord) {
        const canUseLegacyProofRevision =
          pendaftar.status_pembayaran === 'Ditolak'
          && Boolean(pendaftar.bukti_bayar_url);

        if (!canUseLegacyProofRevision) {
          return NextResponse.json(
            { success: false, code: 'PAYMENT_INVOICE_REQUIRED', message: 'Selesaikan submit data awal terlebih dahulu untuk mendapatkan tagihan pembayaran.' },
            { status: 409 }
          );
        }
      }
      if (paymentRecord && !['PENDING_PAYMENT', 'REVISION_REQUIRED', 'REOPENED'].includes(paymentRecord.status)) {
        return NextResponse.json(
          { success: false, code: 'PAYMENT_PROOF_STATE_NOT_ELIGIBLE', message: 'Bukti pembayaran tidak dapat diunggah pada status pembayaran saat ini.' },
          { status: 409 }
        );
      }
      // Deadline authority is PostgreSQL, enforced again inside
      // kdj_record_registration_payment_proof after Storage upload.
      if (paymentRecord && !paymentRecord.deadline_at) {
        return NextResponse.json(
          { success: false, code: 'PAYMENT_DEADLINE_MISSING', message: 'Batas pembayaran belum tersedia. Hubungi Admin.' },
          { status: 409 }
        );
      }
    } else {
      const { data, error } = await supabase
        .from('kdj_registration_payments')
        .select('status')
        .eq('pendaftar_id', pendaftar.id)
        .maybeSingle();
      if (error) throw error;

      const paymentIsPaid = data
        ? data.status === 'PAID'
        : pendaftar.status_pembayaran === 'Lunas';

      if (!paymentIsPaid) {
        return NextResponse.json(
          { success: false, code: 'PAYMENT_NOT_PAID', message: 'Upload berkas akademik baru dapat dilakukan setelah pembayaran dikonfirmasi Lunas oleh Admin.' },
          { status: 403 }
        );
      }
    }

    const safeObjectPath = `${sessionPhone}/${jenis_dokumen}-${randomUUID()}.${canonicalExt}`;

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(safeObjectPath, fileBuffer, {
        contentType: file.type,
        upsert: true
      });

    if (uploadError) throw uploadError;

    let signedUrl;
    try {
      signedUrl = await createSignedStorageUrl(supabase, safeObjectPath);
    } catch (signError) {
      const { error: cleanupError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .remove([safeObjectPath]);

      if (cleanupError) {
        console.error('[-] Gagal membersihkan file setelah signing gagal:', cleanupError.message);
      }
      throw signError;
    }

    if (jenis_dokumen === 'bukti_bayar') {
      if (paymentRecord) {
        const sha256 = createHash('sha256').update(fileBuffer).digest('hex');
        const { data: proofResult, error: proofError } = await supabase.rpc(
          'kdj_record_registration_payment_proof',
          {
            p_pendaftar_id: pendaftar.id,
            p_object_path: safeObjectPath,
            p_original_filename: rawFileName.slice(0, 255),
            p_mime_type: file.type,
            p_size_bytes: file.size,
            p_sha256: sha256
          }
        );

        if (proofError || proofResult?.success !== true) {
          const { error: cleanupError } = await supabase.storage
            .from(STORAGE_BUCKET)
            .remove([safeObjectPath]);
          if (cleanupError) {
            console.error('[-] Gagal membersihkan bukti setelah RPC pembayaran gagal:', cleanupError.message);
          }
          if (proofError) throw proofError;
          return NextResponse.json(
            { success: false, message: 'Bukti pembayaran belum dapat dicatat. Silakan coba kembali.' },
            { status: 409 }
          );
        }

        return NextResponse.json({
          success: true,
          message: 'Bukti pembayaran berhasil diunggah dan menunggu pemeriksaan Admin.',
          url: signedUrl,
          payment: proofResult
        });
      }

      // Compatibility path for pre-ledger applicants whose rejected proof
      // already exists in the legacy payment columns.
      const { error: legacyUpdateError } = await supabase
        .from('pendaftar')
        .update({
          bukti_bayar_url: safeObjectPath,
          status_pembayaran: 'Menunggu Verifikasi',
          catatan_pembayaran: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', pendaftar.id)
        .eq('no_wa', sessionPhone);

      if (legacyUpdateError) {
        const { error: cleanupError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .remove([safeObjectPath]);
        if (cleanupError) {
          console.error('[-] Gagal membersihkan bukti legacy setelah update gagal:', cleanupError.message);
        }
        throw legacyUpdateError;
      }

      return NextResponse.json({
        success: true,
        message: 'Bukti pembayaran legacy berhasil diperbarui dan menunggu pemeriksaan Admin.',
        url: signedUrl,
        legacy_payment: true
      });
    }

    const { data: docRecord, error: docError } = await supabase
      .from('dokumen_pendaftar')
      .upsert(
        {
          pendaftar_id: pendaftar.id,
          no_wa: sessionPhone,
          jenis_dokumen,
          file_path: safeObjectPath,
          status_dokumen: 'pending',
          updated_at: new Date().toISOString()
        },
        { onConflict: 'pendaftar_id,jenis_dokumen' }
      )
      .select('*')
      .single();

    if (docError) {
      await supabase.storage.from(STORAGE_BUCKET).remove([safeObjectPath]);
      throw docError;
    }

    return NextResponse.json({
      success: true,
      message: `Dokumen ${jenis_dokumen} berhasil disimpan`,
      doc: {
        ...docRecord,
        file_path: signedUrl
      },
      url: signedUrl
    });
  } catch (error) {
    console.error('[-] Error upload-dokumen POST:', error.message);
    return NextResponse.json(
      { success: false, message: 'Gagal mengunggah dokumen.' },
      { status: 500 }
    );
  }
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const requestedPhone = searchParams.get('no_wa');

    const userSession = await getUserSession(req);
    let targetPhone = null;
    let adminRole = null;

    if (userSession) {
      const sessionPhone = normalizePhoneLocal(userSession.no_wa);
      const queryPhone = requestedPhone ? normalizePhoneLocal(requestedPhone) : sessionPhone;
      if (!sessionPhone || (queryPhone && queryPhone !== sessionPhone)) {
        return NextResponse.json(
          { success: false, message: 'Akses ditolak: tidak dapat melihat dokumen pengguna lain.' },
          { status: 403 }
        );
      }
      targetPhone = sessionPhone;
    } else {
      const adminCheck = await requireAdminSession(req);
      if (!adminCheck.authorized) return adminCheck.response;
      adminRole = adminCheck.admin.role;
      const canReadAcademic = hasAdminPermission(adminRole, 'dokumen.academic.read');
      const canReadPayment = hasAdminPermission(adminRole, 'dokumen.payment_proof.read');
      if (!canReadAcademic && !canReadPayment) {
        return NextResponse.json(
          { success: false, code: 'FORBIDDEN_ROLE_PERMISSION', message: 'Peran Admin Anda tidak memiliki izin untuk melihat dokumen.' },
          { status: 403 }
        );
      }
      targetPhone = normalizePhoneLocal(requestedPhone);
      if (!targetPhone) {
        return NextResponse.json(
          { success: false, message: 'Parameter no_wa yang valid dibutuhkan.' },
          { status: 400 }
        );
      }
    }

    const supabase = getSupabaseAdmin();
    const pendaftarColumns = userSession
      ? 'id, no_wa, bukti_bayar_url, status_pembayaran, status_pendaftaran, catatan_admin, nama_orang_tua_wali, no_wa_orang_tua_wali'
      : 'id, no_wa, bukti_bayar_url, status_pembayaran, status_pendaftaran, catatan_admin';
    let pendaftarQuery = supabase
      .from('pendaftar')
      .select(pendaftarColumns);

    if (userSession) {
      pendaftarQuery = pendaftarQuery.eq('id', userSession.sub);
    } else {
      pendaftarQuery = pendaftarQuery.in('no_wa', getPhoneCandidates(targetPhone));
    }

    const { data: pendaftar, error: pendaftarError } = await pendaftarQuery.maybeSingle();
    if (pendaftarError) throw pendaftarError;
    if (!pendaftar) {
      return NextResponse.json({ success: false, message: 'Data pendaftar tidak ditemukan.' }, { status: 404 });
    }

    let registrationPayment = null;
    if (userSession) {
      const { data: paymentRow, error: paymentReadError } = await supabase
        .from('kdj_registration_payments')
        .select('id, invoice_ref, amount_idr, currency, status, initial_submission_at, deadline_at, paid_at')
        .eq('pendaftar_id', pendaftar.id)
        .maybeSingle();
      if (paymentReadError) throw paymentReadError;

      registrationPayment = paymentRow || (
        pendaftar.status_pembayaran === 'Lunas'
          ? { status: 'PAID', amount_idr: pendaftar.nominal_tagihan || 1500000, legacy: true }
          : null
      );
    }

    const { data: docs, error: docsError } = await supabase
      .from('dokumen_pendaftar')
      .select('*')
      .eq('pendaftar_id', pendaftar.id);
    if (docsError) throw docsError;

    let signedBuktiUrl = null;
    const canAccessPayment = userSession || hasAdminPermission(adminRole, 'dokumen.payment_proof.read');
    if (pendaftar.bukti_bayar_url && canAccessPayment) {
      signedBuktiUrl = await createSignedStorageUrl(supabase, pendaftar.bukti_bayar_url);
    }

    const signedDocs = [];
    const canAccessAcademic = userSession || hasAdminPermission(adminRole, 'dokumen.academic.read');
    for (const d of (docs || [])) {
      let url = null;
      const isAkademik = ['pasfoto', 'paspor', 'ijazah', 'transkrip', 'akta_kelahiran'].includes(d.jenis_dokumen);
      if (canAccessAcademic && isAkademik) {
        url = await createSignedStorageUrl(supabase, d.file_path);
      }
      signedDocs.push({ ...d, file_path: url });
    }

    let studentProgress = null;
    let studentProgressDocuments = [];
    if (userSession && pendaftar.status_pendaftaran === 'Approved') {
      const { data: progressRow, error: progressError } = await supabase
        .from('kdj_student_progress')
        .select('pendaftar_id, progress_status, created_at, updated_at')
        .eq('pendaftar_id', pendaftar.id)
        .maybeSingle();
      if (progressError) throw progressError;
      studentProgress = progressRow;

      const { data: progressRows, error: progressDocsError } = await supabase
        .from('kdj_student_progress_documents')
        .select('id, document_type, version_no, original_filename, mime_type, size_bytes, uploaded_at, note, object_path')
        .eq('pendaftar_id', pendaftar.id)
        .eq('is_current', true)
        .order('document_type', { ascending: true });
      if (progressDocsError) throw progressDocsError;

      studentProgressDocuments = await Promise.all((progressRows || []).map(async (document) => ({
        id: document.id,
        document_type: document.document_type,
        version_no: document.version_no,
        original_filename: document.original_filename,
        mime_type: document.mime_type,
        size_bytes: document.size_bytes,
        uploaded_at: document.uploaded_at,
        note: document.note,
        download_url: await createSignedStorageUrl(supabase, document.object_path)
      })));
    }

    const projectedPendaftar = userSession
      ? { ...pendaftar, bukti_bayar_url: signedBuktiUrl }
      : {
          id: pendaftar.id,
          no_wa: pendaftar.no_wa,
          ...(canAccessAcademic ? {
            status_pendaftaran: pendaftar.status_pendaftaran,
            catatan_admin: pendaftar.catatan_admin
          } : {}),
          ...(canAccessPayment ? {
            status_pembayaran: pendaftar.status_pembayaran,
            bukti_bayar_url: signedBuktiUrl
          } : {})
        };

    return NextResponse.json({
      success: true,
      documents: signedDocs.filter((document) => document.file_path !== null),
      pendaftar: projectedPendaftar,
      ...(userSession ? {
        registration_payment: registrationPayment,
        server_now: new Date().toISOString(),
        student_progress: studentProgress,
        student_progress_documents: studentProgressDocuments
      } : {})
    });
  } catch (error) {
    console.error('[-] Error upload-dokumen GET:', error.message);
    return NextResponse.json({ success: false, message: 'Gagal memuat dokumen pendaftar.' }, { status: 500 });
  }
}