import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const USER_COOKIE_NAME = 'kdj_user_session';
export const ADMIN_COOKIE_NAME = 'kdj_admin_session';
export const STORAGE_BUCKET = 'berkas_kdj';

export const ALLOWED_KAMPUS = [
    'University of Jordan',
    'Yarmouk University',
    'Mutah University',
    'WISE'
];

export const ALLOWED_JURUSAN = [
    'Ekonomi Syariah',
    'Bahasa & Sastra Arab',
    'Fiqh wa Ushuluhu',
    'Syariah',
    'Aqidah'
];

export const ALLOWED_GENDER = ['Laki-laki', 'Perempuan'];

const USER_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

// Rate limiter dan brute-force tracker masih berbasis memori proses.
// Untuk deployment multi-instance, gunakan penyimpanan bersama yang atomik.
const rateLimitStore = new Map();
const otpAttemptStore = new Map();

export function normalizeJurusan(rawJurusan) {
    if (!rawJurusan || typeof rawJurusan !== 'string') {
        return 'Syariah';
    }

    const trimmed = rawJurusan.trim();

    if (trimmed === 'Syariah / Ushuluddin') {
        return 'Syariah';
    }

    return ALLOWED_JURUSAN.includes(trimmed) ? trimmed : null;
}

export function getSupabaseAdmin() {
    const url =
        process.env.NEXT_PUBLIC_SUPABASE_URL ||
        process.env.SUPABASE_URL;

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !serviceKey) {
        throw new Error('Konfigurasi Supabase server belum lengkap.');
    }

    return createClient(url, serviceKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false
        }
    });
}

function getSessionSecret() {
    const explicitSecret = process.env.SESSION_SECRET;

    if (explicitSecret && explicitSecret.length >= 32) {
        return explicitSecret;
    }

    const fallbackKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!fallbackKey) {
        throw new Error(
            'SESSION_SECRET atau SUPABASE_SERVICE_ROLE_KEY wajib tersedia di server.'
        );
    }

    return crypto
        .createHmac('sha256', 'kdj-portal-session-key-v1')
        .update(fallbackKey)
        .digest('hex');
}

/**
 * Normalisasi nomor WhatsApp ke format kanonik 08xxxxxxxxxx.
 */
export function normalizePhoneLocal(rawPhone) {
    if (
        typeof rawPhone !== 'string' &&
        typeof rawPhone !== 'number'
    ) {
        return null;
    }

    let digits = String(rawPhone).trim().replace(/\D/g, '');

    if (digits.startsWith('62')) {
        digits = '0' + digits.slice(2);
    } else if (digits.startsWith('8')) {
        digits = '0' + digits;
    }

    if (!/^08\d{8,13}$/.test(digits)) {
        return null;
    }

    return digits;
}

/**
 * Menghasilkan kandidat nomor lokal dan internasional untuk
 * kompatibilitas record lama.
 */
export function getPhoneCandidates(rawPhone) {
    const local = normalizePhoneLocal(rawPhone);

    if (!local) {
        return [];
    }

    const intl = '62' + local.slice(1);

    return Array.from(
        new Set([local, intl, `+${intl}`])
    );
}

function base64UrlEncode(str) {
    return Buffer.from(str, 'utf8').toString('base64url');
}

function base64UrlDecode(str) {
    return Buffer.from(str, 'base64url').toString('base64url')
        ? Buffer.from(str, 'base64url').toString('utf8')
        : '';
}

/**
 * Membuat token sesi bertanda tangan HMAC-SHA256.
 * Waktu iat dan exp menggunakan milidetik.
 */
export function createSessionToken(
    payload,
    ttlMs = USER_SESSION_TTL_MS
) {
    const now = Date.now();

    const fullPayload = {
        ...payload,
        iat: now,
        exp: now + ttlMs
    };

    const encodedPayload = base64UrlEncode(
        JSON.stringify(fullPayload)
    );

    const signature = crypto
        .createHmac('sha256', getSessionSecret())
        .update(encodedPayload)
        .digest('base64url');

    return `${encodedPayload}.${signature}`;
}

/**
 * Memverifikasi struktur, signature, dan masa berlaku token sesi.
 */
