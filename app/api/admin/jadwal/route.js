import { NextResponse } from 'next/server';
import {
    getSupabaseAdmin,
    requireAdminPermission,
    callWaBotApi,
    normalizePhoneLocal
} from '@/lib/security';

const ALLOWED_JADWAL_STATUS = ['Terjadwal', 'Selesai', 'Batal'];
const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;

function normalizeScheduleMethod(rawMethod) {
    if (typeof rawMethod !== 'string') return null;

    const method = rawMethod.trim().toUpperCase();

    if (method === 'ZOOM') return 'Zoom';
    if (method === 'OFFLINE' || method === 'DATANG KE KANTOR') {
        return 'Offline';
    }

    return null;
}

/**
 * Accept only an explicit Jakarta wall-clock timestamp.
 * UI format: YYYY-MM-DDTHH:mm:00+07:00.
 * This avoids interpreting the browser or server's local timezone.
 */
function normalizeJakartaTimestamp(rawValue) {
    if (typeof rawValue !== 'string') return null;

    const match = rawValue.trim().match(
        /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::00)?\+07:00$/
    );

    if (!match) return null;

    const [, year, month, day, hour, minute] = match;
    const wallClock = `${year}-${month}-${day}T${hour}:${minute}`;
    const epoch = Date.parse(`${wallClock}:00+07:00`);

    if (!Number.isFinite(epoch)) return null;

    const shifted = new Date(epoch + JAKARTA_OFFSET_MS);
    const normalizedWallClock = [
        String(shifted.getUTCFullYear()).padStart(4, '0'),
        String(shifted.getUTCMonth() + 1).padStart(2, '0'),
        String(shifted.getUTCDate()).padStart(2, '0')
    ].join('-') + 'T' + [
        String(shifted.getUTCHours()).padStart(2, '0'),
        String(shifted.getUTCMinutes()).padStart(2, '0')
    ].join(':');

    if (normalizedWallClock !== wallClock) return null;

    return `${wallClock}:00+07:00`;
}

function getRpcHttpStatus(code) {
    switch (code) {
        case 'BOOKING_NOT_FOUND':
            return 404;
        case 'SLOT_UNAVAILABLE':
        case 'IDEMPOTENCY_KEY_REUSED':
            return 409;
        case 'INVALID_PHONE':
        case 'INVALID_NAME':
        case 'INVALID_DATETIME':
        case 'INVALID_METHOD':
        case 'INVALID_IDEMPOTENCY_KEY':
            return 400;
        case 'BOOKING_REQUIRES_PREVIOUS_DAY':
            return 422;
        case 'SLOT_UNAVAILABLE':
            return 409;
        case 'ADMIN_SLOT_MUST_BE_FUTURE':
        case 'CLOSED_DAY':
        case 'OUTSIDE_WORKING_HOURS':
            return 422;
        case 'INVALID_BOOKING_ID':
        case 'INVALID_STATUS':
        case 'INVALID_METHOD':
        case 'NO_CHANGES':
            return 400;
        case 'INACTIVE_BOOKING_CANNOT_BE_RESCHEDULED':
            return 409;
        default:
            return 422;
    }
}

