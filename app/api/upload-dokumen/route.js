import { NextResponse } from 'next/server';
import {
    getSupabaseAdmin,
    getUserSession,
    requireAdminSession,
    normalizePhoneLocal,
    getPhoneCandidates,
    STORAGE_BUCKET,
    createSignedStorageUrl
} from '@/lib/security';

const ALLOWED_DOC_TYPES = ['pasfoto', 'paspor', 'ijazah', 'transkrip', 'bukti_bayar'];
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
        // 1. Wajib memiliki sesi pengguna yang sah (ACT-01 & ACT-03)
        const session = getUserSession(req);
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

        // Tolak jika pengguna mencoba mengunggah berkas ke nomor milik orang lain (T-11)
        if (!sessionPhone || (payloadPhone && payloadPhone !== sessionPhone)) {
            return NextResponse.json(
                { success: false, message: 'Akses ditolak: Anda hanya dapat mengunggah dokumen milik sendiri.' },
                { status: 403 }
            );
        }

        // Validasi ukuran dan tipe MIME sebelum membaca seluruh stream ke memori (T-12)
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

        // Di dalam POST(req) sebelum file.arrayBuffer():
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
        const candidates = getPhoneCandidates(sessionPhone);

        const { data: pendaftar, error: pendaftarError } = await supabase
            .from('pendaftar')
            .select('id, no_wa, status_pendaftaran')
            .in('no_wa', candidates)
            .maybeSingle();

        if (pendaftarError || !pendaftar) {
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

        // Gunakan object key yang aman dan deterministik di bawah pendaftar.id
        const safeObjectPath = `${sessionPhone}/${jenis_dokumen}-${Date.now()}.${canonicalExt}`;

        const { error: uploadError } = await supabase.storage
            .from(STORAGE_BUCKET)
            .upload(safeObjectPath, fileBuffer, {
                contentType: file.type,
                upsert: true
            });

        if (uploadError) throw uploadError;

        let signedUrl;

try {
    signedUrl = await createSignedStorageUrl(
        supabase,
        safeObjectPath
    );
} catch (signError) {
    // Signing gagal setelah upload; coba hapus file agar tidak yatim.
    const { error: cleanupError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .remove([safeObjectPath]);

    if (cleanupError) {
        console.error(
            '[-] Gagal membersihkan file setelah signing gagal:',
            cleanupError.message
        );
    }

    throw signError;
        }

        if (jenis_dokumen === 'bukti_bayar') {
            const { error: updatePayError } = await supabase
                .from('pendaftar')
                .update({
                    bukti_bayar_url: safeObjectPath,
                    status_pembayaran: 'Menunggu Verifikasi',
                    updated_at: new Date().toISOString()
                })
                .eq('id', pendaftar.id);

            if (updatePayError) {
                // Rollback kompensasi: hapus file di Storage jika update DB gagal (T-17)
                await supabase.storage.from(STORAGE_BUCKET).remove([safeObjectPath]);
                throw updatePayError;
            }

            return NextResponse.json({
                success: true,
                message: 'Bukti pembayaran berhasil diunggah',
                url: signedUrl
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

        // Verifikasi ownership: harus pemilik sesi pengguna atau Admin aktif (ACT-03 / T-11)
        const userSession = getUserSession(req);
        let targetPhone = null;

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
            if (!adminCheck.authorized) {
                return NextResponse.json(
                    { success: false, message: 'Autentikasi diperlukan.' },
                    { status: 401 }
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
        const candidates = getPhoneCandidates(targetPhone);

        const {
            data: pendaftar,
            error: pendaftarError
            } = await supabase
            .from('pendaftar')
            .select(
            'id, no_wa, bukti_bayar_url, status_pembayaran, status_pendaftaran, catatan_admin, catatan_pembayaran'
            )
        .in('no_wa', candidates)
        .maybeSingle();

        if (pendaftarError) {
            throw pendaftarError;
}

        const {
                data: docs,
                error: docsError
        } = await supabase
                .from('dokumen_pendaftar')
                .select('*')
                .eq('pendaftar_id', pendaftar.id);

            if (docsError) {
                throw docsError;
        }
        const signedBuktiUrl = pendaftar.bukti_bayar_url
            ? await createSignedStorageUrl(supabase, pendaftar.bukti_bayar_url)
            : null;

        const signedDocs = await Promise.all(
            (docs || []).map(async (d) => ({
                ...d,
                file_path: await createSignedStorageUrl(supabase, d.file_path)
            }))
        );

        return NextResponse.json({
            success: true,
            documents: signedDocs,
            pendaftar: {
                ...pendaftar,
                bukti_bayar_url: signedBuktiUrl
            }
        });
    } catch (error) {
        console.error('[-] Error upload-dokumen GET:', error.message);
        return NextResponse.json(
            { success: false, message: 'Gagal memuat dokumen pendaftar.' },
            { status: 500 }
        );
    }
}