export function verifySessionToken(token) {
    if (
        !token ||
        typeof token !== 'string'
    ) {
        return null;
    }

    const segments = token.split('.');

    // Token harus mempunyai tepat dua segmen.
    if (
        segments.length !== 2 ||
        !segments[0] ||
        !segments[1]
    ) {
        return null;
    }

    const [encodedPayload, signature] = segments;

    let expectedSig;

    try {
        expectedSig = crypto
            .createHmac('sha256', getSessionSecret())
            .update(encodedPayload)
            .digest('base64url');
    } catch (error) {
        console.error(
            '[-] Gagal memperoleh secret sesi:',
            error.message
        );

        return null;
    }

    const sigBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expectedSig);

    if (
        sigBuf.length !== expectedBuf.length ||
        !crypto.timingSafeEqual(sigBuf, expectedBuf)
    ) {
        return null;
    }

    try {
        const payload = JSON.parse(
            base64UrlDecode(encodedPayload)
        );

        if (
            !payload ||
            typeof payload !== 'object' ||
            !Number.isFinite(payload.exp) ||
            Date.now() > payload.exp
        ) {
            return null;
        }

        return payload;
    } catch {
        return null;
    }
}

export function setSessionCookie(
    response,
    cookieName,
    payload,
    ttlMs
) {
    const token = createSessionToken(payload, ttlMs);

    response.cookies.set(cookieName, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: Math.floor(ttlMs / 1000)
    });

    return response;
}

export function clearSessionCookie(
    response,
    cookieName
) {
    response.cookies.set(cookieName, '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 0
    });

    return response;
}

export function setUserSessionCookie(response, user) {
    return setSessionCookie(
        response,
        USER_COOKIE_NAME,
        {
            type: 'user',
            sub: user.id,
            no_wa:
                normalizePhoneLocal(user.no_wa) ||
                user.no_wa
        },
        USER_SESSION_TTL_MS
    );
}

export function setAdminSessionCookie(response, admin) {
    return setSessionCookie(
        response,
        ADMIN_COOKIE_NAME,
        {
            type: 'admin',
            sub: admin.id,
            no_wa:
                normalizePhoneLocal(admin.no_wa) ||
                admin.no_wa,
            role: admin.role || 'Admin Verifikator',
            nama_admin: admin.nama_admin
        },
        ADMIN_SESSION_TTL_MS
    );
}

export function getUserSession(req) {
    const token = req.cookies.get(USER_COOKIE_NAME)?.value;
    const session = verifySessionToken(token);

    if (
        !session ||
        session.type !== 'user' ||
        !session.no_wa
    ) {
        return null;
    }

    return session;
}

export async function requireAdminSession(
    req,
    allowedRoles = null
) {
    const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
    const session = verifySessionToken(token);

    if (
        !session ||
        session.type !== 'admin' ||
        !session.no_wa
    ) {
        return {
            authorized: false,
            response: NextResponse.json(
                {
                    success: false,
                    message:
                        'Sesi admin tidak ditemukan atau telah kedaluwarsa. Silakan login kembali.'
                },
                { status: 401 }
            )
        };
    }

    const supabase = getSupabaseAdmin();
    const candidates = getPhoneCandidates(session.no_wa);

    const {
        data: adminRecord,
        error
    } = await supabase
        .from('admins')
        .select('id, no_wa, nama_admin, role')
        .in(
            'no_wa',
            candidates.length > 0
                ? candidates
                : [session.no_wa]
        )
        .maybeSingle();

    if (error) {
        console.error(
            '[-] Gagal memverifikasi admin:',
            error.message
        );

        return {
            authorized: false,
            response: NextResponse.json(
                {
                    success: false,
                    message: 'Gagal memverifikasi sesi admin.'
                },
                { status: 500 }
            )
        };
    }

    if (!adminRecord) {
        return {
            authorized: false,
            response: NextResponse.json(
                {
                    success: false,
                    message: 'Akun admin sudah tidak aktif.'
                },
                { status: 401 }
            )
        };
    }

    if (
        Array.isArray(allowedRoles) &&
        allowedRoles.length > 0 &&
        !allowedRoles.includes(adminRecord.role)
    ) {
        return {
            authorized: false,
            response: NextResponse.json(
                {
                    success: false,
                    message:
                        'Peran admin Anda tidak memiliki izin untuk aksi ini.'
                },
                { status: 403 }
            )
        };
    }

    return {
        authorized: true,
        admin: adminRecord
    };
}

