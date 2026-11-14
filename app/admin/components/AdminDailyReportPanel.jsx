'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

function todayInJakarta() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());
}

const SUMMARY_FIELDS = [
    ['total_leads', 'Total Leads Baru'],
    ['prospek', 'Leads Prospek'],
    ['closing_today', 'Closing Lunas'],
    ['unpaid_eod', 'Belum Lunas (EOD)'],
    ['bookings_created', 'Booking Konsultasi'],
    ['customer_inbound', 'Inbound Chat Pelanggan'],
    ['bot_replies', 'Balasan Minje AI'],
    ['human_handovers', 'Eskalasi ke Human']
];

export default function AdminDailyReportPanel({ isSuperAdmin = false }) {
    const reportDateRef = useRef(null);

    const [report, setReport] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [copyStatus, setCopyStatus] = useState('');
    const [recoveryRows, setRecoveryRows] = useState([]);
    const [recoveryLoading, setRecoveryLoading] = useState(false);
    const [recoveryError, setRecoveryError] = useState('');
    const [recoveryNotice, setRecoveryNotice] = useState('');
    const [recoveryActionId, setRecoveryActionId] = useState('');

    useEffect(() => {
        if (reportDateRef.current) {
            reportDateRef.current.value = todayInJakarta();
        }
    }, []);

    const refreshRecovery = useCallback(async () => {
        if (!isSuperAdmin) return;
        setRecoveryLoading(true);
        setRecoveryError('');
        try {
            const response = await fetch('/api/admin/daily-report/recovery', { cache: 'no-store' });
            const result = await response.json().catch(() => null);
            if (!response.ok || !result?.success) {
                throw new Error(result?.message || 'Daftar pemulihan laporan gagal dimuat.');
            }
            setRecoveryRows(Array.isArray(result.deliveries) ? result.deliveries : []);
        } catch (err) {
            setRecoveryError(err?.message || 'Daftar pemulihan laporan tidak tersedia.');
        } finally {
            setRecoveryLoading(false);
        }
    }, [isSuperAdmin]);

    useEffect(() => {
        let active = true;
        queueMicrotask(() => {
            if (active && isSuperAdmin) void refreshRecovery();
        });
        return () => {
            active = false;
        };
    }, [isSuperAdmin, refreshRecovery]);

    const runRecoveryAction = async (delivery, action) => {
        let reason = '';
        let providerMessageId = '';
        let confirmedNoMessage = false;

        if (action === 'RETRY_FAILED') {
            reason = window.prompt('Alasan retry delivery yang sudah dipastikan FAILED (minimal 3 karakter):', '') || '';
        } else if (action === 'RECONCILE_UNKNOWN_SENT') {
            providerMessageId = window.prompt('Masukkan referensi message ID dari WhatsApp/provider:', '') || '';
            if (!providerMessageId.trim()) return;
            reason = window.prompt('Alasan rekonsiliasi sebagai SENT (minimal 3 karakter):', 'Ditemukan bukti pesan telah terkirim pada chat penerima.') || '';
        } else if (action === 'RECONCILE_UNKNOWN_FAILED') {
            confirmedNoMessage = window.confirm(
                'Pastikan chat WhatsApp penerima telah diperiksa dan pesan memang TIDAK terkirim. Jika pesan sudah terkirim, pilih batal. Lanjutkan menandai UNKNOWN sebagai FAILED?'
            );
            if (!confirmedNoMessage) return;
            reason = window.prompt('Catat hasil pemeriksaan chat penerima (minimal 3 karakter):', '') || '';
        }

        if (reason.trim().length < 3) return;

        setRecoveryActionId(delivery.id);
        setRecoveryError('');
        setRecoveryNotice('');
        try {
            const response = await fetch('/api/admin/daily-report/recovery', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    delivery_id: delivery.id,
                    action,
                    reason: reason.trim(),
                    ...(action === 'RECONCILE_UNKNOWN_SENT' ? { provider_message_id: providerMessageId.trim() } : {}),
                    ...(action === 'RECONCILE_UNKNOWN_FAILED' ? { confirmed_no_message: confirmedNoMessage } : {})
                })
            });
            const result = await response.json().catch(() => null);
            if (!response.ok || !result?.success) {
                throw new Error(result?.message || 'Tindakan pemulihan delivery gagal.');
            }
            const notice = action === 'RETRY_FAILED'
                ? 'Delivery kembali ke antrean PENDING. Ini bukan pengiriman langsung; Bot hanya memprosesnya bila feature flag delivery aktif dan WhatsApp siap.'
                : action === 'RECONCILE_UNKNOWN_SENT'
                    ? 'Delivery UNKNOWN telah direkonsiliasi sebagai SENT berdasarkan referensi provider yang dicatat.'
                    : 'Delivery UNKNOWN telah direkonsiliasi sebagai FAILED. Tidak ada pesan yang dikirim ulang; retry harus menjadi tindakan terpisah.';
            setRecoveryNotice(notice);
            await refreshRecovery();
        } catch (err) {
            setRecoveryError(err?.message || 'Tindakan pemulihan delivery gagal.');
        } finally {
            setRecoveryActionId('');
        }
    };

    const generateReport = async () => {
        const selectedDate = reportDateRef.current?.value || '';
        if (!selectedDate) {
            setError('Pilih tanggal laporan terlebih dahulu.');
            setReport(null);
            return;
        }
        setLoading(true);
        setError('');
        setCopyStatus('');
        try {
            const response = await fetch(
                `/api/admin/reports/daily?date=${encodeURIComponent(selectedDate)}`,
                { cache: 'no-store' }
            );
            const result = await response.json().catch(() => null);
            if (!response.ok || !result?.success || !result?.report) {
                throw new Error(result?.message || 'Laporan harian tidak dapat dibuat.');
            }
            setReport(result.report);
        } catch (err) {
            setError(err?.message || 'Laporan harian tidak dapat dibuat.');
            setReport(null);
        } finally {
            setLoading(false);
        }
    };

    const copyReport = async () => {
        if (!report?.report_text) return;
        try {
            await navigator.clipboard.writeText(report.report_text);
            setCopyStatus('Laporan berhasil disalin. Silakan bagikan secara manual kepada Human/Admin.');
        } catch {
            setCopyStatus('Clipboard tidak tersedia. Pilih dan salin teks laporan di bawah secara manual.');
        }
    };

    return (
        <main className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
            <section className="bg-white rounded-2xl border-t-4 border-[#06315b] shadow-sm p-4 sm:p-5 space-y-4">
                <div>
                    <h2 className="font-extrabold text-[#06315b] text-lg">Laporan Harian Bot → Human</h2>
                    <p className="text-xs text-slate-500 mt-1">
                        Rekap operasional Minje AI berdasarkan event ledger, Booking Outbox, Lead Qualification,
                        Follow-up, dan Monitoring. Zona waktu Asia/Jakarta.
                    </p>
                </div>

                <div className="flex flex-wrap items-end gap-3">
                    <div>
                        <label htmlFor="daily-report-date" className="block text-xs font-bold text-slate-600 mb-1">
                            Tanggal laporan (WIB)
                        </label>
                        <input
                            id="daily-report-date"
                            type="date"
                            ref={reportDateRef}
                            defaultValue=""
                            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                        />
                    </div>
                    <button
                        type="button"
                        onClick={() => void generateReport()}
                        disabled={loading}
                        className="rounded-lg bg-[#06315b] px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                    >
                        {loading ? 'Membuat laporan...' : 'Generate / Refresh Report'}
                    </button>
                </div>

                {error && (
                    <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                        {error}
                    </p>
                )}
            </section>

            {report && (
                <>
                    <section className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm space-y-3">
                        <div className="flex flex-wrap justify-between items-center gap-2">
                            <div>
                                <h3 className="font-extrabold text-[#06315b]">Ringkasan {report.report_date}</h3>
                                <p className="text-[11px] text-slate-500">
                                    Dibuat {new Intl.DateTimeFormat('id-ID', {
                                        timeZone: 'Asia/Jakarta',
                                        dateStyle: 'medium',
                                        timeStyle: 'short'
                                    }).format(new Date(report.generated_at))} WIB
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => void copyReport()}
                                className="rounded-lg border border-[#06315b] px-3 py-2 text-xs font-bold text-[#06315b]"
                            >
                                Salin untuk Human
                            </button>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {SUMMARY_FIELDS.map(([key, label]) => (
                                <div key={key} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                    <p className="text-[10px] text-slate-500">{label}</p>
                                    <p className="mt-1 text-xl font-extrabold tabular-nums text-[#06315b]">
                                        {Number(report.summary?.[key] || 0).toLocaleString('id-ID')}
                                    </p>
                                </div>
                            ))}
                        </div>

                        {report.coverage_note && (
                            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                                {report.coverage_note}
                            </p>
                        )}
                        {copyStatus && <p role="status" className="text-xs text-slate-600">{copyStatus}</p>}
                    </section>

                    <section className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm">
                        <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
                            <h3 className="font-extrabold text-[#06315b]">Teks laporan siap dibagikan</h3>
                            <span className="text-[10px] text-slate-500">Manual sharing · Tidak ada auto-send</span>
                        </div>
                        <textarea
                            readOnly
                            rows={22}
                            value={report.report_text}
                            className="w-full rounded-lg border border-slate-300 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-800"
                        />
                    </section>
                </>
            )}

            {isSuperAdmin && (
                <section className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <h3 className="font-extrabold text-[#06315b]">Pemulihan Pengiriman Laporan Admin</h3>
                            <p className="text-xs text-slate-500 mt-1">
                                Khusus Super Admin. UNKNOWN tidak pernah di-retry otomatis dan harus direkonsiliasi terlebih dahulu.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => void refreshRecovery()}
                            disabled={recoveryLoading || Boolean(recoveryActionId)}
                            className="rounded-lg border border-[#06315b] px-3 py-2 text-xs font-bold text-[#06315b] disabled:opacity-50"
                        >
                            {recoveryLoading ? 'Memuat...' : 'Refresh antrean'}
                        </button>
                    </div>

                    {recoveryError && (
                        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                            {recoveryError}
                        </p>
                    )}
                    {recoveryNotice && (
                        <p role="status" className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                            {recoveryNotice}
                        </p>
                    )}

                    {recoveryLoading && recoveryRows.length === 0 ? (
                        <p className="text-sm text-slate-500">Memuat delivery FAILED/UNKNOWN...</p>
                    ) : recoveryRows.length === 0 ? (
                        <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
                            Tidak ada delivery FAILED atau UNKNOWN yang membutuhkan rekonsiliasi.
                        </p>
                    ) : (
                        <div className="space-y-3">
                            {recoveryRows.map((delivery) => (
                                <article key={delivery.id} className="rounded-xl border border-slate-200 p-4 space-y-3">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div>
                                            <p className="text-sm font-bold text-slate-800">
                                                {delivery.report_date || 'Tanggal laporan tidak tersedia'} · {delivery.admin_role}
                                            </p>
                                            <p className="text-xs text-slate-500 mt-1">
                                                Penerima: {delivery.recipient_masked} · Percobaan: {delivery.attempts}
                                            </p>
                                        </div>
                                        <span className={`rounded-full px-3 py-1 text-[10px] font-extrabold ${delivery.status === 'UNKNOWN' ? 'bg-amber-100 text-amber-900' : 'bg-red-100 text-red-800'}`}>
                                            {delivery.status}
                                        </span>
                                    </div>

                                    {delivery.last_error && (
                                        <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 break-words">
                                            {delivery.last_error}
                                        </p>
                                    )}
                                    {delivery.provider_message_id && (
                                        <p className="text-[11px] text-slate-500 break-all">
                                            Provider message ID: {delivery.provider_message_id}
                                        </p>
                                    )}

                                    <div className="flex flex-wrap gap-2">
                                        {delivery.status === 'FAILED' && (
                                            <button
                                                type="button"
                                                disabled={Boolean(recoveryActionId)}
                                                onClick={() => void runRecoveryAction(delivery, 'RETRY_FAILED')}
                                                className="rounded-lg bg-[#06315b] px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                                            >
                                                {recoveryActionId === delivery.id ? 'Memproses...' : 'Retry FAILED'}
                                            </button>
                                        )}
                                        {delivery.status === 'UNKNOWN' && (
                                            <>
                                                <button
                                                    type="button"
                                                    disabled={Boolean(recoveryActionId)}
                                                    onClick={() => void runRecoveryAction(delivery, 'RECONCILE_UNKNOWN_SENT')}
                                                    className="rounded-lg border border-emerald-600 px-3 py-2 text-xs font-bold text-emerald-800 disabled:opacity-50"
                                                >
                                                    Tandai SENT (ada bukti)
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={Boolean(recoveryActionId)}
                                                    onClick={() => void runRecoveryAction(delivery, 'RECONCILE_UNKNOWN_FAILED')}
                                                    className="rounded-lg border border-amber-600 px-3 py-2 text-xs font-bold text-amber-900 disabled:opacity-50"
                                                >
                                                    Konfirmasi tidak terkirim
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </article>
                            ))}
                        </div>
                    )}
                    <p className="text-[11px] text-slate-500">
                        Rekonsiliasi UNKNOWN sebagai FAILED tidak mengirim ulang. Setelah tercatat FAILED, Super Admin dapat menjalankan retry terpisah dengan alasan audit.
                    </p>
                </section>
            )}
        </main>
    );
}
