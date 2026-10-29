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
        const session = getUserSession(req);
        if (!session) {
            return NextResponse.json(
                { success: false, message: 'Sesi login tidak valid atau telah berakhir. Silakan login kembali.' },
                { status: 401 }
            );
        }

        const body = await req.json().catch(() => null);
        if (!body || typeof body !== 'object') {
            return NextResponse.json({ success: false, message: 'Payload JSON tidak valid.' }, { status: 400 });
        }

        const {
            no_wa,
            nama_lengkap,
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
        const cleanPaspor = typeof no_paspor === 'string' ? no_paspor.trim() : '';
        const cleanAlamat = typeof alamat_lengkap === 'string' ? alamat_lengkap.trim() : '';
        const cleanSekolah = typeof asal_sekolah === 'string' ? asal_sekolah.trim() : '';
        const cleanGender = jenis_kelamin || 'Laki-laki';
        const cleanKampus = pilihan_kampus || 'University of Jordan';
        const cleanJurusan = normalizeJurusan(pilihan_jurusan || 'Syariah');

        if (
            cleanNama.length > 150 ||
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
        if (tahun_lulus !== undefined && tahun_lulus !== null && String(tahun_lulus).trim() !== '') {
            parsedTahunLulus = Number.parseInt(String(tahun_lulus), 10);
            const currentYear = new Date().getFullYear();
            if (Number.isNaN(parsedTahunLulus) || parsedTahunLulus < 1990 || parsedTahunLulus > currentYear + 2) {
                return NextResponse.json({ success: false, message: 'Tahun kelulusan tidak valid.' }, { status: 422 });
            }
        }

        const supabase = getSupabaseAdmin();
        const candidates = getPhoneCandidates(sessionPhone);

        const { data: currentRecord, error: fetchErr } = await supabase
            .from('pendaftar')
            .select('*')
            .in('no_wa', candidates)
            .maybeSingle();

        if (fetchErr || !currentRecord) {
            return NextResponse.json({ success: false, message: 'Data pendaftar tidak ditemukan.' }, { status: 404 });
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
                !cleanPaspor ||
                !cleanAlamat ||
                !cleanSekolah ||
                !parsedTahunLulus
            ) {
                return NextResponse.json(
                    {
                        success: false,
                        message: 'Seluruh data diri dan informasi sekolah pada Step 1 & Step 2 wajib dilengkapi sebelum mengirim pendaftaran.'
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
            const requiredDocs = ['pasfoto', 'paspor', 'ijazah', 'transkrip'];
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

            if (!currentRecord.bukti_bayar_url) {
                return NextResponse.json(
                    {
                        success: false,
                        message: 'Bukti transfer pembayaran wajib diunggah sebelum mengirim pendaftaran.'
                    },
                    { status: 400 }
                );
            }

            statusBaru = isRevisionServer ? 'Revisi Diajukan' : 'Submitted';
        }

        const { data: updatedUser, error: updateErr } = await supabase
            .from('pendaftar')
            .update({
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
                updated_at: new Date().toISOString()
            })
            .eq('id', currentRecord.id)
            .select('*')
            .single();

        if (updateErr || !updatedUser) {
            throw updateErr || new Error('Gagal memperbarui data pendaftaran.');
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
            user: updatedUser,
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