/**
 * Rate limit berbasis fixed window.
 * Catatan: penyimpanan ini hanya berlaku pada satu proses Node.js.
 */
export function checkRateLimit(
    key,
    maxRequests = 5,
    windowMs = 60 * 1000
) {
    const now = Date.now();
    const entry = rateLimitStore.get(key);

    if (!entry || now > entry.resetAt) {
        rateLimitStore.set(key, {
            count: 1,
            resetAt: now + windowMs
        });

        return {
            allowed: true,
            retryAfterSec: 0
        };
    }

    if (entry.count >= maxRequests) {
        return {
            allowed: false,
            retryAfterSec: Math.max(
                1,
                Math.ceil((entry.resetAt - now) / 1000)
            )
        };
    }

    entry.count += 1;

    return {
        allowed: true,
        retryAfterSec: 0
    };
}

export function checkOtpBruteForce(
    phoneKey,
    maxFailures = 5,
    windowMs = 10 * 60 * 1000
) {
    const now = Date.now();
    const entry = otpAttemptStore.get(phoneKey);

    if (!entry || now > entry.resetAt) {
        return {
            locked: false,
            remaining: maxFailures
        };
    }

    if (entry.failures >= maxFailures) {
        return {
            locked: true,
            retryAfterSec: Math.max(
                1,
                Math.ceil((entry.resetAt - now) / 1000)
            )
        };
    }

    return {
        locked: false,
        remaining: maxFailures - entry.failures
    };
}

export function recordOtpFailure(
    phoneKey,
    maxFailures = 5,
    windowMs = 10 * 60 * 1000
) {
    const now = Date.now();
    const entry = otpAttemptStore.get(phoneKey);

    if (!entry || now > entry.resetAt) {
        otpAttemptStore.set(phoneKey, {
            failures: 1,
            resetAt: now + windowMs
        });

        return 1;
    }

    entry.failures += 1;

    return entry.failures;
}

export function clearOtpFailures(phoneKey) {
    otpAttemptStore.delete(phoneKey);
}

/**
 * Mengonsumsi OTP dengan update bersyarat pada database.
 *
 * Catatan: konsumsi OTP menggunakan conditional update untuk mencegah
 * dua request mengonsumsi record OTP yang sama. Penghitungan brute-force
 * tetap berada di memori proses dan belum sinkron antar-instance.
 */