export async function GET(req) {
    try {
        const authCheck = await requireAdminPermission(req, 'booking.read');
        if (!authCheck.authorized) {
            return authCheck.response;
        }

        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
            .from('jadwal_konsultasi')
            .select(
                'id, no_wa, nama_leads, metode, jadwal_pilihan, waktu_selesai, blokir_sampai, status, notification_status, notification_sent_at, latest_notification_id, updated_at'
            )
            .order('jadwal_pilihan', { ascending: false });

        if (error) throw error;

        const bookingRows = data || [];
        const bookingIds = bookingRows.map((row) => row.id);
        let notificationRows = [];

        // Ambil histori Outbox untuk daftar notifikasi yang perlu ditindaklanjuti.
        if (bookingIds.length > 0) {
            const { data: outboxRows, error: outboxError } = await supabase
                .from('booking_notification_outbox')
                .select('id, booking_id, event_type, status, attempts, next_attempt_at, last_error, created_at, sent_at')
                .in('booking_id', bookingIds)
                .order('created_at', { ascending: false });

            if (outboxError) throw outboxError;
            notificationRows = outboxRows || [];
        }

        // Ambil target pointer secara langsung berdasarkan ID.
        const latestNotificationIds = [
            ...new Set(
                bookingRows
                    .map((row) => row.latest_notification_id)
                    .filter((id) => typeof id === 'string' && id.length > 0)
            )
        ];

        let latestNotificationRows = [];

        if (latestNotificationIds.length > 0) {
            const {
                data: pointerRows,
                error: pointerError
            } = await supabase
                .from('booking_notification_outbox')
                .select('id, booking_id, event_type, status, attempts, next_attempt_at, last_error, created_at, sent_at')
                .in('id', latestNotificationIds);

            if (pointerError) throw pointerError;
            latestNotificationRows = pointerRows || [];
        }

        const eventsByBooking = new Map();
        const attentionByBooking = new Map();

        for (const event of notificationRows) {
            const bookingEvents = eventsByBooking.get(event.booking_id) || [];
            bookingEvents.push(event);
            eventsByBooking.set(event.booking_id, bookingEvents);

            if (['FAILED', 'UNKNOWN'].includes(event.status)) {
                const attentionEvents = attentionByBooking.get(event.booking_id) || [];
                attentionEvents.push(event);
                attentionByBooking.set(event.booking_id, attentionEvents);
            }
        }

        const latestNotificationById = new Map(
            latestNotificationRows.map((event) => [event.id, event])
        );

        const enrichedRows = bookingRows.map((row) => {
            const bookingEvents = eventsByBooking.get(row.id) || [];
            const pointerId = row.latest_notification_id;

            let latestNotification = null;
            let notificationIntegrity = null;

            if (pointerId) {
                const pointerEvent = latestNotificationById.get(pointerId);

                if (!pointerEvent) {
                    notificationIntegrity = {
                        code: 'POINTER_TARGET_NOT_FOUND',
                        message: 'latest_notification_id menunjuk event Outbox yang tidak ditemukan.'
                    };
                } else if (pointerEvent.booking_id !== row.id) {
                    notificationIntegrity = {
                        code: 'POINTER_BOOKING_MISMATCH',
                        message: 'Event Outbox yang ditunjuk bukan milik booking ini.'
                    };
                } else if (pointerEvent.status === 'SUPERSEDED') {
                    notificationIntegrity = {
                        code: 'POINTER_TARGET_SUPERSEDED',
                        message: 'latest_notification_id menunjuk event SUPERSEDED, bukan event aktif.'
                    };
                } else {
                    latestNotification = pointerEvent;
                }
            } else if (bookingEvents.length > 0) {
                notificationIntegrity = {
                    code: 'POINTER_MISSING_WITH_EVENTS',
                    message: 'Booking memiliki event Outbox tetapi latest_notification_id kosong.'
                };
            }

            let notificationStatusSource = 'NONE';

            if (notificationIntegrity) {
                notificationStatusSource = 'INTEGRITY_WARNING';
            } else if (latestNotification) {
                notificationStatusSource = 'OUTBOX';
            } else if (bookingEvents.length === 0 && row.notification_status) {
                notificationStatusSource = 'LEGACY_SUMMARY';
            }

            const alertEvents = [
                ...(attentionByBooking.get(row.id) || [])
            ];

            if (
                latestNotification &&
                ['FAILED', 'UNKNOWN'].includes(latestNotification.status) &&
                !alertEvents.some((event) => event.id === latestNotification.id)
            ) {
                alertEvents.unshift(latestNotification);
            }

            return {
                ...row,
                latest_notification: latestNotification,
                notification_integrity: notificationIntegrity,
                notification_status_source: notificationStatusSource,
                notification_alerts: alertEvents.map((event) => ({
                    ...event,
                    is_latest: event.id === row.latest_notification_id
                }))
            };
        });

        return NextResponse.json({ success: true, data: enrichedRows });
    } catch (error) {
        console.error('[-] Error /api/admin/jadwal GET:', error.code, error.message);
        return NextResponse.json(
            { success: false, message: 'Gagal memuat jadwal konsultasi.' },
            { status: 500 }
        );
    }
}

