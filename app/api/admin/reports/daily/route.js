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

function summarize(reportDate, stats, businessData = null) {
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

    const b = businessData || {
        totalLeads: 0,
        prospek: 0,
        dingin: 0,
        bimbang: 0,
        unclassified: 0,
        masihBertanya: 0,
        prospekList: [],
        scheduled: count(bookingEvents.BOOKING_CREATED),
        completed: 0,
        closingToday: 0,
        unpaidEod: 0,
        submittedToday: 0
    };

    const prospekLines = b.prospekList && b.prospekList.length > 0
        ? b.prospekList.map((p, idx) => `${idx + 1}. ${p.name} — ${p.phone}`).join('\n')
        : '- Belum ada prospek baru yang tercatat.';

    const lines = [
        `KDJ — DAILY BUSINESS & OPERATIONAL REPORT`,
        `Periode: ${reportDate} (00.00–23.59 WIB)`,
        '',
        'A. LEADS BARU & PROSPEK',
        `• Total Leads unik: ${countText(b.totalLeads)}`,
        `  - Prospek: ${countText(b.prospek)}`,
        `  - Dingin: ${countText(b.dingin)}`,
        `  - Bimbang: ${countText(b.bimbang)}`,
        `  - Belum diklasifikasikan: ${countText(b.unclassified)}`,
        `• Masih bertanya (status operasional): ${countText(b.masihBertanya)}`,
        '',
        'Daftar Prospek (Nama & WhatsApp):',
        prospekLines,
        '',
        'B. KONSULTASI',
        `• Dijadwalkan: ${countText(b.scheduled)}`,
        `• Terlaksana: ${countText(b.completed)}`,
        '',
        'C. HASIL PENDAFTARAN & KEUANGAN',
        `• Closing hari ini (Pembayaran Terverifikasi LUNAS): ${countText(b.closingToday)}`,
        `• Pendaftar lengkap, belum LUNAS (posisi akhir hari): ${countText(b.unpaidEod)}`,
        `• Submit berkas hari ini: ${countText(b.submittedToday)}`,
        '',
        'D. AKTIVITAS BOT ↔ HUMAN',
        `• Pesan inbound pelanggan tercatat: ${countText(events.CUSTOMER_INBOUND)}`,
        `• Balasan Bot berhasil melalui chat reply: ${countText(events.BOT_REPLY)}`,
        `• Eskalasi BOT → HUMAN tersimpan: ${countText(events.HUMAN_HANDOVER)}`,
        `• Resume HUMAN → BOT tersimpan: ${countText(events.BOT_RESUMED)}`,
        `• Sesi yang masih berstatus HUMAN saat report dibuat: ${countText(stats.human_sessions_current)}`,
        '',
        'E. OPERASIONAL & SYSTEM HEALTH',
        `• Booking baru: ${countText(bookingEvents.BOOKING_CREATED)}`,
        `• Status notifikasi booking: ${Object.entries(bookingStatuses).map(([k, v]) => `${k} ${countText(v)}`).join(' · ') || 'Normal'}`,
        `• Aksi kualifikasi Admin: ${countText(adminLeadActions)} (konfirmasi ${countText(leads.ADMIN_CONFIRMED)} · revisi ${countText(leads.ADMIN_REVISED)})`,
        `• Incident yang dibuat: ${countText(stats.incidents_opened)}`,
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
            global_safe_mode: safeMode,
            total_leads: b.totalLeads,
            closing_today: b.closingToday,
            prospek: b.prospek,
            unpaid_eod: b.unpaidEod
        },
        report_text: lines.join('\n')
    };
}

