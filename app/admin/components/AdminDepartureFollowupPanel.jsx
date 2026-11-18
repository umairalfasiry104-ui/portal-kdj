'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

const STAGE_META = {
    H7_URGENT: { label: 'H-7 · Prioritas follow-up', style: 'bg-red-100 text-red-800' },
    H30_TARGET: { label: 'H-30 · Target operasional', style: 'bg-orange-100 text-orange-800' },
    H45_FOLLOW_UP: { label: 'Trigger H-45 aktif', style: 'bg-amber-100 text-amber-900' },
    BEFORE_H45: { label: 'Belum H-45', style: 'bg-slate-100 text-slate-700' },
    AFTER_DEPARTURE_DATE: { label: 'Tanggal keberangkatan lewat', style: 'bg-red-100 text-red-800' },
    AWAITING_DATE_CONFIRMATION: { label: 'Menunggu tanggal final', style: 'bg-blue-100 text-blue-800' },
    BATCH_NOT_ASSIGNED: { label: 'Gelombang belum ditentukan', style: 'bg-slate-100 text-slate-700' },
    BATCH_UNAVAILABLE: { label: 'Gelombang tidak aktif', style: 'bg-slate-100 text-slate-700' }
};

function formatRupiah(value) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        maximumFractionDigits: 0
    }).format(Number(value) || 0);
}

function formatMonth(value) {
    if (!value) return '—';
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return 'Bulan tidak valid';
    return new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        month: 'long',
        year: 'numeric'
    }).format(date);
}

function formatDate(value) {
    if (!value) return 'Belum dikonfirmasi';
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return 'Tanggal tidak valid';
    return new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        dateStyle: 'medium'
    }).format(date);
}

function getDaysLabel(days) {
    if (days === null || days === undefined || days === '' || !Number.isInteger(Number(days))) {
        return 'Tanggal final belum tersedia';
    }
    const value = Number(days);
    if (value < 0) return `Lewat ${Math.abs(value)} hari`;
    if (value === 0) return 'Hari ini';
    return `H-${value}`;
}

