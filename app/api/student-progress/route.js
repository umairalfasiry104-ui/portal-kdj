import { NextResponse } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import {
    createSignedStorageUrl,
    getSupabaseAdmin,
    getUserSession,
    requireAdminSession,
    STORAGE_BUCKET
} from '@/lib/security';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const DOCUMENT_TYPES = Object.freeze({
    SUKETMAH: { extension: 'pdf', mime: 'application/pdf' },
    LOA: { extension: 'pdf', mime: 'application/pdf' },
    VISA: { extension: 'pdf', mime: 'application/pdf' },
    TICKET: { extension: 'pdf', mime: 'application/pdf' }
});

function hasValidMagicBytes(buffer, mimeType) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false;

    if (mimeType === 'application/pdf') {
        return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
    }

    if (mimeType === 'image/png') {
        return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    }

    if (mimeType === 'image/jpeg') {
        return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    }

    return false;
}

async function getAdminContext(req) {
    const result = await requireAdminSession(req);
    if (result?.authorized) {
        if (result.admin?.role !== 'Super Admin') {
            return {
                response: NextResponse.json(
                    { success: false, message: 'Akses progres mahasiswa hanya tersedia untuk Super Admin.' },
                    { status: 403 }
                )
            };
        }
        return { admin: result.admin };
    }
    return {};
}

export async function GET(req) {
    try {
        const supabase = getSupabaseAdmin();
        const adminContext = await getAdminContext(req);

        if (adminContext.response) return adminContext.response;

        let pendaftarId = null;
        if (adminContext.admin) {
            const { searchParams } = new URL(req.url);
            pendaftarId = searchParams.get('pendaftar_id');
        } else {
            const session = await getUserSession(req);
            if (!session?.sub) {
                return NextResponse.json(
                    { success: false, message: 'Sesi pendaftar tidak valid.' },
                    { status: 401 }
                );
            }
            pendaftarId = session.sub;
        }

        if (!UUID_PATTERN.test(String(pendaftarId || ''))) {
            return NextResponse.json(
                { success: false, message: 'ID pendaftar tidak valid.' },
                { status: 400 }
            );
        }

        const { data: applicant, error: applicantError } = await supabase
            .from('pendaftar')
            .select('id, status_pendaftaran')
            .eq('id', pendaftarId)
            .maybeSingle();

        if (applicantError) throw applicantError;
        if (!applicant) {
            return NextResponse.json(
                { success: false, message: 'Data pendaftar tidak ditemukan.' },
                { status: 404 }
            );
        }
        if (applicant.status_pendaftaran !== 'Approved') {
            return NextResponse.json({
                success: true,
                progress: null,
                documents: [],
                message: 'Progres lanjutan tersedia setelah berkas akademik disetujui.'
            });
        }

        const { data: progress, error: progressError } = await supabase
            .from('kdj_student_progress')
            .select('pendaftar_id, progress_status, created_at, updated_at')
            .eq('pendaftar_id', pendaftarId)
            .maybeSingle();

        if (progressError) throw progressError;

        // Ambil status pembayaran paket keberangkatan
        const { data: departureOrder } = await supabase
            .from('kdj_departure_orders')
            .select('payment_status, total_amount_idr, paid_amount_idr, remaining_amount_idr')
            .eq('pendaftar_id', pendaftarId)
            .maybeSingle();

        const isPackagePaid = departureOrder?.payment_status === 'PAID';

        const { data: documents, error: documentsError } = await supabase
            .from('kdj_student_progress_documents')
            .select('id, pendaftar_id, document_type, version_no, object_path, original_filename, mime_type, size_bytes, uploaded_at, note')
            .eq('pendaftar_id', pendaftarId)
            .eq('is_current', true)
            .order('document_type', { ascending: true });

        if (documentsError) throw documentsError;

        const signedDocuments = await Promise.all((documents || []).map(async (document) => {
            // Smart Gating: Jika viewer adalah Calon Mahasiswa dan paket belum LUNAS 100%,
            // Suketmah dan LOA ditandai tersedia tapi download_url tidak diberikan (download_locked).
            const isDownloadLocked = !adminContext.admin && !isPackagePaid;
            const downloadUrl = isDownloadLocked
                ? null
                : await createSignedStorageUrl(supabase, document.object_path);

            return {
                id: document.id,
                pendaftar_id: document.pendaftar_id,
                document_type: document.document_type,
                version_no: document.version_no,
                original_filename: document.original_filename,
                mime_type: document.mime_type,
                size_bytes: document.size_bytes,
                uploaded_at: document.uploaded_at,
                note: document.note,
                download_locked: isDownloadLocked,
                lock_reason: isDownloadLocked ? 'Dokumen dapat diunduh setelah pembayaran paket keberangkatan LUNAS 100%.' : null,
                download_url: downloadUrl
            };
        }));

        return NextResponse.json({
            success: true,
            progress,
            documents: signedDocuments,
            departure_payment: {
                is_paid: isPackagePaid,
                status: departureOrder?.payment_status || 'UNPAID',
                paid_amount_idr: departureOrder?.paid_amount_idr || 0,
                remaining_amount_idr: departureOrder?.remaining_amount_idr || 0
            }
        });
    } catch (error) {
        console.error('[-] Error /api/student-progress GET:', error?.code, error?.message);
        return NextResponse.json(
            { success: false, message: 'Gagal memuat progres mahasiswa.' },
            { status: 500 }
        );
    }
}

