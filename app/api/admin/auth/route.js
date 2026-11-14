import { NextResponse } from 'next/server';
import {
  getSupabaseAdmin,
  checkSharedRateLimit,
  getClientIpAddress,
  SHARED_AUTH_RATE_LIMITS,
  checkSharedAuthLock,
  recordSharedAuthFailure,
  clearSharedAuthFailures,
  verifyAdminPassword,
  setAdminSessionCookie,
  setAdminPasswordChangeSessionCookie,
  clearSessionCookie,
  ADMIN_COOKIE_NAME,
  isCanonicalAdminRole,
  requireAdminPermission
} from '@/lib/security';

const DISABLED_PORTAL_LIFECYCLE_ACTIONS = new Set([
  'add_admin',
  'disable_admin',
  'replace_admin',
  'delete_admin'
]);

const USERNAME_PATTERN = /^[a-z0-9._-]{3,64}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeAdminIdentifier(rawIdentifier) {
  if (typeof rawIdentifier !== 'string') return null;
  const trimmed = rawIdentifier.trim().toLowerCase();
  if (!trimmed || trimmed.length > 254) return null;

  if (trimmed.includes('@')) {
    return EMAIL_PATTERN.test(trimmed)
      ? { type: 'email', value: trimmed }
      : null;
  }

  return USERNAME_PATTERN.test(trimmed)
    ? { type: 'username', value: trimmed }
    : null;
}

function toAdminDirectoryItem(admin) {
  if (!admin) return null;
  return {
    id: admin.id,
    username: admin.username || null,
    email: admin.email || null,
    no_wa: admin.no_wa || null,
    nama_admin: admin.nama_admin,
    role: admin.role,
    is_active: admin.is_active,
    created_at: admin.created_at,
    disabled_at: admin.disabled_at ?? null
  };
}

