import { NextResponse } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import {
    createSignedStorageUrl,
    getSupabaseAdmin,
    getUserSession,
    requireAdminSession,
    STORAGE_BUCKET,
    callWaBotApi
} from '@/lib/security';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

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

// GET: Ambil daftar paket, pesanan aktif santri, dan riwayat cicilan
export async function GET(req) {
    try {
        const supabase = getSupabaseAdmin();
        const adminAuth = await requireAdminSession(req);
        let pendaftarId = null;

        if (adminAuth.authorized) {
            const { searchParams } = new URL(req.url);
            pendaftarId = searchParams.get('pendaftar_id');
        } else {
            const session = await getUserSession(req);
            if (!session?.sub) {
                return NextResponse.json({ success: false, message: 'Sesi tidak valid.' }, { status: 401 });
            }
            pendaftarId = session.sub;
        }

        if (pendaftarId && !UUID_PATTERN.test(pendaftarId)) {
            return NextResponse.json({ success: false, message: 'ID pendaftar tidak valid.' }, { status: 400 });
        }

        // 1. Ambil seluruh paket yang aktif
        const { data: packages, error: pkgErr } = await supabase
            .from('kdj_departure_packages')
            .select('id, name, base_price_idr, description, includes_ticket_visa')
            .eq('is_active', true)
            .order('base_price_idr', { ascending: true });

        if (pkgErr) throw pkgErr;

        if (!pendaftarId) {
            return NextResponse.json({ success: true, packages, order: null, installments: [] });
        }

        // 2. Ambil pesanan pendaftar jika ada
        const { data: order, error: orderErr } = await supabase
            .from('kdj_departure_orders')
            .select('*')
            .eq('pendaftar_id', pendaftarId)
            .maybeSingle();

        if (orderErr) throw orderErr;

        let installments = [];
        if (order) {
            const { data: instData, error: instErr } = await supabase
                .from('kdj_departure_installments')
                .select('*')
                .eq('order_id', order.id)
                .order('installment_no', { ascending: false });

            if (instErr) throw instErr;

            installments = await Promise.all((instData || []).map(async (inst) => ({
                id: inst.id,
                installment_no: inst.installment_no,
                amount_idr: inst.amount_idr,
                status: inst.status,
                original_filename: inst.original_filename,
                submitted_at: inst.submitted_at,
                verified_at: inst.verified_at,
                rejection_reason: inst.rejection_reason,
                receipt_url: await createSignedStorageUrl(supabase, inst.object_path)
            })));
        }

        return NextResponse.json({
            success: true,
            packages: packages || [],
            order: order || null,
            installments
        });
    } catch (error) {
        console.error('[-] Error GET /api/departure-payments:', error.message);
        return NextResponse.json({ success: false, message: 'Gagal mengambil data paket keberangkatan.' }, { status: 500 });
    }
}

// POST: Aksi Santri (Pilih Paket ATAU Upload Bukti Cicilan)
export async function POST(req) {
    const session = await getUserSession(req);
    if (!session?.sub) {
        return NextResponse.json({ success: false, message: 'Sesi santri tidak valid.' }, { status: 401 });
    }

    const pendaftarId = session.sub;
    const contentType = req.headers.get('content-type') || '';
    const supabase = getSupabaseAdmin();

    // 1. Aksi JSON: Pilih / Ganti Paket
    if (contentType.includes('application/json')) {
        try {
            const body = await req.json();
            const { package_id } = body;

            if (!package_id || typeof package_id !== 'string') {
                return NextResponse.json({ success: false, message: 'Paket yang dipilih tidak valid.' }, { status: 400 });
            }

            const { data, error } = await supabase.rpc('kdj_select_departure_package', {
                p_pendaftar_id: pendaftarId,
                p_package_id: package_id
            });

            if (error) {
                console.error('[-] Error kdj_select_departure_package RPC:', error);
                if (error.code === '22023') {
                    return NextResponse.json({ success: false, message: error.message }, { status: 409 });
                }
                throw error;
            }

            return NextResponse.json({ success: true, order: data?.order });
        } catch (error) {
            console.error('[-] Error select departure package:', error.message);
            return NextResponse.json({ success: false, message: error.message || 'Gagal memilih paket.' }, { status: 500 });
        }
    }

    // 2. Aksi FormData: Unggah Bukti Bayar Cicilan
    if (contentType.includes('multipart/form-data')) {
        let uploadedObjectPath = null;
        try {
            const formData = await req.formData();
            const amountIdr = Number(formData.get('amount_idr'));
            const file = formData.get('file');

            if (!amountIdr || !Number.isSafeInteger(amountIdr) || amountIdr <= 0) {
                return NextResponse.json({ success: false, message: 'Nominal pembayaran cicilan tidak valid.' }, { status: 400 });
            }

            if (
                !(file instanceof File) ||
                file.size < 1 ||
                file.size > MAX_FILE_SIZE ||
                !['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)
            ) {
                return NextResponse.json({ success: false, message: 'File bukti pembayaran harus berupa PDF/JPG/PNG maks. 5 MB.' }, { status: 400 });
            }

            const buffer = Buffer.from(await file.arrayBuffer());
            if (!hasValidMagicBytes(buffer, file.type)) {
                return NextResponse.json({ success: false, message: 'Isi file bukti transfer tidak valid atau rusak.' }, { status: 415 });
            }

            const ext = file.type === 'application/pdf' ? 'pdf' : file.type === 'image/png' ? 'png' : 'jpg';
            uploadedObjectPath = `departure-payments/${pendaftarId}/${randomUUID()}.${ext}`;
            const sha256 = createHash('sha256').update(buffer).digest('hex');

            const { error: storageError } = await supabase.storage
                .from(STORAGE_BUCKET)
                .upload(uploadedObjectPath, buffer, {
                    contentType: file.type,
                    cacheControl: '3600',
                    upsert: false
                });

            if (storageError) throw storageError;

            const { data, error } = await supabase.rpc('kdj_submit_departure_installment', {
                p_pendaftar_id: pendaftarId,
                p_amount_idr: amountIdr,
                p_object_path: uploadedObjectPath,
                p_original_filename: String(file.name || `bukti-transfer.${ext}`).slice(0, 255),
                p_mime_type: file.type,
                p_size_bytes: file.size,
                p_sha256: sha256
            });

            if (error || data?.success !== true) {
                await supabase.storage.from(STORAGE_BUCKET).remove([uploadedObjectPath]).catch(() => {});
                uploadedObjectPath = null;
                if (error) {
                    return NextResponse.json({ success: false, message: error.message }, { status: 409 });
                }
                return NextResponse.json({ success: false, message: 'Gagal mencatat cicilan.' }, { status: 409 });
            }

            return NextResponse.json({
                success: true,
                installment: data.installment,
                order: data.order
            });
        } catch (error) {
            if (uploadedObjectPath) {
                await supabase.storage.from(STORAGE_BUCKET).remove([uploadedObjectPath]).catch(() => {});
            }
            console.error('[-] Error upload departure installment:', error.message);
            return NextResponse.json({ success: false, message: error.message || 'Gagal mengunggah bukti cicilan.' }, { status: 500 });
        }
    }

    return NextResponse.json({ success: false, message: 'Content-Type tidak didukung.' }, { status: 415 });
}