export async function consumeOtpAtomically(
    supabase,
    rawPhone,
    rawOtp
) {
    const normalizedPhone = normalizePhoneLocal(rawPhone);
    const cleanOtp = String(rawOtp || '').trim();

    if (
        !normalizedPhone ||
        !/^\d{6}$/.test(cleanOtp)
    ) {
        return {
            valid: false,
            status: 400,
            message:
                'Format nomor WhatsApp atau kode OTP tidak valid.'
        };
    }

    const bruteCheck = checkOtpBruteForce(normalizedPhone);

    if (bruteCheck.locked) {
        return {
            valid: false,
            status: 429,
            message:
                `Terlalu banyak percobaan OTP yang salah. ` +
                `Silakan minta OTP baru setelah ` +
                `${bruteCheck.retryAfterSec} detik.`
        };
    }

    const candidates = getPhoneCandidates(normalizedPhone);
    const nowIso = new Date().toISOString();

    // 1. Ambil OTP aktif dan belum kedaluwarsa.
    const {
        data: targetOtp,
        error: targetOtpError
    } = await supabase
        .from('otp_auth')
        .select('id, kode_otp')
        .in('no_wa', candidates)
        .eq('is_used', false)
        .gt('expires_at', nowIso)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (targetOtpError) {
        console.error(
            '[-] Gagal membaca OTP dari database:',
            targetOtpError.message
        );

        return {
            valid: false,
            status: 500,
            message:
                'Gagal memverifikasi kode OTP. Silakan coba lagi.'
        };
    }

    // 2. OTP salah, belum ada, atau sudah kedaluwarsa.
    if (
        !targetOtp ||
        String(targetOtp.kode_otp) !== cleanOtp
    ) {
        const failures = recordOtpFailure(normalizedPhone);

        if (failures >= 5) {
            // Nonaktifkan semua OTP aktif setelah batas kegagalan tercapai.
            const {
                error: invalidateError
            } = await supabase
                .from('otp_auth')
                .update({ is_used: true })
                .in('no_wa', candidates)
                .eq('is_used', false);

            if (invalidateError) {
                console.error(
                    '[-] Gagal menonaktifkan OTP setelah batas percobaan:',
                    invalidateError.message
                );

                return {
                    valid: false,
                    status: 500,
                    message:
                        'Gagal mengamankan proses OTP. Silakan coba lagi.'
                };
            }

            const lockState = checkOtpBruteForce(normalizedPhone);

            return {
                valid: false,
                status: 429,
                message:
                    `Terlalu banyak percobaan OTP yang salah. ` +
                    `Silakan minta OTP baru setelah ` +
                    `${lockState.retryAfterSec || 600} detik.`
            };
        }

        return {
            valid: false,
            status: 400,
            message: 'Kode OTP salah atau telah kedaluwarsa!'
        };
    }

    // 3. Konsumsi record OTP secara bersyarat.
    // Hanya satu request yang dapat mengubah record aktif yang sama.
    const {
        data: consumedRows,
        error: consumeError
    } = await supabase
        .from('otp_auth')
        .update({ is_used: true })
        .eq('id', targetOtp.id)
        .eq('is_used', false)
        .gt('expires_at', nowIso)
        .select('id');

    if (consumeError) {
        console.error(
            '[-] Gagal mengonsumsi OTP secara atomik:',
            consumeError.message
        );

        return {
            valid: false,
            status: 500,
            message:
                'Gagal memverifikasi kode OTP. Silakan coba lagi.'
        };
    }

    if (
        !consumedRows ||
        consumedRows.length !== 1
    ) {
        return {
            valid: false,
            status: 400,
            message:
                'Kode OTP sudah digunakan atau kedaluwarsa!'
        };
    }

    // 4. Nonaktifkan OTP lain yang mungkin masih aktif untuk nomor ini.
    const {
        error: invalidateOtherError
    } = await supabase
        .from('otp_auth')
        .update({ is_used: true })
        .in('no_wa', candidates)
        .eq('is_used', false);

    if (invalidateOtherError) {
        console.error(
            '[-] Gagal menonaktifkan OTP lain setelah verifikasi:',
            invalidateOtherError.message
        );

        return {
            valid: false,
            status: 500,
            message:
                'Gagal menyelesaikan verifikasi OTP. Silakan coba lagi.'
        };
    }

    clearOtpFailures(normalizedPhone);

    return {
        valid: true,
        normalizedPhone
    };
}

/**
 * Memvalidasi struktur path Storage dan mengekstrak object path
 * dari path relatif atau URL objek Supabase pada project yang sama.
 */
export function extractStorageObjectPath(storedPathOrUrl) {
    if (
        !storedPathOrUrl ||
        typeof storedPathOrUrl !== 'string'
    ) {
        return null;
    }

    const trimmed = storedPathOrUrl.trim();

    if (!trimmed) {
        return null;
    }

    let objectPath = '';

    if (/^https?:\/\//i.test(trimmed)) {
        let sourceUrl;
        let configuredUrl;

        try {
            sourceUrl = new URL(trimmed);

            const supabaseUrl =
                process.env.NEXT_PUBLIC_SUPABASE_URL ||
                process.env.SUPABASE_URL;

            if (!supabaseUrl) {
                return null;
            }

            configuredUrl = new URL(supabaseUrl);
        } catch {
            return null;
        }

        // Hanya URL dari origin Supabase yang dikonfigurasi.
        if (sourceUrl.origin !== configuredUrl.origin) {
            return null;
        }

        const prefixes = [
            `/storage/v1/object/public/${STORAGE_BUCKET}/`,
            `/storage/v1/object/sign/${STORAGE_BUCKET}/`
        ];

        const matchedPrefix = prefixes.find((prefix) =>
            sourceUrl.pathname.startsWith(prefix)
        );

        if (!matchedPrefix) {
            return null;
        }

        const encodedPath =
            sourceUrl.pathname.slice(matchedPrefix.length);

        try {
            objectPath = decodeURIComponent(encodedPath);
        } catch {
            return null;
        }
    } else {
        // Jangan memperlakukan URL dengan protokol lain sebagai path relatif.
        if (trimmed.includes('://')) {
            return null;
        }

        objectPath = trimmed.replace(/^\/+/, '');
    }

    if (!objectPath) {
        return null;
    }

    const segments = objectPath.split('/');

    if (
        objectPath.includes('\\') ||
        segments.some(
            (segment) =>
                !segment ||
                segment === '.' ||
                segment === '..'
        ) ||
        /[\u0000-\u001F\u007F]/.test(objectPath)
    ) {
        return null;
    }

    return objectPath;
}