export async function POST(req) {
    let uploadedObjectPath = null;

    try {
        const adminContext = await getAdminContext(req);
        if (adminContext.response) return adminContext.response;
        if (!adminContext.admin?.id) {
            return NextResponse.json(
                { success: false, message: 'Sesi Super Admin tidak valid.' },
                { status: 401 }
            );
        }

        const supabase = getSupabaseAdmin();
        const contentType = req.headers.get('content-type') || '';

        if (contentType.includes('application/json')) {
            const body = await req.json().catch(() => null);
            if (
                !body ||
                typeof body !== 'object' ||
                body.action !== 'transition' ||
                typeof body.pendaftar_id !== 'string' ||
                !UUID_PATTERN.test(body.pendaftar_id) ||
                typeof body.progress_status !== 'string' ||
                typeof body.reason !== 'string' ||
                body.reason.trim().length < 3 ||
                body.reason.length > 1000
            ) {
                return NextResponse.json(
                    { success: false, message: 'Data transisi progres tidak valid.' },
                    { status: 400 }
                );
            }

            const { data, error } = await supabase.rpc(
                'kdj_admin_transition_student_progress',
                {
                    p_pendaftar_id: body.pendaftar_id,
                    p_new_status: body.progress_status,
                    p_reason: body.reason.trim(),
                    p_actor_admin_id: adminContext.admin.id
                }
            );

            if (error) {
                if (error.code === '42501') {
                    return NextResponse.json({ success: false, message: 'Akses perubahan progres ditolak.' }, { status: 403 });
                }
                if (error.code === '22023') {
                    return NextResponse.json({ success: false, message: error.message }, { status: 409 });
                }
                if (error.code === 'P0002') {
                    return NextResponse.json({ success: false, message: 'Data pendaftar/progres tidak ditemukan.' }, { status: 404 });
                }
                throw error;
            }

            return NextResponse.json({ success: true, progress: data });
        }

        const formData = await req.formData();
        const pendaftarId = formData.get('pendaftar_id');
        const documentType = String(formData.get('document_type') || '').toUpperCase();
        const note = String(formData.get('note') || '').trim();
        const file = formData.get('file');

        if (
            typeof pendaftarId !== 'string' ||
            !UUID_PATTERN.test(pendaftarId) ||
            !Object.hasOwn(DOCUMENT_TYPES, documentType) ||
            !(file instanceof File) ||
            file.size < 1 ||
            file.size > MAX_FILE_SIZE ||
            file.type !== 'application/pdf' ||
            note.length > 1000
        ) {
            return NextResponse.json(
                { success: false, message: 'Jenis dokumen, ukuran, tipe file, atau data pendaftar tidak valid.' },
                { status: 400 }
            );
        }

        const { data: applicant, error: applicantError } = await supabase
            .from('pendaftar')
            .select('id, status_pendaftaran')
            .eq('id', pendaftarId)
            .maybeSingle();

        if (applicantError) throw applicantError;
        if (!applicant || applicant.status_pendaftaran !== 'Approved') {
            return NextResponse.json(
                { success: false, message: 'Dokumen lanjutan hanya dapat diunggah untuk pendaftar berstatus Approved.' },
                { status: 409 }
            );
        }

        // Smart Gating: Visa dan Tiket baru bisa diproses/diunggah Admin jika paket sudah LUNAS 100%
        if (['VISA', 'TICKET'].includes(documentType)) {
            const { data: departureOrder } = await supabase
                .from('kdj_departure_orders')
                .select('payment_status')
                .eq('pendaftar_id', pendaftarId)
                .maybeSingle();

            if (departureOrder?.payment_status !== 'PAID') {
                return NextResponse.json(
                    {
                        success: false,
                        message: `Dokumen ${documentType === 'VISA' ? 'Visa' : 'Tiket Pesawat'} hanya dapat diunggah setelah calon mahasiswa melunasi paket keberangkatan 100%.`
                    },
                    { status: 409 }
                );
            }
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        if (!hasValidMagicBytes(buffer, file.type)) {
            return NextResponse.json(
                { success: false, message: 'Isi file tidak sesuai dengan deklarasi PDF.' },
                { status: 415 }
            );
        }

        const extension = DOCUMENT_TYPES[documentType].extension;
        uploadedObjectPath = `progress/${pendaftarId}/${documentType.toLowerCase()}/${randomUUID()}.${extension}`;
        const sha256 = createHash('sha256').update(buffer).digest('hex');

        const { error: storageError } = await supabase.storage
            .from(STORAGE_BUCKET)
            .upload(uploadedObjectPath, buffer, {
                contentType: file.type,
                cacheControl: '3600',
                upsert: false
            });

        if (storageError) throw storageError;

        const { data, error } = await supabase.rpc(
            'kdj_admin_record_student_progress_document',
            {
                p_pendaftar_id: pendaftarId,
                p_document_type: documentType,
                p_object_path: uploadedObjectPath,
                p_original_filename: String(file.name || `${documentType}.${extension}`).slice(0, 255),
                p_mime_type: file.type,
                p_size_bytes: file.size,
                p_sha256: sha256,
                p_actor_admin_id: adminContext.admin.id,
                p_note: note || null
            }
        );

        if (error || data?.success !== true) {
            const { error: cleanupError } = await supabase.storage
                .from(STORAGE_BUCKET)
                .remove([uploadedObjectPath]);
            if (cleanupError) {
                console.error('[-] Failed to clean orphaned student progress document:', cleanupError.message);
            }
            uploadedObjectPath = null;
            if (error) {
                if (error.code === '42501') {
                    return NextResponse.json({ success: false, message: 'Akses upload dokumen progres ditolak.' }, { status: 403 });
                }
                if (error.code === '22023') {
                    return NextResponse.json({ success: false, message: 'Status atau dokumen progres tidak valid.' }, { status: 409 });
                }
                throw error;
            }
            return NextResponse.json(
                { success: false, message: 'Metadata dokumen belum berhasil disimpan.' },
                { status: 409 }
            );
        }

        uploadedObjectPath = null;
        return NextResponse.json({ success: true, document: data });
    } catch (error) {
        if (uploadedObjectPath) {
            try {
                const supabase = getSupabaseAdmin();
                await supabase.storage.from(STORAGE_BUCKET).remove([uploadedObjectPath]);
            } catch (cleanupError) {
                console.error('[-] Student progress orphan cleanup failed:', cleanupError?.message);
            }
        }
        console.error('[-] Error /api/student-progress POST:', error?.code, error?.message);
        return NextResponse.json(
            { success: false, message: 'Gagal menyimpan dokumen atau progres mahasiswa.' },
            { status: 500 }
        );
    }
}
