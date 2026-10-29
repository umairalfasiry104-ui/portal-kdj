import { NextResponse } from 'next/server';
import {
    getSupabaseAdmin,
    requireAdminSession,
    createSignedStorageUrl,
    callWaBotApi
} from '@/lib/security';

const ALLOWED_STATUS_PENDAFTARAN = [
    'Draft',
    'draft_berkas',
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

const ALLOWED_DOC_STATUS = ['pending', 'approved', 'rejected'];

// 1. Ambil semua data pendaftar beserta berkasnya (Wajib sesi Admin)
export async function GET(req) {
    try {
        const authCheck = await requireAdminSession(req);
        if (!authCheck.authorized) {
            return authCheck.response;
        }

        const supabase = getSupabaseAdmin();
        const { data: pendaftar, error } = await supabase
            .from('pendaftar')
            .select(`
                *,
                dokumen_pendaftar (*)
            `)
            .order('updated_at', { ascending: false });

        if (error) throw error;

        // Konversi URL bukti bayar & dokumen menjadi Signed URL berbatas waktu (ACT-03)
        const enrichedList = await Promise.all(
            (pendaftar || []).map(async (item) => {
                const signedBukti = item.bukti_bayar_url
                    ? await createSignedStorageUrl(supabase, item.bukti_bayar_url)
                    : null;

                const signedDocs = await Promise.all(
                    (item.dokumen_pendaftar || []).map(async (doc) => ({
                        ...doc,
                        file_path: await createSignedStorageUrl(supabase, doc.file_path)
                    }))
                );

                return {
                    ...item,
                    bukti_bayar_url: signedBukti,
                    dokumen_pendaftar: signedDocs
                };
            })
        );

        return NextResponse.json({ success: true, data: enrichedList });
    } catch (error) {
        console.error('[-] Error /api/admin/pendaftar GET:', error.message);
        return NextResponse.json(
            { success: false, message: 'Gagal memuat data pendaftar.' },
            { status: 500 }
        );
    }
}

// 2. Update status pendaftaran, pembayaran / berkas & tembak Notifikasi WA (Wajib sesi Admin)
export async function POST(req) {
    try {
        const authCheck = await requireAdminSession(req);
        if (!authCheck.authorized) {
            return authCheck.response;
        }

        const body = await req.json().catch(() => null);
        if (!body || !body.pendaftar_id) {
            return NextResponse.json(
                { success: false, message: 'ID pendaftar wajib disertakan.' },
                { status: 400 }
            );
        }

        const {
            pendaftar_id,
            status_pendaftaran,
            status_pembayaran,
            catatan_admin,
            doc_updates
        } = body;

        if (
    doc_updates !== undefined &&
    doc_updates !== null &&
    !Array.isArray(doc_updates)
) {
    return NextResponse.json(
        {
            success: false,
            message: 'Format pembaruan dokumen tidak valid.'
        },
        { status: 400 }
    );
}

        if (!ALLOWED_STATUS_PENDAFTARAN.includes(status_pendaftaran)) {
            return NextResponse.json(
                { success: false, message: 'Status pendaftaran tidak valid.' },
                { status: 400 }
            );
        }

        if (
    status_pembayaran !== undefined &&
    status_pembayaran !== null &&
    !ALLOWED_STATUS_PEMBAYARAN.includes(status_pembayaran)
) {
            return NextResponse.json(
                { success: false, message: 'Status pembayaran tidak valid.' },
                { status: 400 }
            );
        }

        const supabase = getSupabaseAdmin();

        // Validasi format UUID sebelum query database.
if (
    typeof pendaftar_id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        pendaftar_id
    )
) {
    return NextResponse.json(
        { success: false, message: 'ID pendaftar tidak valid.' },
        { status: 400 }
    );
}

// Ambil nomor WhatsApp dan nama resmi dari database.
const {
    data: existingPendaftar,
    error: findErr
} = await supabase
    .from('pendaftar')
    .select('id, no_wa, nama_lengkap, status_pembayaran')
    .eq('id', pendaftar_id)
    .maybeSingle();

// Kesalahan query bukan berarti data tidak ditemukan.
if (findErr) {
    console.error(
        '[-] Gagal mencari data pendaftar:',
        findErr.code,
        findErr.message
    );
    throw findErr;
}

if (!existingPendaftar) {
    return NextResponse.json(
        { success: false, message: 'Data pendaftar tidak ditemukan.' },
        { status: 404 }
    );
}
                    // Update pendaftar dan dokumen secara atomik melalui PostgreSQL RPC.
        const { data: updatedUser, error: updateErr } = await supabase.rpc(
            'kdj_admin_update_pendaftar_with_docs',
            {
                p_pendaftar_id: pendaftar_id,
                p_status_pendaftaran: status_pendaftaran,
                p_status_pembayaran:
    status_pembayaran ??
    existingPendaftar.status_pembayaran ??
    'Belum Bayar',
                p_catatan_admin:
                    typeof catatan_admin === 'string'
                        ? catatan_admin.trim()
                        : '',
                p_doc_updates: Array.isArray(doc_updates)
                    ? doc_updates
                    : []
            }
        );

        if (updateErr) {
            console.error(
                '[-] Gagal menjalankan transaksi update pendaftar:',
                updateErr.code,
                updateErr.message
            );

            if (updateErr.code === 'P0002') {
                return NextResponse.json(
                    {
                        success: false,
                        message: 'Data pendaftar tidak ditemukan.'
                    },
                    { status: 404 }
                );
            }

            if (updateErr.code === '22023') {
                return NextResponse.json(
                    {
                        success: false,
                        message:
                            'Status atau data pembaruan dokumen tidak valid.'
                    },
                    { status: 400 }
                );
            }

            throw updateErr;
        }

        if (
            !updatedUser ||
            typeof updatedUser !== 'object' ||
            !updatedUser.id
        ) {
            throw new Error(
                'RPC tidak mengembalikan data pendaftar yang valid.'
            );
        }

        // Pengiriman notifikasi WhatsApp dilakukan setelah transaksi berhasil.
        // Kirim Notifikasi WA otomatis ke calon mahasiswa (terpisah dari keberhasilan transaksi DB)
        const readableStatus = status_pendaftaran.replace('_', ' ').toUpperCase();
        let waNotified = false;
        try {
            const botRes = await callWaBotApi('/notify-status', {
                phone: existingPendaftar.no_wa,
                name: updatedUser.nama_lengkap || existingPendaftar.nama_lengkap || 'Calon Mahasiswa',
                status: readableStatus,
                note: typeof catatan_admin === 'string' ? catatan_admin.trim() : ''
            });
            waNotified = botRes.ok;
        } catch (waErr) {
            console.error('[-] Gagal mengirim notifikasi WA dari admin update:', waErr.message);
        }

        return NextResponse.json({
            success: true,
            user: updatedUser,
            wa_notified: waNotified
        });
    } catch (error) {
        console.error('[-] Error /api/admin/pendaftar POST:', error.message);
        return NextResponse.json(
            { success: false, message: 'Gagal memperbarui data pendaftar.' },
            { status: 500 }
        );
    }
}