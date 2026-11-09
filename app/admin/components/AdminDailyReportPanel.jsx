'use client';

import { useState } from 'react';

function todayInJakarta() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());
}

const SUMMARY_FIELDS = [
    ['customer_inbound', 'Inbound pelanggan'],
    ['bot_replies', 'Balasan Bot'],
    ['human_handovers', 'Eskalasi ke Human'],
    ['bot_resumes', 'Resume ke Bot'],
    ['current_human_sessions', 'Sesi aktif HUMAN'],
    ['bookings_created', 'Booking baru'],
    ['lead_admin_actions', 'Aksi kualifikasi Admin'],
    ['incidents_opened', 'Incident']
];

export default function AdminDailyReportPanel() {
    const [reportDate, setReportDate] = useState(todayInJakarta);
    const [report, setReport] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [copyStatus, setCopyStatus] = useState('');

    const generateReport = async () => {
        setLoading(true);
        setError('');
        setCopyStatus('');
        try {
            const response = await fetch(
                `/api/admin/reports/daily?date=${encodeURIComponent(reportDate)}`,
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
        <main className="max-w-7xl mx-auto p-6 space-y-5">
            <section className="bg-white rounded-2xl border-t-4 border-[#06315b] shadow-sm p-5 space-y-4">
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
                            value={reportDate}
                            onChange={(event) => setReportDate(event.target.value)}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                        />
                    </div>
                    <button
                        type="button"
                        onClick={() => void generateReport()}
                        disabled={loading || !reportDate}
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
                    <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-3">
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

                    <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
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
        </main>
    );
}
