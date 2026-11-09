import { NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAdminSession } from '@/lib/security';

function jakartaDate(value = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(value);
}

function parseDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [year, month, day] = value.split('-').map(Number);
    const check = new Date(Date.UTC(year, month - 1, day));
    return check.getUTCFullYear() === year &&
        check.getUTCMonth() + 1 === month &&
        check.getUTCDate() === day ? value : null;
}

function count(value) {
    const parsed = Number(value || 0);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function countText(value) {
    return count(value).toLocaleString('id-ID');
}

function summarize(reportDate, stats) {
    const events = stats.bot_events || {};
    const leads = stats.lead_events || {};
    const bookingEvents = stats.booking_events || {};
    const bookingStatuses = stats.booking_notification_current_status || {};
    const fuStatuses = stats.followup_jobs_current_status || {};
    const coverageAt = stats.coverage_started_at ? new Date(stats.coverage_started_at) : null;
    const coverageDate = coverageAt && !Number.isNaN(coverageAt.getTime()) ? jakartaDate(coverageAt) : null;
    const coverageNote = !coverageDate
        ? 'Waktu aktivasi ledger belum tersedia; angka historis tidak boleh diasumsikan lengkap.'
        : reportDate < coverageDate
            ? `Ledger baru aktif ${coverageDate}; data historis untuk tanggal ini tidak tersedia dan tidak dibuat secara retroaktif.`
            : reportDate === coverageDate
                ? `Ledger mulai aktif ${new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' }).format(coverageAt)} WIB; laporan hanya mencakup waktu setelah aktivasi.`
                : 'Ledger aktif sepanjang tanggal laporan; data sebelum aktivasi tidak dibuat secara retroaktif.';
    const heartbeatRows = Array.isArray(stats.heartbeats_latest) ? stats.heartbeats_latest : [];
    const heartbeatSummary = heartbeatRows.length
        ? heartbeatRows.map((item) => `${item.component}: ${item.status || 'UNKNOWN'}`).join(' · ')
        : 'Belum ada heartbeat';
    const adminLeadActions = count(leads.ADMIN_CONFIRMED) + count(leads.ADMIN_REVISED);
    const safeMode = stats.global_safe_mode === true;

    const lines = [
        `LAPORAN HARIAN MINJE AI — ${reportDate} WIB`,
        '',
        'AKTIVITAS BOT ↔ HUMAN',
        `• Pesan inbound pelanggan tercatat: ${countText(events.CUSTOMER_INBOUND)}`,
        `• Balasan Bot berhasil melalui chat reply: ${countText(events.BOT_REPLY)}`,
        `• Eskalasi BOT → HUMAN tersimpan: ${countText(events.HUMAN_HANDOVER)}`,
        `• Resume HUMAN → BOT tersimpan: ${countText(events.BOT_RESUMED)}`,
        `• Sesi yang masih berstatus HUMAN saat report dibuat: ${countText(stats.human_sessions_current)}`,
        '',
        'OPERASIONAL',
        `• Booking baru: ${countText(bookingEvents.BOOKING_CREATED)}`,
        `• Status notifikasi booking saat report dibuat: ${Object.entries(bookingStatuses).map(([k, v]) => `${k} ${countText(v)}`).join(' · ') || 'Belum ada'}`,
        `• Aksi kualifikasi Admin: ${countText(adminLeadActions)} (konfirmasi ${countText(leads.ADMIN_CONFIRMED)} · revisi ${countText(leads.ADMIN_REVISED)})`,
        `• Status job FU saat report dibuat: ${Object.entries(fuStatuses).map(([k, v]) => `${k} ${countText(v)}`).join(' · ') || 'Belum ada'}`,
        `• Incident yang dibuat: ${countText(stats.incidents_opened)}`,
        '',
        'STATUS SISTEM SAAT REPORT DIBUAT',
        `• Global Safe Mode: ${safeMode ? 'AKTIF' : 'NONAKTIF'}`,
        `• Heartbeat terakhir: ${heartbeatSummary}`,
        '',
        `CAKUPAN DATA: ${coverageNote}`,
        'Report dibuat manual dari Portal; tidak ada pengiriman otomatis WhatsApp/email.'
    ];

    return {
        report_date: reportDate,
        generated_at: new Date().toISOString(),
        coverage_started_at: stats.coverage_started_at || null,
        coverage_note: coverageNote,
        summary: {
            customer_inbound: count(events.CUSTOMER_INBOUND),
            bot_replies: count(events.BOT_REPLY),
            human_handovers: count(events.HUMAN_HANDOVER),
            bot_resumes: count(events.BOT_RESUMED),
            current_human_sessions: count(stats.human_sessions_current),
            bookings_created: count(bookingEvents.BOOKING_CREATED),
            lead_admin_actions: adminLeadActions,
            incidents_opened: count(stats.incidents_opened),
            global_safe_mode: safeMode
        },
        report_text: lines.join('\n')
    };
}

export async function GET(req) {
    const auth = await requireAdminSession(req);
    if (!auth.authorized) return auth.response;
    if (!['Super Admin', 'Admin Konsultan'].includes(auth.admin.role)) {
        return NextResponse.json(
            { success: false, code: 'FORBIDDEN_DAILY_REPORT', message: 'Laporan harian hanya dapat diakses Super Admin dan Admin Konsultan.' },
            { status: 403 }
        );
    }

    const requestedDate = new URL(req.url).searchParams.get('date') || jakartaDate();
    const reportDate = parseDate(requestedDate);
    if (!reportDate) {
        return NextResponse.json({ success: false, message: 'Tanggal laporan tidak valid. Gunakan YYYY-MM-DD.' }, { status: 400 });
    }
    if (reportDate > jakartaDate()) {
        return NextResponse.json({ success: false, message: 'Laporan untuk tanggal mendatang belum tersedia.' }, { status: 400 });
    }

    const [year, month, day] = reportDate.split('-').map(Number);
    const startAt = new Date(`${reportDate}T00:00:00+07:00`);
    const endAt = new Date(Date.UTC(year, month - 1, day + 1) - 7 * 60 * 60 * 1000);

    try {
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase.rpc('kdj_get_bot_daily_report_stats', {
            p_start_at: startAt.toISOString(),
            p_end_at: endAt.toISOString()
        });
        if (error) {
            console.error('[-] /api/admin/reports/daily RPC:', error.code, error.message);
            return NextResponse.json({
                success: false,
                code: 'DAILY_REPORT_NOT_READY',
                message: 'Ledger laporan belum tersedia. Pastikan migration daily reporting diterapkan pada Staging dan Bot memakai versi pencatatan event.'
            }, { status: 503 });
        }
        return NextResponse.json(
            { success: true, report: summarize(reportDate, data || {}) },
            { headers: { 'Cache-Control': 'no-store' } }
        );
    } catch (error) {
        console.error('[-] /api/admin/reports/daily:', error?.message || error);
        return NextResponse.json({ success: false, message: 'Laporan harian gagal dibuat. Data operasional tidak diubah.' }, { status: 503 });
    }
}