/**
 * Membuat signed URL untuk bucket privat.
 * Jika path tidak valid atau signing gagal, fungsi melempar error
 * dan tidak mengembalikan URL/path sumber sebagai fallback.
 */
export async function createSignedStorageUrl(
    supabase,
    storedPathOrUrl,
    expiresInSec = 3600
) {
    if (
        storedPathOrUrl === null ||
        storedPathOrUrl === undefined ||
        storedPathOrUrl === ''
    ) {
        return null;
    }

    if (
        !Number.isInteger(expiresInSec) ||
        expiresInSec < 1
    ) {
        throw new Error('Masa berlaku signed URL tidak valid.');
    }

    const objectPath = extractStorageObjectPath(
        storedPathOrUrl
    );

    if (!objectPath) {
        throw new Error(
            'Path dokumen tidak valid untuk Storage privat.'
        );
    }

    const {
        data,
        error
    } = await supabase.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(objectPath, expiresInSec);

    if (error) {
        console.error(
            '[-] Gagal membuat signed URL Storage:',
            error.message
        );

        throw new Error('Gagal membuat signed URL dokumen.');
    }

    if (!data?.signedUrl) {
        throw new Error(
            'Supabase tidak mengembalikan signed URL dokumen.'
        );
    }

    return data.signedUrl;
}

/**
 * Pemanggil terpusat API internal WhatsApp Bot.
 * API key wajib tersedia; request tanpa key tidak dikirim.
 */
export async function callWaBotApi(
    endpointPath,
    payload,
    options = {}
) {
    const timeoutMs = options.timeoutMs || 10000;

    const baseUrl = (
        process.env.WA_BOT_API_URL ||
        'http://127.0.0.1:3001'
    ).replace(/\/+$/, '');

    const apiKey =
        process.env.WA_BOT_API_KEY ||
        process.env.INTERNAL_API_KEY ||
        '';

    if (!apiKey) {
        throw new Error(
            'WA_BOT_API_KEY atau INTERNAL_API_KEY wajib dikonfigurasi pada Portal.'
        );
    }

    const correlationId =
        options.correlationId ||
        crypto.randomUUID();

    const timeBucket = Math.floor(Date.now() / 60000);

    const idempotencyKey =
        options.idempotencyKey ||
        crypto
            .createHash('sha256')
            .update(
                `${endpointPath}:${JSON.stringify(payload)}:${timeBucket}`
            )
            .digest('hex');

    const headers = {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'x-correlation-id': correlationId,
        'x-idempotency-key': idempotencyKey
    };

    const maxAttempts =
        options.retryOnNetworkError ? 2 : 1;

    let lastError = null;

    for (
        let attempt = 1;
        attempt <= maxAttempts;
        attempt++
    ) {
        try {
            const res = await fetch(
                `${baseUrl}${endpointPath}`,
                {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(payload),
                    signal: AbortSignal.timeout(timeoutMs)
                }
            );

            let data = {};

            try {
                data = await res.json();
            } catch {
                data = {
                    success: false,
                    message:
                        'Respons layanan WhatsApp Bot tidak valid.'
                };
            }

            const isSuccess =
                res.ok &&
                Boolean(data?.success);

            // Jangan retry respons 4xx atau 503.
            // Respons 5xx lainnya dapat dicoba ulang sesuai konfigurasi.
            if (
                isSuccess ||
                res.status < 500 ||
                res.status === 503 ||
                attempt === maxAttempts
            ) {
                return {
                    ok: isSuccess,
                    status: res.status,
                    correlationId,
                    idempotencyKey,
                    data
                };
            }
        } catch (err) {
            lastError = err;

            if (attempt === maxAttempts) {
                throw err;
            }
        }
    }

    throw (
        lastError ||
        new Error('Gagal menghubungi WhatsApp Bot.')
    );
}