import { NextResponse } from 'next/server';
import {
    getSupabaseAdmin,
    getUserSession,
    normalizePhoneLocal,
    getPhoneCandidates,
    ALLOWED_KAMPUS,
    ALLOWED_GENDER,
    normalizeJurusan,
    callWaBotApi
} from '@/lib/security';

// Kontrak data customer: tidak memasukkan field operasional/internal Portal.
const CUSTOMER_UPDATE_COLUMNS = [
    'id',
    'no_wa',
    'nama_lengkap',
    'nama_orang_tua_wali',
    'no_wa_orang_tua_wali',
    'tempat_lahir',
    'tanggal_lahir',
    'jenis_kelamin',
    'no_paspor',
    'alamat_lengkap',
    'asal_sekolah',
    'tahun_lulus',
    'pilihan_kampus',
    'pilihan_jurusan',
    'status_pendaftaran',
    'status_pembayaran',
    'nominal_tagihan',
    'created_at',
    'updated_at'
].join(', ');

function toCustomerUpdateDto(record) {
    return {
        id: record.id,
        no_wa: record.no_wa,
        nama_lengkap: record.nama_lengkap,
        nama_orang_tua_wali: record.nama_orang_tua_wali ?? null,
        no_wa_orang_tua_wali: record.no_wa_orang_tua_wali ?? null,
        tempat_lahir: record.tempat_lahir,
        tanggal_lahir: record.tanggal_lahir,
        jenis_kelamin: record.jenis_kelamin,
        no_paspor: record.no_paspor,
        alamat_lengkap: record.alamat_lengkap,
        asal_sekolah: record.asal_sekolah,
        tahun_lulus: record.tahun_lulus,
        pilihan_kampus: record.pilihan_kampus,
        pilihan_jurusan: record.pilihan_jurusan,
        status_pendaftaran: record.status_pendaftaran,
        status_pembayaran: record.status_pembayaran,
        nominal_tagihan: record.nominal_tagihan,
        created_at: record.created_at,
        updated_at: record.updated_at
    };
}

function isValidDateString(dateStr) {
    if (
        typeof dateStr !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)
    ) {
        return false;
    }

    const parsed = new Date(`${dateStr}T00:00:00.000Z`);

    return (
        !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === dateStr
    );
}

