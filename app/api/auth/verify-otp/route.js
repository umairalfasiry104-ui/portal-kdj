import { NextResponse } from 'next/server';
import {
    getSupabaseAdmin,
    consumeOtpAtomically,
    getPhoneCandidates,
    setUserSessionCookie,
    clearSessionCookie,
    USER_COOKIE_NAME,
    createSignedStorageUrl
} from '@/lib/security';

// Hanya field yang diperlukan Portal customer yang boleh dikirim ke browser.
// Field operasional/internal seperti catatan_admin, catatan_pembayaran,
// last_message, last_reply, push_name, chat_handler, dan nama_leads dikecualikan.
const CUSTOMER_USER_COLUMNS = [
    'id',
    'no_wa',
    'nama_lengkap',
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
    'bukti_bayar_url',
    'nominal_tagihan',
    'created_at',
    'updated_at'
].join(', ');

function toCustomerUserDto(record) {
    return {
        id: record.id,
        no_wa: record.no_wa,
        nama_lengkap: record.nama_lengkap,
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
        bukti_bayar_url: record.bukti_bayar_url ?? null,
        nominal_tagihan: record.nominal_tagihan,
        created_at: record.created_at,
        updated_at: record.updated_at
    };
}

export async function POST(req) {
    try {
        const body = await req.json().catch(() => null);
        const phone = body?.phone;
        const otp = body?.otp;

        if (!phone || !otp) {
            return NextResponse.json(
                { success: false, message: 'Nomor WA dan OTP wajib diisi' },
                { status: 400 }
            );
        }

        const supabase = getSupabaseAdmin();
        const otpResult = await consumeOtpAtomically(supabase, phone, otp);

        if (!otpResult.valid) {
            return NextResponse.json(
                { success: false, message: otpResult.message },
                { status: otpResult.status }
            );
        }

        const normalizedPhone = otpResult.normalizedPhone;
        const candidates = getPhoneCandidates(normalizedPhone);

        if (candidates.length === 0) {
            return NextResponse.json(
                { success: false, message: 'Nomor WhatsApp tidak valid.' },
                { status: 400 }
            );
        }

        // Query error wajib dibedakan dari record yang memang tidak ditemukan.
        // maybeSingle juga fail-closed jika data lama menghasilkan lebih dari satu kandidat.
        const {
            data: existingUser,
            error: existingUserError
        } = await supabase
            .from('pendaftar')
            .select(CUSTOMER_USER_COLUMNS)
            .in('no_wa', candidates)
            .maybeSingle();

        if (existingUserError) {
            console.error(
                '[-] Gagal mencari pendaftar setelah OTP valid:',
                existingUserError.code,
                existingUserError.message
            );
            throw existingUserError;
        }

        let userRecord = existingUser;

        if (!userRecord) {
            // Pendaftar baru tetap dibuat dengan status draft eksplisit.
            const {
                data: createdUser,
                error: insertError
            } = await supabase
                .from('pendaftar')
                .insert({
                    no_wa: normalizedPhone,
                    status_pendaftaran: 'draft_berkas',
                    status_pembayaran: 'Belum Bayar'
                })
                .select(CUSTOMER_USER_COLUMNS)
                .single();

            if (insertError) throw insertError;
            userRecord = createdUser;
        }

        // DTO eksplisit mencegah kolom internal ikut terekspos jika query berkembang.
        const user = toCustomerUserDto(userRecord);

        if (user.bukti_bayar_url) {
            user.bukti_bayar_url = await createSignedStorageUrl(
                supabase,
                user.bukti_bayar_url
            );
        }

        const response = NextResponse.json({ success: true, user });
        setUserSessionCookie(response, user);
        return response;
    } catch (error) {
        console.error('[-] Error verify-otp:', error.message);
        return NextResponse.json(
            { success: false, message: 'Gagal memverifikasi kode OTP.' },
            { status: 500 }
        );
    }
}

export async function DELETE() {
    const response = NextResponse.json({ success: true, message: 'Sesi pengguna dihapus.' });
    clearSessionCookie(response, USER_COOKIE_NAME);
    return response;
}