export async function GET(req) {
    const auth = await requireAdminSession(req);
    if (!auth.authorized) return auth.response;
    if (!['Super Admin', 'Admin Konsultan', 'Admin Viewer'].includes(auth.admin.role)) {
        return NextResponse.json(
            { success: false, code: 'FORBIDDEN_DAILY_REPORT', message: 'Laporan harian hanya dapat diakses Super Admin, Admin Konsultan, dan Admin Viewer.' },
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
        const [statsResult, leadsResult, pendaftarResult, schedulesResult, closingsResult, unpaidResult, submissionsResult] = await Promise.all([
            supabase.rpc('kdj_get_bot_daily_report_stats', {
                p_start_at: startAt.toISOString(),
                p_end_at: endAt.toISOString()
            }),
            supabase
                .from('kdj_lead_qualifications')
                .select('phone_local, recommendation_category, confirmed_category, recommendation_operational_status, confirmed_operational_status, created_at')
                .gte('created_at', startAt.toISOString())
                .lt('created_at', endAt.toISOString()),
            supabase
                .from('pendaftar')
                .select('no_wa, nama_leads, nama_lengkap'),
            supabase
                .from('jadwal_konsultasi')
                .select('id, status, created_at')
                .gte('created_at', startAt.toISOString())
                .lt('created_at', endAt.toISOString()),
            supabase
                .from('kdj_registration_payment_events')
                .select('id, event_type, created_at')
                .eq('event_type', 'PAYMENT_VERIFIED_PAID')
                .gte('created_at', startAt.toISOString())
                .lt('created_at', endAt.toISOString()),
            supabase
                .from('pendaftar')
                .select('id')
                .not('status_pembayaran', 'in', '("Lunas","PAID")'),
            supabase
                .from('kdj_registration_events')
                .select('id')
                .gte('created_at', startAt.toISOString())
                .lt('created_at', endAt.toISOString())
        ]);

        if (statsResult.error) {
            console.error('[-] /api/admin/reports/daily RPC:', statsResult.error.code, statsResult.error.message);
            return NextResponse.json({
                success: false,
                code: 'DAILY_REPORT_NOT_READY',
                message: 'Ledger laporan belum tersedia. Pastikan migration daily reporting diterapkan pada Staging dan Bot memakai versi pencatatan event.'
            }, { status: 503 });
        }

        const applicantMap = new Map((pendaftarResult.data || []).map((a) => [
            a.no_wa,
            a.nama_leads || a.nama_lengkap || 'Nama belum tersedia'
        ]));

        const leads = leadsResult.data || [];
        let prospek = 0;
        let dingin = 0;
        let bimbang = 0;
        let unclassified = 0;
        let masihBertanya = 0;
        const prospekList = [];

        for (const l of leads) {
            const cat = l.confirmed_category || l.recommendation_category || 'UNCLASSIFIED';
            const op = l.confirmed_operational_status || l.recommendation_operational_status || 'NORMAL';
            if (cat === 'PROSPEK') {
                prospek++;
                prospekList.push({
                    name: applicantMap.get(l.phone_local) || 'Nama belum tersedia',
                    phone: l.phone_local
                });
            } else if (cat === 'DINGIN') {
                dingin++;
            } else if (cat === 'BIMBANG') {
                bimbang++;
            } else {
                unclassified++;
            }

            if (op === 'MASIH_BERTANYA') {
                masihBertanya++;
            }
        }

        const schedules = schedulesResult.data || [];
        const businessData = {
            totalLeads: leads.length,
            prospek,
            dingin,
            bimbang,
            unclassified,
            masihBertanya,
            prospekList,
            scheduled: schedules.length,
            completed: schedules.filter((s) => s.status === 'Selesai').length,
            closingToday: (closingsResult.data || []).length,
            unpaidEod: (unpaidResult.data || []).length,
            submittedToday: (submissionsResult.data || []).length
        };

        return NextResponse.json(
            { success: true, report: summarize(reportDate, statsResult.data || {}, businessData) },
            { headers: { 'Cache-Control': 'no-store' } }
        );
    } catch (error) {
        console.error('[-] /api/admin/reports/daily:', error?.message || error);
        return NextResponse.json({ success: false, message: 'Laporan harian gagal dibuat. Data operasional tidak diubah.' }, { status: 503 });
    }
}