export async function POST(req) {
    try {
        const session = await getUserSession(req);
        if (!session) {
            return NextResponse.json(
                { success: false, message: 'Sesi login tidak valid atau telah berakhir. Silakan login kembali.' },
                { status: 401 }
            );
        }

const body = await req.json().catch(() => null);

// Payload harus berupa plain JSON object.
if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.getPrototypeOf(body) !== Object.prototype
) {
    return NextResponse.json(
        {
            success: false,
            message: 'Payload JSON tidak valid.'
        },
        { status: 400 }
    );
}

// Semua field formulir harus dikirim.
// Nilai kosong tetap diperbolehkan untuk penyimpanan draft.
const requiredFields = [
    'nama_lengkap',
    'tempat_lahir',
    'tanggal_lahir',
    'jenis_kelamin',
    'no_paspor',
    'nama_orang_tua_wali',
    'no_wa_orang_tua_wali',
    'alamat_lengkap',
    'asal_sekolah',
    'tahun_lulus',
    'pilihan_kampus',
    'pilihan_jurusan'
];

const missingFields = requiredFields.filter(
    (field) => !Object.prototype.hasOwnProperty.call(body, field)
);

if (missingFields.length > 0) {
    return NextResponse.json(
        {
            success: false,
            message: 'Payload formulir tidak lengkap.',
            missing_fields: missingFields
        },
        { status: 422 }
    );
}

// Validasi tipe string.
const stringFields = [
    'nama_lengkap',
    'tempat_lahir',
    'no_paspor',
    'nama_orang_tua_wali',
    'no_wa_orang_tua_wali',
    'alamat_lengkap',
    'asal_sekolah',
    'jenis_kelamin',
    'pilihan_kampus',
    'pilihan_jurusan'
];

const invalidStringFields = stringFields.filter(
    (field) => typeof body[field] !== 'string'
);

// Tanggal harus string atau null.
if (
    body.tanggal_lahir !== null &&
    typeof body.tanggal_lahir !== 'string'
) {
    invalidStringFields.push('tanggal_lahir');
}

// Tahun boleh berupa string, number, atau null.
if (
    body.tahun_lulus !== null &&
    typeof body.tahun_lulus !== 'string' &&
    typeof body.tahun_lulus !== 'number'
) {
    invalidStringFields.push('tahun_lulus');
}

// Nomor WhatsApp opsional karena identitas utama dari sesi.
if (
    body.no_wa !== undefined &&
    body.no_wa !== null &&
    typeof body.no_wa !== 'string'
) {
    invalidStringFields.push('no_wa');
}

if (invalidStringFields.length > 0) {
    return NextResponse.json(
        {
            success: false,
            message: 'Tipe data field formulir tidak valid.',
            invalid_fields: invalidStringFields
        },
        { status: 422 }
    );
}

const {
    no_wa,
    nama_lengkap,
    nama_orang_tua_wali,
    no_wa_orang_tua_wali,
    tempat_lahir,
    tanggal_lahir,
    jenis_kelamin,
    no_paspor,
    alamat_lengkap,
    asal_sekolah,
    tahun_lulus,
    pilihan_kampus,
    pilihan_jurusan,
    is_final_submit
} = body;

if (
    is_final_submit !== undefined &&
    typeof is_final_submit !== 'boolean'
) {
    return NextResponse.json(
        {
            success: false,
            message: 'is_final_submit harus berupa boolean.'
        },
        { status: 422 }
    );
}

const is_initial_submit = body.is_initial_submit === true;
if (
    body.is_initial_submit !== undefined &&
    typeof body.is_initial_submit !== 'boolean'
) {
    return NextResponse.json(
        { success: false, message: 'is_initial_submit harus berupa boolean.' },
        { status: 422 }
    );
}
if (is_initial_submit && is_final_submit === true) {
    return NextResponse.json(
        { success: false, message: 'Submit data awal dan submit berkas harus dilakukan pada tahap terpisah.' },
        { status: 422 }
    );
}

if (
    body.is_revision !== undefined &&
    typeof body.is_revision !== 'boolean'
) {
    return NextResponse.json(
        {
            success: false,
            message: 'is_revision harus berupa boolean.'
        },
        { status: 422 }
    );
}

        const sessionPhone = normalizePhoneLocal(session.no_wa);

if (!sessionPhone) {
    return NextResponse.json(
        {
            success: false,
            message: 'Sesi tidak memiliki nomor WhatsApp yang valid.'
        },
        { status: 403 }
    );
}

const hasPayloadPhone =
    no_wa !== undefined &&
    no_wa !== null &&
    String(no_wa).trim() !== '';

if (hasPayloadPhone) {
    const payloadPhone = normalizePhoneLocal(no_wa);

    if (!payloadPhone) {
        return NextResponse.json(
            {
                success: false,
                message: 'Format nomor WhatsApp pada payload tidak valid.'
            },
            { status: 400 }
        );
    }

    if (payloadPhone !== sessionPhone) {
        return NextResponse.json(
            {
                success: false,
                message: 'Akses ditolak: Anda hanya dapat mengubah data milik sendiri.'
            },
            { status: 403 }
        );
    }
}

        // Validasi tipe, panjang karakter, dan enum sesuai skema database (ACT-07)
        const cleanNama = typeof nama_lengkap === 'string' ? nama_lengkap.trim() : '';
        const cleanTempatLahir = typeof tempat_lahir === 'string' ? tempat_lahir.trim() : '';
        const hasParentName = Object.prototype.hasOwnProperty.call(body, 'nama_orang_tua_wali');
        const hasParentPhone = Object.prototype.hasOwnProperty.call(body, 'no_wa_orang_tua_wali');
        const cleanParentName = typeof nama_orang_tua_wali === 'string'
            ? nama_orang_tua_wali.trim()
            : '';
        const rawParentPhone = typeof no_wa_orang_tua_wali === 'string'
            ? no_wa_orang_tua_wali.trim()
            : '';
        const cleanParentPhone = rawParentPhone
            ? normalizePhoneLocal(rawParentPhone)
            : null;
        const cleanPaspor = typeof no_paspor === 'string' ? no_paspor.trim() : '';
        const cleanAlamat = typeof alamat_lengkap === 'string' ? alamat_lengkap.trim() : '';
        const cleanSekolah = typeof asal_sekolah === 'string' ? asal_sekolah.trim() : '';
        const cleanGender = jenis_kelamin || 'Laki-laki';
        const cleanKampus = pilihan_kampus || 'University of Jordan';
        const cleanJurusan = normalizeJurusan(pilihan_jurusan || 'Syariah');

        if (
            cleanNama.length > 150 ||
            cleanParentName.length > 150 ||
            cleanTempatLahir.length > 100 ||
            cleanPaspor.length > 50 ||
            cleanSekolah.length > 150 ||
            cleanAlamat.length > 1000
        ) {
            return NextResponse.json(
                { success: false, message: 'Panjang karakter melebihi batas kolom yang diizinkan.' },
                { status: 422 }
            );
        }

        if (hasParentPhone && rawParentPhone && !cleanParentPhone) {
            return NextResponse.json(
                { success: false, message: 'Nomor WhatsApp orang tua/wali tidak valid. Gunakan nomor Indonesia 08... atau +62...' },
                { status: 422 }
            );
        }

        if (!ALLOWED_GENDER.includes(cleanGender)) {
            return NextResponse.json({ success: false, message: 'Jenis kelamin tidak valid.' }, { status: 422 });
        }

        if (!ALLOWED_KAMPUS.includes(cleanKampus)) {
            return NextResponse.json({ success: false, message: 'Pilihan universitas tidak valid.' }, { status: 422 });
        }

        if (!cleanJurusan) {
            return NextResponse.json({ success: false, message: 'Pilihan jurusan tidak valid.' }, { status: 422 });
        }

        if (tanggal_lahir && !isValidDateString(tanggal_lahir)) {
            return NextResponse.json({ success: false, message: 'Format tanggal lahir tidak valid (YYYY-MM-DD).' }, { status: 422 });
        }

        let parsedTahunLulus = null;

        const hasTahunLulus =
            tahun_lulus !== undefined &&
            tahun_lulus !== null &&
            !(typeof tahun_lulus === 'string' && tahun_lulus.trim() === '');

        if (hasTahunLulus) {
            const isAllowedType =
                typeof tahun_lulus === 'string' ||
                typeof tahun_lulus === 'number';

            const rawTahunLulus = isAllowedType
                ? String(tahun_lulus).trim()
                : '';

            const currentYear = new Date().getFullYear();

            if (!/^\d{4}$/.test(rawTahunLulus)) {
                return NextResponse.json(
                    {
                        success: false,
                        message: 'Tahun kelulusan tidak valid.'
                    },
                    { status: 422 }
                );
            }

            parsedTahunLulus = Number(rawTahunLulus);

            if (
                !Number.isInteger(parsedTahunLulus) ||
                parsedTahunLulus < 1990 ||
                parsedTahunLulus > currentYear + 2
            ) {
                return NextResponse.json(
                    {
                        success: false,
                        message: 'Tahun kelulusan tidak valid.'
                    },
                    { status: 422 }
                );
            }
        }

        const candidates = getPhoneCandidates(sessionPhone);
        if (candidates.length === 0) {
            return NextResponse.json(
                { success: false, message: 'Nomor WhatsApp sesi tidak valid.' },
                { status: 403 }
            );
        }

        const supabase = getSupabaseAdmin();
        const { data: currentRecord, error: fetchErr } = await supabase
            .from('pendaftar')
            .select('id, no_wa, status_pendaftaran, status_pembayaran, bukti_bayar_url')
            // Identitas utama berasal dari UUID sesi, bukan payload browser.
            // Filter nomor tambahan mengikat ulang record ke nomor sesi.
            .eq('id', session.sub)
            .in('no_wa', candidates)
            .maybeSingle();

        if (fetchErr) {
            console.error(
                '[-] Gagal mengambil record pendaftar milik sesi:',
                fetchErr.code,
                fetchErr.message
            );
            throw fetchErr;
        }

        if (!currentRecord) {
            return NextResponse.json(
                { success: false, message: 'Data pendaftar tidak ditemukan.' },
                { status: 404 }
            );
        }

        const currentStatusNorm = (currentRecord.status_pendaftaran || '').toLowerCase();
        const isLockedStatus = ['submitted', 'menunggu verifikasi', 'revisi diajukan', 'approved', 'final_submit'].includes(currentStatusNorm);
        if (isLockedStatus) {
            return NextResponse.json(
                {
                    success: false,
                    message: 'Formulir pendaftaran sedang dikunci karena dalam proses verifikasi atau telah disetujui.'
                },
                { status: 403 }
            );
        }

        const isRevisionServer = currentStatusNorm === 'rejected';
        let statusBaru = isRevisionServer ? 'Rejected' : 'draft_berkas';

        // Penegakan aturan Final Submit di sisi server (ACT-08 / T-14)
        if (is_final_submit === true) {
            if (
                !cleanNama ||
                !cleanTempatLahir ||
                !tanggal_lahir ||
                !cleanParentName ||
                !cleanParentPhone ||
                !cleanAlamat ||
                !cleanSekolah ||
                !parsedTahunLulus
            ) {
                return NextResponse.json(
                    {
                        success: false,
                        message: 'Seluruh data diri, kontak orang tua/wali, dan informasi sekolah pada Step 1 & Step 2 wajib dilengkapi sebelum mengirim pendaftaran.'
                    },
                    { status: 400 }
                );
            }

            const { data: docs, error: docsErr } = await supabase
                .from('dokumen_pendaftar')
                .select('jenis_dokumen')
                .eq('pendaftar_id', currentRecord.id);

            if (docsErr) throw docsErr;

            const uploadedTypes = new Set((docs || []).map((d) => d.jenis_dokumen));
            const requiredDocs = ['pasfoto', 'ijazah', 'transkrip', 'akta_kelahiran'];
            const missingDocs = requiredDocs.filter((reqDoc) => !uploadedTypes.has(reqDoc));

            if (missingDocs.length > 0) {
                return NextResponse.json(
                    {
                        success: false,
                        message: `Dokumen wajib belum lengkap: ${missingDocs.join(', ').toUpperCase()}`
                    },
                    { status: 400 }
                );
            }

            const { data: paymentRecord, error: paymentLookupError } = await supabase
                .from('kdj_registration_payments')
                .select('status')
                .eq('pendaftar_id', currentRecord.id)
                .maybeSingle();

            if (paymentLookupError) throw paymentLookupError;

            // Existing applicants with legacy verified Lunas status remain readable.
            const paymentIsPaid = paymentRecord
                ? paymentRecord.status === 'PAID'
                : currentRecord.status_pembayaran === 'Lunas';

            if (!paymentIsPaid) {
                return NextResponse.json(
                    {
                        success: false,
                        code: 'PAYMENT_NOT_PAID',
                        message: 'Pembayaran pendaftaran harus dikonfirmasi Lunas oleh Admin sebelum berkas dapat dikirim.'
                    },
                    { status: 403 }
                );
            }

            statusBaru = isRevisionServer ? 'Revisi Diajukan' : 'Submitted';
        }

        const updatePayload = {
            nama_lengkap: cleanNama,
            tempat_lahir: cleanTempatLahir,
            tanggal_lahir: tanggal_lahir || null,
            jenis_kelamin: cleanGender,
            no_paspor: cleanPaspor,
            alamat_lengkap: cleanAlamat,
            asal_sekolah: cleanSekolah,
            tahun_lulus: parsedTahunLulus,
            pilihan_kampus: cleanKampus,
            pilihan_jurusan: cleanJurusan,
            status_pendaftaran: statusBaru,
            updated_at: new Date().toISOString(),
            ...(hasParentName ? { nama_orang_tua_wali: cleanParentName } : {}),
            ...(hasParentPhone ? { no_wa_orang_tua_wali: cleanParentPhone } : {})
        };

        const { data: updatedUser, error: updateErr } = await supabase
            .from('pendaftar')
            .update(updatePayload)
            .eq('id', currentRecord.id)
            // Ulangi filter owner pada UPDATE untuk mencegah perubahan identitas
            // antara pembacaan record dan penulisan.
            .in('no_wa', candidates)
            .select(CUSTOMER_UPDATE_COLUMNS)
            .single();

        if (updateErr || !updatedUser) {
            throw updateErr || new Error('Gagal memperbarui data pendaftaran.');
        }

        let payment = null;
        if (is_initial_submit) {
            if (isRevisionServer || isLockedStatus) {
                return NextResponse.json(
                    { success: false, message: 'Data awal tidak dapat disubmit ulang pada status pendaftaran saat ini.' },
                    { status: 409 }
                );
            }

            const { data: paymentData, error: paymentError } = await supabase.rpc(
                'kdj_start_registration_payment',
                { p_pendaftar_id: currentRecord.id }
            );

            if (paymentError) {
                console.error('[-] Gagal membuat invoice pendaftaran:', paymentError.code, paymentError.message);
                throw paymentError;
            }

            if (paymentData?.success !== true) {
                return NextResponse.json(
                    {
                        success: false,
                        code: paymentData?.code || 'PAYMENT_INVOICE_NOT_CREATED',
                        message: paymentData?.message || 'Tagihan pembayaran belum dapat dibuat.'
                    },
                    { status: 409 }
                );
            }

            payment = paymentData;
        }

        // Pengiriman notifikasi WA dipisahkan dari keberhasilan transaksi DB (ACT-12, ACT-13, ACT-14)
        let waNotified = false;
        let correlationId = null;

        if (is_final_submit === true) {
            try {
                const botRes = await callWaBotApi(
                    '/notify-status',
                    {
                        phone: sessionPhone,
                        name: updatedUser.nama_lengkap || 'Calon Mahasiswa',
                        status: statusBaru,
                        note: isRevisionServer
                            ? 'Pendaftar telah memperbarui berkas dan bukti pembayaran revisi.'
                            : `Pendaftaran ke ${updatedUser.pilihan_kampus} (${updatedUser.pilihan_jurusan}) beserta bukti pembayaran telah diterima.`
                    },
                    { retryOnNetworkError: true }
                );
                waNotified = botRes.ok;
                correlationId = botRes.correlationId;
            } catch (waErr) {
                console.error('[-] Gagal mengirim notifikasi WA saat final submit:', waErr.message);
            }
        }

        return NextResponse.json({
            success: true,
            user: toCustomerUpdateDto(updatedUser),
            ...(payment ? { payment } : {}),
            wa_notified: waNotified,
            correlation_id: correlationId
        });
    } catch (error) {
        console.error('[-] Error /api/pendaftar POST:', error.message);
        return NextResponse.json(
            { success: false, message: 'Gagal menyimpan data pendaftaran.' },
            { status: 500 }
        );
    }
}
