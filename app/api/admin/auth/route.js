import { NextResponse } from 'next/server';
import {
    getSupabaseAdmin,
    normalizePhoneLocal,
    getPhoneCandidates,
    checkRateLimit,
    consumeOtpAtomically,
    setAdminSessionCookie,
    clearSessionCookie,
    ADMIN_COOKIE_NAME,
    requireAdminSession
} from '@/lib/security';

const ALLOWED_ADMIN_ROLES = ['Admin Verifikator', 'Admin Keuangan', 'Super Admin'];

export async function POST(req) {
    try {
        const body = await req.json().catch(() => null);
        if (!body || typeof body.action !== 'string') {
            return NextResponse.json({ success: false, message: 'Aksi tidak valid.' }, { status: 400 });
        }

        const { action, phone, otp, new_admin_phone, new_admin_name, new_admin_role } = body;
        const supabase = getSupabaseAdmin();

        // Aksi Logout Admin: hapus cookie HttpOnly
        if (action === 'logout') {
            const response = NextResponse.json({ success: true, message: 'Logout berhasil.' });
            clearSessionCookie(response, ADMIN_COOKIE_NAME);
            return response;
        }

        // Aksi A: Cek nomor sebelum kirim OTP Admin (tanpa membocorkan seluruh kolom admin)
        if (action === 'check_admin') {
       const clientIp =
    req.headers.get('x-real-ip')?.trim() ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown';

// Maksimal 20 pemeriksaan dari satu alamat IP per 10 menit.
const ipRateCheck = checkRateLimit(
    `check-admin:ip:${clientIp}`,
    20,
    10 * 60 * 1000
);

if (!ipRateCheck.allowed) {
    return NextResponse.json(
        {
            success: false,
            message: 'Terlalu banyak permintaan. Silakan coba lagi nanti.'
        },
        {
            status: 429,
            headers: {
                'Retry-After': String(ipRateCheck.retryAfterSec)
            }
        }
    );
}

const normalizedPhone = normalizePhoneLocal(phone);

if (!normalizedPhone) {
    return NextResponse.json(
        { success: false, message: 'Format nomor WhatsApp tidak valid.' },
        { status: 400 }
    );
}

// Maksimal 4 pemeriksaan untuk nomor yang sama per 10 menit.
const phoneRateCheck = checkRateLimit(
    `check-admin:phone:${normalizedPhone}`,
    4,
    10 * 60 * 1000
);

if (!phoneRateCheck.allowed) {
    return NextResponse.json(
        {
            success: false,
            message: 'Terlalu banyak permintaan. Silakan coba lagi nanti.'
        },
        {
            status: 429,
            headers: {
                'Retry-After': String(phoneRateCheck.retryAfterSec)
            }
        }
    );
}

            const candidates = getPhoneCandidates(normalizedPhone);
           const {
    data: admin,
    error: adminQueryError
} = await supabase
    .from('admins')
    .select('id, nama_admin')
    .in('no_wa', candidates)
    .maybeSingle();

if (adminQueryError) {
    console.error(
        '[-] Gagal memeriksa akun admin:',
        adminQueryError.message
    );

    return NextResponse.json(
        {
            success: false,
            message: 'Tidak dapat memverifikasi akses admin saat ini.'
        },
        { status: 500 }
    );
}

            if (!admin) {
                return NextResponse.json(
                    {
                        success: false,
                        message: 'Akses Ditolak! Nomor WA ini tidak terdaftar sebagai Admin.'
                    },
                    { status: 403 }
                );
            }

            return NextResponse.json({
                success: true,
                admin: { nama_admin: admin.nama_admin }
            });
        }

        // Aksi B: Verifikasi OTP Login Admin secara atomik & terbitkan cookie sesi server
        if (action === 'verify_admin_otp') {
            const normalizedPhone = normalizePhoneLocal(phone);
            if (!normalizedPhone || !otp) {
                return NextResponse.json(
                    { success: false, message: 'Nomor WA dan OTP wajib diisi.' },
                    { status: 400 }
                );
            }

            const candidates = getPhoneCandidates(normalizedPhone);
            const {
    data: admin,
    error: adminQueryError
} = await supabase
    .from('admins')
    .select('id, no_wa, nama_admin, role, created_at')
    .in('no_wa', candidates)
    .maybeSingle();

if (adminQueryError) {
    console.error(
        '[-] Gagal mengambil data admin untuk verifikasi OTP:',
        adminQueryError.message
    );

    return NextResponse.json(
        {
            success: false,
            message: 'Tidak dapat memverifikasi akses admin saat ini.'
        },
        { status: 500 }
    );
}

            if (!admin) {
                return NextResponse.json(
                    { success: false, message: 'Akses Ditolak! Nomor WA ini tidak terdaftar sebagai Admin.' },
                    { status: 403 }
                );
            }

            const otpResult = await consumeOtpAtomically(supabase, normalizedPhone, otp);
            if (!otpResult.valid) {
                return NextResponse.json(
                    { success: false, message: otpResult.message },
                    { status: otpResult.status }
                );
            }

            const response = NextResponse.json({ success: true, admin });
            setAdminSessionCookie(response, admin);
            return response;
        }

        // Aksi C: Tambah Admin Baru dari Dashboard (Wajib sesi aktif dengan role Super Admin)
        if (action === 'add_admin') {
            const authCheck = await requireAdminSession(req, ['Super Admin']);
            if (!authCheck.authorized) {
                return authCheck.response;
            }

            const normalizedNewPhone = normalizePhoneLocal(new_admin_phone);
            const cleanName = typeof new_admin_name === 'string' ? new_admin_name.trim() : '';
            const roleToAssign = new_admin_role || 'Admin Verifikator';

            if (!normalizedNewPhone || !cleanName || cleanName.length > 100) {
                return NextResponse.json(
                    { success: false, message: 'Nama admin dan nomor WhatsApp (08xx) wajib valid.' },
                    { status: 400 }
                );
            }

            if (!ALLOWED_ADMIN_ROLES.includes(roleToAssign)) {
                return NextResponse.json(
                    { success: false, message: 'Peran/role admin tidak valid.' },
                    { status: 400 }
                );
            }

            const { data, error } = await supabase
                .from('admins')
                .insert({
                    no_wa: normalizedNewPhone,
                    nama_admin: cleanName,
                    role: roleToAssign
                })
                .select('id, no_wa, nama_admin, role, created_at')
                .single();

            if (error) {
                const isDuplicate = error.code === '23505';
                return NextResponse.json(
                    {
                        success: false,
                        message: isDuplicate
                            ? 'Nomor WhatsApp tersebut sudah terdaftar sebagai Admin.'
                            : 'Gagal menambahkan admin baru.'
                    },
                    { status: isDuplicate ? 409 : 500 }
                );
            }

            return NextResponse.json({ success: true, admin: data });
        }

        return NextResponse.json({ success: false, message: 'Invalid action' }, { status: 400 });
    } catch (error) {
        console.error('[-] Error /api/admin/auth POST:', error.message);
        return NextResponse.json(
            { success: false, message: 'Terjadi kesalahan internal pada server.' },
            { status: 500 }
        );
    }
}

// Ambil daftar seluruh admin (Wajib memiliki sesi Admin yang sah)
export async function GET(req) {
    try {
        const authCheck = await requireAdminSession(req);
        if (!authCheck.authorized) {
            return authCheck.response;
        }

        const supabase = getSupabaseAdmin();
        const { data: admins, error } = await supabase
            .from('admins')
            .select('id, no_wa, nama_admin, role, created_at')
            .order('created_at', { ascending: true });

        if (error) throw error;
        return NextResponse.json({ success: true, admins });
    } catch (error) {
        console.error('[-] Error /api/admin/auth GET:', error.message);
        return NextResponse.json(
            { success: false, message: 'Gagal memuat daftar admin.' },
            { status: 500 }
        );
    }
}