export async function POST(req) {
    try {
        const body = await req.json().catch(() => null);

        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            return NextResponse.json(
                { success: false, message: 'Payload pembaruan jadwal tidak valid.' },
                { status: 400 }
            );
        }

        const { action, id, no_wa, nama_leads } = body;
        if (action !== undefined && action !== 'CREATE') {
            return NextResponse.json(
                { success: false, message: 'Aksi jadwal tidak dikenal.' },
                { status: 400 }
            );
        }

        const requiredPermission = action === 'CREATE' ? 'booking.create' : 'booking.manage';
        const authCheck = await requireAdminPermission(req, requiredPermission);
        if (!authCheck.authorized) return authCheck.response;

        const supabase = getSupabaseAdmin();

        // Manual create uses the existing transactional Scheduling V2 RPC.
        // The RPC creates the booking and BOOKING_CREATED Outbox event atomically.
        if (action === 'CREATE') {
            const cleanPhone = normalizePhoneLocal(no_wa);
            const cleanName = typeof nama_leads === 'string' ? nama_leads.trim() : '';
            const normalizedSchedule = normalizeJakartaTimestamp(body.jadwal_pilihan);
            const requestedMethod = normalizeScheduleMethod(body.metode) || 'Zoom';
            const rawIdempotencyKey = req.headers.get('x-idempotency-key') || '';
            const idempotencyKey = `admin-create:${rawIdempotencyKey.trim()}`;

            if (!cleanPhone || !cleanName || cleanName.length > 120 || !normalizedSchedule) {
                return NextResponse.json(
                    { success: false, message: 'Nomor WA valid, nama leads (maksimal 120 karakter), dan waktu WIB wajib diisi.' },
                    { status: 400 }
                );
            }
            if (!/^[A-Za-z0-9:_-]{8,200}$/.test(rawIdempotencyKey.trim())) {
                return NextResponse.json(
                    { success: false, code: 'INVALID_IDEMPOTENCY_KEY', message: 'Kunci idempotensi permintaan tidak valid. Muat ulang form lalu coba kembali.' },
                    { status: 400 }
                );
            }
            if (body.status !== undefined && body.status !== null && body.status !== 'Terjadwal') {
                return NextResponse.json(
                    { success: false, message: 'Booking baru harus dimulai dengan status Terjadwal.' },
                    { status: 400 }
                );
            }

            const { data: rpcResult, error: rpcError } = await supabase.rpc('kdj_create_booking', {
                p_no_wa: cleanPhone,
                p_nama_leads: cleanName,
                p_metode: requestedMethod,
                p_jadwal_pilihan: normalizedSchedule,
                p_idempotency_key: idempotencyKey
            });

            if (rpcError) {
                console.error('[-] RPC kdj_create_booking untuk admin gagal:', rpcError.code, rpcError.message);
                throw rpcError;
            }
            if (!rpcResult || typeof rpcResult !== 'object') {
                throw new Error('RPC kdj_create_booking mengembalikan respons yang tidak valid.');
            }
            if (rpcResult.ok !== true) {
                const code = rpcResult.code || 'BOOKING_CREATE_FAILED';
                return NextResponse.json(
                    { success: false, code, message: rpcResult.message || 'Database menolak pembuatan jadwal.' },
                    { status: getRpcHttpStatus(code) }
                );
            }

            const notificationEventId = rpcResult.notification_event_id || null;
            let notificationStatus = rpcResult.notification_status || rpcResult.notification_event_status || null;
            let notificationError = null;

            if (notificationEventId) {
                try {
                    const wakeResult = await callWaBotApi(
                        '/process-booking-notifications',
                        { limit: 5 },
                        { timeoutMs: 5000, retryOnNetworkError: false, correlationId: notificationEventId }
                    );
                    if (!wakeResult?.ok) {
                        notificationError = wakeResult?.data?.message ||
                            `Bot worker belum menerima wake-up (HTTP ${wakeResult?.status ?? 'unknown'}); event tetap berada di antrean.`;
                    }
                } catch (wakeError) {
                    notificationError = typeof wakeError?.message === 'string'
                        ? wakeError.message.slice(0, 1000)
                        : 'Bot belum dapat dihubungi; event tetap berada di antrean.';
                }

                const { data: eventRow, error: eventLookupError } = await supabase
                    .from('booking_notification_outbox')
                    .select('status, last_error')
                    .eq('id', notificationEventId)
                    .maybeSingle();
                if (eventLookupError) {
                    console.error('[-] Gagal membaca status Outbox booking manual:', eventLookupError.message);
                    notificationStatus = notificationStatus || 'PENDING';
                } else {
                    notificationStatus = eventRow?.status || notificationStatus || 'PENDING';
                    notificationError = eventRow?.last_error || notificationError;
                }
            }

            return NextResponse.json({
                success: true,
                message: notificationStatus === 'SENT'
                    ? 'Jadwal manual berhasil dibuat dan WhatsApp mengonfirmasi notifikasi.'
                    : 'Jadwal manual berhasil dibuat. Notifikasi tercatat di Outbox dan akan diproses Bot.',
                booking: rpcResult,
                notification_event_id: notificationEventId,
                notification_status: notificationStatus,
                notification_error: notificationError,
                wa_notified: notificationStatus === 'SENT'
            });
        }

        // 2. PENANGANAN UPDATE / RESCHEDULE / STATUS BERDASARKAN ID
        const hasStatus = body.status !== undefined && body.status !== null;
        const hasRequestedSchedule =
            body.jadwal_pilihan !== undefined &&
            body.jadwal_pilihan !== null &&
            body.jadwal_pilihan !== '';
        const hasRequestedMethod =
            body.metode !== undefined &&
            body.metode !== null &&
            body.metode !== '';

        if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
            return NextResponse.json(
                { success: false, message: 'ID jadwal tidak valid.' },
                { status: 400 }
            );
        }

        if (!hasStatus && !hasRequestedSchedule && !hasRequestedMethod) {
            return NextResponse.json(
                { success: false, code: 'NO_CHANGES', message: 'Tidak ada perubahan jadwal yang dikirim.' },
                { status: 400 }
            );
        }

        if (hasStatus && !ALLOWED_JADWAL_STATUS.includes(body.status)) {
            return NextResponse.json(
                { success: false, message: 'Status jadwal tidak valid.' },
                { status: 400 }
            );
        }

        const normalizedSchedule = hasRequestedSchedule
            ? normalizeJakartaTimestamp(body.jadwal_pilihan)
            : null;

        if (hasRequestedSchedule && !normalizedSchedule) {
            return NextResponse.json(
                {
                    success: false,
                    message: 'Tanggal dan jam harus berupa waktu Jakarta yang valid (format WIB, UTC+07:00).'
                },
                { status: 400 }
            );
        }

        const requestedMethod = hasRequestedMethod
            ? normalizeScheduleMethod(body.metode)
            : null;

        if (hasRequestedMethod && !requestedMethod) {
            return NextResponse.json(
                { success: false, message: 'Metode konsultasi hanya Zoom atau Offline.' },
                { status: 400 }
            );
        }

        const {
            data: currentBooking,
            error: lookupError
        } = await supabase
            .from('jadwal_konsultasi')
            .select('id, no_wa, nama_leads, jadwal_pilihan, metode, status')
            .eq('id', id)
            .maybeSingle();

        if (lookupError) throw lookupError;

        if (!currentBooking) {
            return NextResponse.json(
                { success: false, code: 'BOOKING_NOT_FOUND', message: 'Data jadwal tidak ditemukan.' },
                { status: 404 }
            );
        }

        const effectiveStatus = hasStatus
            ? body.status
            : (currentBooking.status || 'Terjadwal');

        if (
            (hasRequestedSchedule || hasRequestedMethod) &&
            effectiveStatus !== 'Terjadwal'
        ) {
            return NextResponse.json(
                {
                    success: false,
                    code: 'INACTIVE_BOOKING_CANNOT_BE_RESCHEDULED',
                    message: 'Hanya booking dengan status Terjadwal yang dapat diubah tanggal, jam, atau metodenya. Ubah status menjadi Terjadwal terlebih dahulu jika booking memang akan diaktifkan kembali.'
                },
                { status: 409 }
            );
        }

        const { data: rpcResult, error: rpcError } = await supabase.rpc(
            'kdj_admin_update_booking',
            {
                p_booking_id: id,
                p_status: hasStatus ? body.status : null,
                p_jadwal_pilihan: normalizedSchedule,
                p_metode: requestedMethod
            }
        );

        if (rpcError) {
            console.error(
                '[-] RPC kdj_admin_update_booking gagal:',
                rpcError.code,
                rpcError.message
            );
            throw rpcError;
        }

        if (!rpcResult || typeof rpcResult !== 'object') {
            throw new Error('RPC kdj_admin_update_booking mengembalikan respons yang tidak valid.');
        }

        if (rpcResult.ok !== true) {
            const code = rpcResult.code || 'BOOKING_UPDATE_FAILED';
            return NextResponse.json(
                {
                    success: false,
                    code,
                    message: rpcResult.message || 'Perubahan jadwal ditolak oleh database.'
                },
                { status: getRpcHttpStatus(code) }
            );
        }

        const notificationEventId = rpcResult.notification_event_id || null;
        let notificationStatus = null;
        let notificationError = null;

        if (rpcResult.notification_required === true) {
            if (!notificationEventId) {
                console.error(
                    '[-] Booking berubah, tetapi RPC tidak mengembalikan notification_event_id.'
                );
                notificationStatus = 'NOT_QUEUED';
                notificationError = 'Database belum mengonfirmasi pembuatan event outbox.';
            } else {
                try {
                    const wakeResult = await callWaBotApi(
                        '/process-booking-notifications',
                        { limit: 5 },
                        {
                            timeoutMs: 5000,
                            retryOnNetworkError: false,
                            correlationId: notificationEventId
                        }
                    );
                    if (!wakeResult?.ok) {
                        notificationError = wakeResult?.data?.message ||
                            `Bot worker belum menerima wake-up (HTTP ${wakeResult?.status ?? 'unknown'}); event tetap berada di antrean.`;
                    }
                } catch (wakeError) {
                    notificationError = typeof wakeError?.message === 'string'
                        ? wakeError.message.slice(0, 1000)
                        : 'Bot belum dapat dihubungi; event tetap berada di antrean.';
                }
                if (notificationError) {
                    console.warn('[-] Wake-up Bot belum berhasil; outbox tetap pending:', notificationError);
                }

                const { data: eventRow, error: eventLookupError } = await supabase
                    .from('booking_notification_outbox')
                    .select('status, last_error')
                    .eq('id', notificationEventId)
                    .maybeSingle();

                if (eventLookupError) {
                    console.error('[-] Gagal membaca status event outbox:', eventLookupError.message);
                    notificationStatus = 'PENDING';
                } else {
                    notificationStatus = eventRow?.status || 'PENDING';
                    notificationError = eventRow?.last_error || notificationError;
                }
            }
        }

        const waNotified = notificationStatus === 'SENT';
        const message = !rpcResult.notification_required
            ? 'Jadwal berhasil diperbarui.'
            : notificationStatus === 'SENT'
                ? 'Jadwal berhasil diperbarui dan WhatsApp Bot mengonfirmasi pengiriman notifikasi.'
                : notificationStatus === 'FAILED'
                    ? 'Jadwal berhasil diperbarui, tetapi notifikasi gagal. Admin dapat mencoba ulang dari kartu jadwal.'
                    : notificationStatus === 'UNKNOWN'
                        ? 'Jadwal berhasil diperbarui. Hasil pengiriman WhatsApp belum dapat dipastikan; periksa chat penerima sebelum mencoba ulang.'
                        : notificationStatus === 'NOT_QUEUED'
                            ? 'Jadwal tersimpan, tetapi event notifikasi tidak terkonfirmasi. Periksa migration database sebelum melanjutkan.'
                            : 'Jadwal tersimpan dan notifikasi masuk antrean. Bot akan mengirim saat tersedia.';

        return NextResponse.json({
            success: true,
            booking: rpcResult,
            notification_event_id: notificationEventId,
            wa_notified: notificationEventId ? waNotified : null,
            notification_status: notificationStatus,
            notification_error: notificationError,
            message
        });
    } catch (error) {
        console.error(
            '[-] Error /api/admin/jadwal POST:',
            error.code,
            error.message
        );

        return NextResponse.json(
            { success: false, message: 'Gagal memperbarui jadwal konsultasi.' },
            { status: 500 }
        );
    }
}