export default function AdminDepartureFollowupPanel() {
    const [orders, setOrders] = useState([]);
    const [summary, setSummary] = useState(null);
    const [filter, setFilter] = useState('ALL');
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState('');
    const [generatedAt, setGeneratedAt] = useState(null);

    const refresh = useCallback(async () => {
        setRefreshing(true);
        try {
            const response = await fetch('/api/admin/departure-followups', { cache: 'no-store' });
            const result = await response.json().catch(() => null);
            if (!response.ok || !result?.success) {
                const message = result?.message || 'Gagal memuat monitoring pelunasan.';
                const error = new Error(message);
                error.status = response.status;
                throw error;
            }
            setOrders(Array.isArray(result.orders) ? result.orders : []);
            setSummary(result.summary || null);
            setGeneratedAt(result.generated_at || null);
            setError('');
        } catch (err) {
            setError(err.message || 'Gagal memuat monitoring pelunasan.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        let active = true;

        fetch('/api/admin/departure-followups', { cache: 'no-store' })
            .then(async (response) => {
                const result = await response.json().catch(() => null);
                if (!response.ok || !result?.success) {
                    throw new Error(result?.message || 'Gagal memuat monitoring pelunasan.');
                }
                if (!active) return;
                setOrders(Array.isArray(result.orders) ? result.orders : []);
                setSummary(result.summary || null);
                setGeneratedAt(result.generated_at || null);
                setError('');
            })
            .catch((err) => {
                if (active) setError(err.message || 'Gagal memuat monitoring pelunasan.');
            })
            .finally(() => {
                if (active) setLoading(false);
            });

        return () => {
            active = false;
        };
    }, []);

    const filteredOrders = useMemo(() => {
        const query = search.trim().toLowerCase();
        return orders.filter((order) => {
            if (filter === 'H45' && order.h45_followup_triggered !== true) return false;
            if (filter === 'H30' && !(order.h45_followup_determinable && Number(order.days_until_departure) <= 30)) return false;
            if (filter === 'H7' && !(order.h45_followup_determinable && Number(order.days_until_departure) <= 7)) return false;
            if (filter === 'NO_DATE' && order.h45_followup_determinable === true) return false;
            if (!query) return true;
            return [
                order.student_name,
                order.package_name,
                order.batch_code,
                order.batch_name,
                order.phone_masked
            ].filter(Boolean).join(' ').toLowerCase().includes(query);
        });
    }, [filter, orders, search]);

    return (
        <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
            <section className="rounded-2xl border-t-4 border-[#06315b] bg-white p-4 shadow-sm sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h2 className="text-lg font-extrabold text-[#06315b]">Monitoring Pelunasan Keberangkatan</h2>
                        <p className="mt-1 text-xs text-slate-500">
                            Pantau sisa pembayaran berdasarkan tanggal final gelombang yang sudah dikonfirmasi.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => void refresh(false)}
                        disabled={loading || refreshing}
                        className="rounded-lg bg-[#06315b] px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                    >
                        {refreshing ? 'Memuat…' : 'Refresh'}
                    </button>
                </div>

                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-950">
                    <b>Aturan H-45:</b> hanya memulai pengingat dan monitoring, bukan batas akhir pembayaran.
                    Customer tetap boleh membayar sebagian setelah H-45, termasuk H-30 dan H-7, sampai lunas.
                    H-30 adalah target operasional umum, bukan hard deadline. Jangan menolak atau menahan pembayaran karena melewati H-45.
                </div>

                {error && (
                    <div role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                        {error}
                        {error.toLowerCase().includes('migration') || error.toLowerCase().includes('belum diaktifkan')
                            ? ' Pastikan migration sudah diterapkan pada environment dan feature flag sudah diaktifkan.'
                            : ''}
                    </div>
                )}

                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                    {[
                        { label: 'Order belum lunas', value: summary?.outstanding_orders ?? '—' },
                        { label: 'Follow-up H-45', value: summary?.h45_followup ?? '—' },
                        { label: 'Target H-30', value: summary?.h30_target ?? '—' },
                        { label: 'Prioritas H-7', value: summary?.h7_urgent ?? '—' },
                        { label: 'Tanggal belum final', value: summary?.departure_date_pending ?? '—' },
                        { label: 'Bukti menunggu review', value: summary?.pending_payment_proofs ?? '—' }
                    ].map((item) => (
                        <div key={item.label} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <p className="text-[10px] font-semibold text-slate-500">{item.label}</p>
                            <p className="mt-1 text-xl font-black text-[#06315b] tabular-nums">{item.value}</p>
                        </div>
                    ))}
                </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex flex-wrap gap-2" role="group" aria-label="Filter monitoring pelunasan">
                        {[
                            { value: 'ALL', label: 'Semua' },
                            { value: 'H45', label: 'H-45 aktif' },
                            { value: 'H30', label: 'H-30' },
                            { value: 'H7', label: 'H-7' },
                            { value: 'NO_DATE', label: 'Tanggal belum final' }
                        ].map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                onClick={() => setFilter(item.value)}
                                aria-pressed={filter === item.value}
                                className={`rounded-full border px-3 py-2 text-[11px] font-bold transition ${
                                    filter === item.value
                                        ? 'border-[#06315b] bg-[#06315b] text-white'
                                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                                }`}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>
                    <input
                        type="search"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Cari nama, paket, atau kode gelombang"
                        aria-label="Cari monitoring pelunasan"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs outline-none focus:border-[#06315b] lg:max-w-sm"
                    />
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                    <span>{filteredOrders.length} order ditampilkan · Nomor WhatsApp dimasking</span>
                    <span>
                        {generatedAt
                            ? `Data diperbarui ${new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(generatedAt))} WIB`
                            : 'Belum ada waktu pembaruan'}
                    </span>
                </div>

                {loading ? (
                    <p className="mt-4 rounded-xl bg-slate-50 p-5 text-center text-xs text-slate-500">Memuat monitoring pelunasan…</p>
                ) : filteredOrders.length === 0 ? (
                    <p className="mt-4 rounded-xl border border-dashed border-slate-300 p-6 text-center text-xs text-slate-500">
                        {orders.length === 0 ? 'Tidak ada order dengan sisa pembayaran saat ini.' : 'Tidak ada order yang cocok dengan filter/pencarian.'}
                    </p>
                ) : (
                    <div className="mt-4 space-y-3">
                        {filteredOrders.map((order) => {
                            const meta = STAGE_META[order.followup_stage] || {
                                label: 'Status tidak diketahui',
                                style: 'bg-slate-100 text-slate-700'
                            };
                            return (
                                <article key={order.order_id} className="rounded-xl border border-slate-200 p-3 sm:p-4">
                                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <h3 className="text-sm font-extrabold text-[#06315b]">{order.student_name}</h3>
                                                <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${meta.style}`}>{meta.label}</span>
                                            </div>
                                            <p className="mt-1 text-[11px] text-slate-500">
                                                {order.phone_masked || 'Nomor WA tidak tersedia'} · {order.package_name || 'Paket tidak tersedia'}
                                            </p>
                                            <p className="mt-1 text-[11px] text-slate-500">
                                                Gelombang: {order.batch_name || 'Belum ditetapkan'}{order.batch_code ? ` (${order.batch_code})` : ''} · Periode {formatMonth(order.departure_month)}
                                            </p>
                                        </div>
                                        <div className="shrink-0 lg:text-right">
                                            <p className="text-[10px] font-semibold uppercase text-slate-500">Sisa pembayaran</p>
                                            <p className="mt-1 text-lg font-black text-amber-800">{formatRupiah(order.remaining_amount_idr)}</p>
                                            <p className="mt-1 text-[11px] font-bold text-[#06315b]">
                                                {getDaysLabel(order.days_until_departure)}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
                                        <div className="rounded-lg bg-slate-50 p-2.5">
                                            <p className="text-slate-500">Total paket</p>
                                            <p className="mt-1 font-bold text-slate-800">{formatRupiah(order.total_amount_idr)}</p>
                                        </div>
                                        <div className="rounded-lg bg-slate-50 p-2.5">
                                            <p className="text-slate-500">Sudah dibayar</p>
                                            <p className="mt-1 font-bold text-emerald-700">{formatRupiah(order.paid_amount_idr)}</p>
                                        </div>
                                        <div className="rounded-lg bg-slate-50 p-2.5">
                                            <p className="text-slate-500">Tanggal keberangkatan</p>
                                            <p className="mt-1 font-bold text-slate-800">{formatDate(order.confirmed_departure_date)}</p>
                                        </div>
                                        <div className="rounded-lg bg-slate-50 p-2.5">
                                            <p className="text-slate-500">Bukti menunggu review</p>
                                            <p className="mt-1 font-bold text-slate-800">
                                                {Number(order.pending_verification_count) || 0} bukti · {formatRupiah(order.pending_verification_amount_idr)}
                                            </p>
                                        </div>
                                    </div>

                                    {!order.h45_followup_determinable && (
                                        <p className="mt-3 rounded-lg border border-blue-100 bg-blue-50 p-2.5 text-[11px] text-blue-800">
                                            Tanggal trigger belum dapat dihitung. Tetapkan gelombang dan konfirmasi tanggal final.
                                            Pembayaran customer tetap dapat dilakukan seperti biasa.
                                        </p>
                                    )}
                                </article>
                            );
                        })}
                    </div>
                )}
            </section>
        </main>
    );
}