function toAdminSessionClientDto(admin) {
  if (!admin) return null;
  return {
    id: admin.id,
    username: admin.username || null,
    email: admin.email || null,
    no_wa: admin.no_wa || null,
    nama_admin: admin.nama_admin,
    role: admin.role,
    is_active: admin.is_active,
    must_change_password: admin.must_change_password === true
  };
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => null);
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      typeof body.action !== 'string'
    ) {
      return NextResponse.json(
        { success: false, message: 'Aksi atau payload tidak valid.' },
        { status: 400 }
      );
    }

    const { action } = body;

    if (DISABLED_PORTAL_LIFECYCLE_ACTIONS.has(action)) {
      return NextResponse.json(
        {
          success: false,
          code: 'ADMIN_LIFECYCLE_SUPABASE_ONLY',
          message: 'Pengelolaan akun Admin hanya dapat dilakukan melalui Supabase.'
        },
        { status: 403 }
      );
    }

    if (action === 'logout') {
      const response = NextResponse.json({
        success: true,
        message: 'Logout berhasil.'
      });
      clearSessionCookie(response, ADMIN_COOKIE_NAME);
      return response;
    }

    if (action === 'check_admin' || action === 'verify_admin_otp') {
      return NextResponse.json(
        {
          success: false,
          code: 'ADMIN_OTP_DEPRECATED',
          message: 'Login Admin kini menggunakan Username/Email dan Password.'
        },
        { status: 400 }
      );
    }

    if (action === 'login_admin') {
      const supabase = getSupabaseAdmin();
      const clientIp = getClientIpAddress(req);
      const ipRateLimit = SHARED_AUTH_RATE_LIMITS.adminLoginIp;
      const ipRateCheck = await checkSharedRateLimit(
        supabase,
        ipRateLimit.scope,
        clientIp,
        ipRateLimit.maxRequests,
        ipRateLimit.windowMs
      );

      if (!ipRateCheck.allowed) {
        return NextResponse.json(
          {
            success: false,
            message: 'Terlalu banyak percobaan login. Silakan coba lagi nanti.'
          },
          {
            status: 429,
            headers: {
              'Retry-After': String(ipRateCheck.retryAfterSec)
            }
          }
        );
      }

      const parsedIdentifier = normalizeAdminIdentifier(
        body.identifier ?? body.username ?? body.email
      );
      const rawPassword = typeof body.password === 'string' ? body.password : '';

      if (!parsedIdentifier || !rawPassword || rawPassword.length > 200) {
        return NextResponse.json(
          {
            success: false,
            message: 'Username/Email dan Password wajib diisi dengan format yang valid.'
          },
          { status: 400 }
        );
      }

      const bruteCheck = await checkSharedAuthLock(
        supabase,
        'admin-login-account',
        parsedIdentifier.value
      );

      if (bruteCheck.locked) {
        return NextResponse.json(
          {
            success: false,
            message: `Terlalu banyak percobaan password salah. Silakan tunggu ${bruteCheck.retryAfterSec} detik.`
          },
          {
            status: 429,
            headers: {
              'Retry-After': String(bruteCheck.retryAfterSec)
            }
          }
        );
      }

      let adminQuery = supabase
        .from('admins')
        .select(
          'id, username, email, no_wa, nama_admin, role, password_hash, created_at, is_active, session_version, must_change_password'
        );

      if (parsedIdentifier.type === 'email') {
        adminQuery = adminQuery.ilike('email', parsedIdentifier.value);
      } else {
        adminQuery = adminQuery.ilike('username', parsedIdentifier.value);
      }

      const { data: admin, error: adminQueryError } = await adminQuery.maybeSingle();

      if (adminQueryError) {
        console.error('[-] Gagal memeriksa akun Admin:', adminQueryError.message);
        return NextResponse.json(
          {
            success: false,
            message: 'Tidak dapat memverifikasi akses Admin saat ini.'
          },
          { status: 500 }
        );
      }

      const isPasswordValid =
        admin &&
        typeof admin.password_hash === 'string' &&
        await verifyAdminPassword(rawPassword, admin.password_hash);

      if (!admin || !isPasswordValid) {
        await recordSharedAuthFailure(
          supabase,
          'admin-login-account',
          parsedIdentifier.value,
          5,
          10 * 60 * 1000
        );
        return NextResponse.json(
          {
            success: false,
            message: 'Username/Email atau Password salah.'
          },
          { status: 401 }
        );
      }

      if (admin.is_active !== true) {
        return NextResponse.json(
          {
            success: false,
            message: 'Akun Admin sudah dinonaktifkan.'
          },
          { status: 403 }
        );
      }

      if (!isCanonicalAdminRole(admin.role)) {
        return NextResponse.json(
          {
            success: false,
            message: 'Role akun Admin tidak valid. Akses ditolak.'
          },
          { status: 403 }
        );
      }

      const sessionVersion = Number(admin.session_version);
      if (!Number.isSafeInteger(sessionVersion) || sessionVersion < 1) {
        console.error('[-] session_version Admin tidak valid:', admin.id);
        return NextResponse.json(
          {
            success: false,
            message: 'Konfigurasi sesi Admin tidak valid.'
          },
          { status: 500 }
        );
      }

      await clearSharedAuthFailures(
        supabase,
        'admin-login-account',
        parsedIdentifier.value
      );

      const mustChangePassword = admin.must_change_password === true;
      const response = NextResponse.json({
        success: true,
        must_change_password: mustChangePassword,
        admin: toAdminSessionClientDto(admin)
      });

      if (mustChangePassword) {
        setAdminPasswordChangeSessionCookie(response, admin);
      } else {
        setAdminSessionCookie(response, admin);
      }
      return response;
    }

    return NextResponse.json(
      { success: false, message: 'Aksi tidak dikenal.' },
      { status: 400 }
    );
  } catch (error) {
    console.error('[-] Error /api/admin/auth POST:', error.message);
    return NextResponse.json(
      { success: false, message: 'Terjadi kesalahan internal pada server.' },
      { status: 500 }
    );
  }
}

export async function GET(req) {
  try {
    const authCheck = await requireAdminPermission(req, 'admin.directory.read');
    if (!authCheck.authorized) {
      return authCheck.response;
    }

    const supabase = getSupabaseAdmin();
    const { data: admins, error } = await supabase
      .from('admins')
      .select('id, username, email, no_wa, nama_admin, role, is_active, created_at, disabled_at')
      .order('created_at', { ascending: true });

    if (error) throw error;

    return NextResponse.json({
      success: true,
      admins: (admins || []).map(toAdminDirectoryItem)
    });
  } catch (error) {
    console.error('[-] Error /api/admin/auth GET:', error.message);
    return NextResponse.json(
      { success: false, message: 'Gagal memuat daftar Admin.' },
      { status: 500 }
    );
  }
}