import { NextResponse } from 'next/server';
import {
  ADMIN_COOKIE_NAME,
  SHARED_AUTH_RATE_LIMITS,
  checkSharedAuthLock,
  checkSharedRateLimit,
  clearSharedAuthFailures,
  getClientIpAddress,
  getSupabaseAdmin,
  hashAdminPassword,
  isCanonicalAdminRole,
  isValidAdminPassword,
  recordSharedAuthFailure,
  setAdminSessionCookie,
  verifyAdminPassword,
  verifySessionToken
} from '@/lib/security';

function jsonError(message, status = 400, code) {
  return NextResponse.json({
    success: false,
    message,
    ...(code ? { code } : {})
  }, { status });
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return jsonError('Payload perubahan password tidak valid.', 400);
    }

    const currentPassword = typeof body.current_password === 'string'
      ? body.current_password
      : '';
    const newPassword = typeof body.new_password === 'string'
      ? body.new_password
      : '';
    const confirmPassword = typeof body.confirm_password === 'string'
      ? body.confirm_password
      : '';

    if (!currentPassword || !newPassword || !confirmPassword) {
      return jsonError('Password saat ini, password baru, dan konfirmasi wajib diisi.', 400);
    }
    if (newPassword !== confirmPassword) {
      return jsonError('Konfirmasi password baru tidak sama.', 422, 'PASSWORD_CONFIRMATION_MISMATCH');
    }
    if (!isValidAdminPassword(newPassword)) {
      return jsonError('Password baru harus 14–128 karakter dan maksimal 512 byte UTF-8.', 422, 'PASSWORD_POLICY_FAILED');
    }
    if (newPassword === currentPassword) {
      return jsonError('Password baru harus berbeda dari password saat ini.', 422, 'PASSWORD_UNCHANGED');
    }

    const ipLimit = SHARED_AUTH_RATE_LIMITS.adminPasswordChangeIp;
    const supabase = getSupabaseAdmin();
    const rate = await checkSharedRateLimit(
      supabase,
      ipLimit.scope,
      getClientIpAddress(req),
      ipLimit.maxRequests,
      ipLimit.windowMs
    );
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, message: 'Terlalu banyak permintaan perubahan password. Coba lagi nanti.' },
        { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } }
      );
    }

    const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
    const session = verifySessionToken(token);
    if (
      !session ||
      !['admin', 'admin_password_change'].includes(session.type) ||
      typeof session.sub !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(session.sub)
    ) {
      return jsonError('Sesi Admin tidak valid atau sudah kedaluwarsa. Login kembali.', 401, 'ADMIN_SESSION_INVALID');
    }

    const { data: admin, error: adminError } = await supabase
      .from('admins')
      .select('id, username, email, no_wa, nama_admin, role, is_active, password_hash, must_change_password, session_version')
      .eq('id', session.sub)
      .maybeSingle();

    if (adminError) throw adminError;
    if (!admin || admin.is_active !== true || !isCanonicalAdminRole(admin.role)) {
      return jsonError('Akun Admin tidak ditemukan, tidak aktif, atau role tidak valid.', 401);
    }

    const currentSessionVersion = Number(admin.session_version);
    if (
      !Number.isSafeInteger(currentSessionVersion) ||
      currentSessionVersion < 1 ||
      Number(session.session_version) !== currentSessionVersion
    ) {
      return jsonError('Sesi Admin sudah dicabut. Login kembali.', 401, 'ADMIN_SESSION_REVOKED');
    }

    const isFirstLoginChange = admin.must_change_password === true;
    if (
      (isFirstLoginChange && session.type !== 'admin_password_change') ||
      (!isFirstLoginChange && session.type !== 'admin')
    ) {
      return jsonError(
        'Sesi ini tidak dapat digunakan untuk perubahan password. Login kembali.',
        401,
        'ADMIN_PASSWORD_FLOW_INVALID'
      );
    }

    const lockScope = 'admin-password-change-account';
    const lock = await checkSharedAuthLock(supabase, lockScope, admin.id);
    if (lock.locked) {
      return NextResponse.json(
        { success: false, message: `Terlalu banyak password salah. Coba lagi dalam ${lock.retryAfterSec} detik.` },
        { status: 429, headers: { 'Retry-After': String(lock.retryAfterSec) } }
      );
    }

    const passwordValid = await verifyAdminPassword(currentPassword, admin.password_hash);
    if (!passwordValid) {
      await recordSharedAuthFailure(supabase, lockScope, admin.id, 5, 10 * 60 * 1000);
      return jsonError('Password saat ini salah.', 401, 'CURRENT_PASSWORD_INVALID');
    }

    const nextHash = await hashAdminPassword(newPassword);
    const nextSessionVersion = currentSessionVersion + 1;
    const { data: updatedAdmin, error: updateError } = await supabase
      .from('admins')
      .update({
        password_hash: nextHash,
        must_change_password: false,
        session_version: nextSessionVersion,
        updated_at: new Date().toISOString()
      })
      .eq('id', admin.id)
      .eq('session_version', currentSessionVersion)
      .eq('password_hash', admin.password_hash)
      .select('id, username, email, no_wa, nama_admin, role, is_active, session_version, must_change_password')
      .maybeSingle();

    if (updateError) throw updateError;
    if (!updatedAdmin) {
      return jsonError('Data akun berubah selama proses. Login kembali dan ulangi.', 409, 'ADMIN_PASSWORD_CONFLICT');
    }

    await clearSharedAuthFailures(supabase, lockScope, admin.id);

    const response = NextResponse.json({
      success: true,
      message: 'Password Admin berhasil diperbarui. Sesi lama telah dicabut.',
      admin: {
        id: updatedAdmin.id,
        username: updatedAdmin.username || null,
        email: updatedAdmin.email || null,
        no_wa: updatedAdmin.no_wa || null,
        nama_admin: updatedAdmin.nama_admin,
        role: updatedAdmin.role,
        is_active: updatedAdmin.is_active,
        must_change_password: false
      }
    });
    setAdminSessionCookie(response, updatedAdmin);
    return response;
  } catch (error) {
    console.error('[-] Error /api/admin/auth/change-password:', error?.message || 'UNKNOWN_ERROR');
    return jsonError('Gagal mengubah password Admin. Silakan coba kembali.', 500);
  }
}
