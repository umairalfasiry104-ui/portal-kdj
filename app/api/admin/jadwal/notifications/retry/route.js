import { NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAdminPermission, callWaBotApi } from '@/lib/security';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req) {
  try {
    const body = await req.json().catch(() => null);
    const notificationId = body?.notification_id;
    const confirmUnknown = body?.confirm_unknown === true;

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json(
        { success: false, message: 'Payload retry tidak valid.' },
        { status: 400 }
      );
    }
    if (body.confirm_unknown !== undefined && typeof body.confirm_unknown !== 'boolean') {
      return NextResponse.json(
        { success: false, message: 'confirm_unknown harus berupa boolean.' },
        { status: 400 }
      );
    }
    if (typeof notificationId !== 'string' || !UUID_PATTERN.test(notificationId)) {
      return NextResponse.json(
        { success: false, code: 'INVALID_NOTIFICATION_ID', message: 'ID notifikasi tidak valid.' },
        { status: 400 }
      );
    }

    // FAILED retry may be handled by Konsultan. UNKNOWN requeue requires
    // explicit Super Admin authority because duplicate delivery is possible.
    const requiredPermission = confirmUnknown
      ? 'booking.outbox.resolve_unknown'
      : 'booking.outbox.retry_failed';
    const authCheck = await requireAdminPermission(req, requiredPermission);
    if (!authCheck.authorized) return authCheck.response;

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc('kdj_retry_booking_notification', {
      p_notification_id: notificationId,
      p_confirm_unknown: confirmUnknown
    });

    if (error) throw error;

    if (!data?.ok) {
      const status = data?.code === 'NOTIFICATION_NOT_FOUND' ? 404 : 409;
      return NextResponse.json(
        {
          success: false,
          code: data?.code || 'RETRY_REJECTED',
          message: data?.message || 'Notifikasi belum dapat dicoba ulang.'
        },
        { status }
      );
    }

    let wakeRequested = false;
    let wakeError = null;
    try {
      const wakeResult = await callWaBotApi(
        '/process-booking-notifications',
        { limit: 5 },
        { timeoutMs: 5000, retryOnNetworkError: false, correlationId: notificationId }
      );
      wakeRequested = Boolean(wakeResult?.ok);
      if (!wakeRequested) {
        wakeError = wakeResult?.data?.message ||
          `Bot worker belum menerima wake-up (HTTP ${wakeResult?.status ?? 'unknown'}).`;
      }
    } catch (wakeErrorResult) {
      wakeError = typeof wakeErrorResult?.message === 'string'
        ? wakeErrorResult.message.slice(0, 1000)
        : 'Bot belum dapat dihubungi.';
    }

    return NextResponse.json({
      success: true,
      notification_id: notificationId,
      notification_status: 'PENDING',
      wake_requested: wakeRequested,
      wake_error: wakeError,
      message: wakeRequested
        ? 'Permintaan retry diterima. Perbarui daftar jadwal untuk melihat status pengiriman.'
        : 'Notifikasi masuk antrean ulang. Bot akan memproses ketika tersedia.'
    });
  } catch (error) {
    console.error('[-] Error /api/admin/jadwal/notifications/retry:', error?.code, error?.message);
    return NextResponse.json(
      { success: false, message: 'Gagal memproses retry notifikasi.' },
      { status: 500 }
    );
  }
}
