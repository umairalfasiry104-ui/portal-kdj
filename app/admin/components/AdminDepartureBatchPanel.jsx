'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

function formatRupiah(value) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        maximumFractionDigits: 0
    }).format(Number(value) || 0);
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

function formatMonth(value) {
    if (!value) return '—';
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return 'Periode tidak valid';
    return new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        month: 'long',
        year: 'numeric'
    }).format(date);
}

function todayDateValue() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    return year && month && day ? `${year}-${month}-${day}` : '';
}

function todayMonthValue() {
    const date = todayDateValue();
    return date ? date.slice(0, 7) : '';
}

export default function AdminDepartureBatchPanel() {
    const [batches, setBatches] = useState([]);
    const [orders, setOrders] = useState([]);
    const [events, setEvents] = useState([]);
    const [selectedBatchId, setSelectedBatchId] = useState('');
    const [monthValue, setMonthValue] = useState(todayMonthValue);
    const [createForm, setCreateForm] = useState({
        batch_code: '',
        name: '',
        estimated_departure_date: '',
        reason: ''
    });
    const [estimateDate, setEstimateDate] = useState('');
    const [confirmedDate, setConfirmedDate] = useState('');
    const [dateReason, setDateReason] = useState('');
    const [assignOrderId, setAssignOrderId] = useState('');
    const [assignReason, setAssignReason] = useState('');
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');

    const selectedBatch = useMemo(
        () => batches.find((batch) => batch.id === selectedBatchId) || null,
        [batches, selectedBatchId]
    );
    const selectedOrders = useMemo(
        () => orders.filter((order) => order.departure_batch_id === selectedBatchId),
        [orders, selectedBatchId]
    );
    const availableOrders = useMemo(
        () => orders.filter((order) => order.departure_batch_id !== selectedBatchId),
        [orders, selectedBatchId]
    );

    const refresh = useCallback(async (initial = false, batchId = '') => {
        if (!initial) setRefreshing(true);
        try {
            const query = batchId ? `?batch_id=${encodeURIComponent(batchId)}` : '';
            const response = await fetch(`/api/admin/departure-batches${query}`, { cache: 'no-store' });
            const result = await response.json().catch(() => null);
            if (!response.ok || !result?.success) {
                throw new Error(result?.message || 'Gagal memuat gelombang keberangkatan.');
            }
            const nextBatches = Array.isArray(result.batches) ? result.batches : [];
            if (!batchId) setBatches(nextBatches);
            setOrders(Array.isArray(result.orders) ? result.orders : []);
            setEvents(batchId && Array.isArray(result.events) ? result.events : []);
            setError('');
        } catch (err) {
            setError(err.message || 'Gagal memuat gelombang keberangkatan.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        let active = true;
        fetch('/api/admin/departure-batches', { cache: 'no-store' })
            .then(async (response) => {
                const result = await response.json().catch(() => null);
                if (!response.ok || !result?.success) {
                    throw new Error(result?.message || 'Gagal memuat gelombang keberangkatan.');
                }
                if (!active) return;
                const nextBatches = Array.isArray(result.batches) ? result.batches : [];
                setBatches(nextBatches);
                setOrders(Array.isArray(result.orders) ? result.orders : []);
                if (nextBatches.length > 0) {
                    const firstBatch = nextBatches[0];
                    setSelectedBatchId(firstBatch.id);
                    setEstimateDate(firstBatch.estimated_departure_date || '');
                    setConfirmedDate(firstBatch.confirmed_departure_date || '');
                    const detailResponse = await fetch(`/api/admin/departure-batches?batch_id=${encodeURIComponent(firstBatch.id)}`, { cache: 'no-store' });
                    const detail = await detailResponse.json().catch(() => null);
                    if (!active) return;
                    if (detailResponse.ok && detail?.success) setEvents(Array.isArray(detail.events) ? detail.events : []);
                }
                setError('');
            })
            .catch((err) => {
                if (active) setError(err.message || 'Gagal memuat gelombang keberangkatan.');
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, []);

    const handleSelectBatch = (batch) => {
        setSelectedBatchId(batch.id);
        setEstimateDate(batch.estimated_departure_date || '');
        setConfirmedDate(batch.confirmed_departure_date || '');
        setDateReason('');
        setMessage('');
        setError('');
        void refresh(false, batch.id);
    };

    const submitAction = async (key, payload, selectedId = selectedBatchId) => {
        setBusy(key);
        setError('');
        setMessage('');
        try {
            const response = await fetch('/api/admin/departure-batches', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json().catch(() => null);
            if (!response.ok || !result?.success) {
                throw new Error(result?.message || 'Perubahan gelombang gagal disimpan.');
            }
            setMessage('Perubahan berhasil disimpan.');
            if (key === 'create') {
                const createdBatch = result.result?.batch;
                const createdId = createdBatch?.id;
                if (createdBatch) {
                    setSelectedBatchId(createdBatch.id);
                    setEstimateDate(createdBatch.estimated_departure_date || '');
                    setConfirmedDate(createdBatch.confirmed_departure_date || '');
                }
                await refresh(false, '');
                if (createdId) await refresh(false, createdId);
            } else {
                await refresh(false, selectedId);
            }
            if (key === 'assign') {
                setAssignOrderId('');
                setAssignReason('');
            }
            if (key === 'estimate') setDateReason('');
            if (key === 'confirm' || key === 'change') setDateReason('');
            if (key === 'create') {
                setCreateForm({ batch_code: '', name: '', estimated_departure_date: '', reason: '' });
                setMonthValue(todayMonthValue());
            }
        } catch (err) {
            setError(err.message || 'Perubahan gelombang gagal disimpan.');
        } finally {
            setBusy('');
        }
    };

    const createBatch = (event) => {
        event.preventDefault();
        if (!monthValue || !createForm.batch_code.trim() || !createForm.name.trim() || createForm.reason.trim().length < 3) {
            setError('Kode, nama, bulan/tahun, dan alasan minimal 3 karakter wajib diisi.');
            return;
        }
        void submitAction('create', {
            action: 'CREATE',
            batch_code: createForm.batch_code.trim().toUpperCase(),
            name: createForm.name.trim(),
            departure_month: `${monthValue}-01`,
            estimated_departure_date: createForm.estimated_departure_date || null,
            reason: createForm.reason.trim()
        }, '');
    };

    const updateEstimate = (event) => {
        event.preventDefault();
        if (!selectedBatch || dateReason.trim().length < 3) {
            setError('Pilih gelombang dan isi alasan minimal 3 karakter.');
            return;
        }
        void submitAction('estimate', {
            action: 'UPDATE_ESTIMATE',
            batch_id: selectedBatch.id,
            estimated_departure_date: estimateDate || null,
            reason: dateReason.trim()
        });
    };

    const saveConfirmedDate = (event) => {
        event.preventDefault();
        if (!selectedBatch || !confirmedDate || dateReason.trim().length < 3) {
            setError('Tanggal final dan alasan minimal 3 karakter wajib diisi.');
            return;
        }
        const isChanging = Boolean(selectedBatch.confirmed_departure_date);
        const accepted = window.confirm(
            isChanging
                ? 'Ubah tanggal keberangkatan final? Perubahan ini akan dicatat di riwayat audit dan menggeser tanggal trigger H-45.'
                : 'Konfirmasi tanggal keberangkatan final untuk gelombang ini?'
        );
        if (!accepted) return;
        void submitAction(isChanging ? 'change' : 'confirm', {
            action: isChanging ? 'CHANGE_DATE' : 'CONFIRM_DATE',
            batch_id: selectedBatch.id,
            confirmed_departure_date: confirmedDate,
            reason: dateReason.trim()
        });
    };

    const assignOrder = (event) => {
        event.preventDefault();
        if (!selectedBatch || !assignOrderId || assignReason.trim().length < 3) {
            setError('Pilih order dan isi alasan minimal 3 karakter.');
            return;
        }
        const current = orders.find((order) => order.id === assignOrderId);
        const isReassigning = Boolean(current?.departure_batch_id);
        if (isReassigning && !window.confirm('Pindahkan order dari gelombang sebelumnya? Perpindahan akan dicatat di audit trail.')) return;
        void submitAction('assign', {
            action: 'ASSIGN_ORDER',
            order_id: assignOrderId,
            batch_id: selectedBatch.id,
            reason: assignReason.trim()
        });
    };

    return (
        <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
            <section className="rounded-2xl border-t-4 border-[#06315b] bg-white p-4 shadow-sm sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h2 className="text-lg font-extrabold text-[#06315b]">Gelombang Keberangkatan</h2>
                        <p className="mt-1 text-xs text-slate-500">
                            Kelola periode bulan/tahun, tanggal estimasi, tanggal final, penempatan order, dan riwayat perubahan.
                        </p>
                    </div>
                    <button type="button" onClick={() => void refresh(false, '')} disabled={loading || refreshing} className="rounded-lg bg-[#06315b] px-4 py-2 text-xs font-bold text-white disabled:opacity-50">
                        {refreshing ? 'Memuat…' : 'Refresh'}
                    </button>
                </div>
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-950">
                    Tanggal estimasi hanya referensi dan tidak mengaktifkan H-45. Trigger follow-up dihitung dari tanggal final yang dikonfirmasi. H-45 tidak membatasi cicilan atau mewajibkan pelunasan penuh.
                </div>
                {error && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</p>}
                {message && <p role="status" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">{message}</p>}
            </section>

            <section className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <div className="space-y-4">
                    <form onSubmit={createBatch} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 space-y-3">
                        <h3 className="text-sm font-extrabold text-[#06315b]">Buat Gelombang Baru</h3>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <label className="text-xs font-semibold text-slate-600">
                                Kode gelombang
                                <input value={createForm.batch_code} onChange={(event) => setCreateForm((current) => ({ ...current, batch_code: event.target.value }))} maxLength={40} placeholder="YOR-2027-01" required className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm uppercase" />
                            </label>
                            <label className="text-xs font-semibold text-slate-600">
                                Periode bulan
                                <input type="month" min={todayMonthValue()} value={monthValue} onChange={(event) => setMonthValue(event.target.value)} required className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm" />
                            </label>
                        </div>
                        <label className="block text-xs font-semibold text-slate-600">
                            Nama gelombang
                            <input value={createForm.name} onChange={(event) => setCreateForm((current) => ({ ...current, name: event.target.value }))} maxLength={120} placeholder="Keberangkatan Yordania Januari 2027" required className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm" />
                        </label>
                        <label className="block text-xs font-semibold text-slate-600">
                            Perkiraan tanggal keberangkatan (opsional)
                            <input type="date" min={todayDateValue()} value={createForm.estimated_departure_date} onChange={(event) => setCreateForm((current) => ({ ...current, estimated_departure_date: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm" />
                            <span className="mt-1 block text-[10px] font-normal text-slate-500">Informasi ini dapat dijawab Minje sebagai perkiraan, bukan tanggal final.</span>
                        </label>
                        <label className="block text-xs font-semibold text-slate-600">
                            Alasan pembuatan
                            <input value={createForm.reason} onChange={(event) => setCreateForm((current) => ({ ...current, reason: event.target.value }))} maxLength={1000} minLength={3} required placeholder="Membuat gelombang untuk periode Januari 2027" className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm" />
                        </label>
                        <button type="submit" disabled={Boolean(busy)} className="w-full rounded-lg bg-[#06315b] px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50">
                            {busy === 'create' ? 'Menyimpan…' : 'Buat Gelombang'}
                        </button>
                    </form>

                    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                        <div className="flex items-center justify-between gap-2">
                            <h3 className="text-sm font-extrabold text-[#06315b]">Daftar Gelombang</h3>
                            <span className="text-[11px] text-slate-500">{batches.length} gelombang</span>
                        </div>
                        {loading ? (
                            <p className="mt-3 text-xs text-slate-500">Memuat gelombang…</p>
                        ) : batches.length === 0 ? (
                            <p className="mt-3 rounded-lg border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500">Belum ada gelombang yang dibuat.</p>
                        ) : (
                            <div className="mt-3 space-y-2">
                                {batches.map((batch) => (
                                    <button key={batch.id} type="button" onClick={() => handleSelectBatch(batch)} aria-pressed={selectedBatchId === batch.id} className={`w-full rounded-xl border p-3 text-left transition ${selectedBatchId === batch.id ? 'border-[#06315b] bg-blue-50 ring-1 ring-[#06315b]/20' : 'border-slate-200 hover:bg-slate-50'}`}>
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <span className="text-xs font-extrabold text-[#06315b]">{batch.batch_code}</span>
                                            <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600">{batch.status}</span>
                                        </div>
                                        <p className="mt-1 text-xs font-semibold text-slate-800">{batch.name}</p>
                                        <p className="mt-1 text-[11px] text-slate-500">{formatMonth(batch.departure_month)}</p>
                                        <p className="mt-1 text-[11px] text-slate-500">Perkiraan: {formatDate(batch.estimated_departure_date)} · Final: {formatDate(batch.confirmed_departure_date)}</p>
                                    </button>
                                ))}
                            </div>
                        )}
                    </section>
                </div>

                <div className="space-y-4">
                    {!selectedBatch ? (
                        <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-xs text-slate-500">
                            Pilih gelombang untuk mengatur tanggal dan penempatan order.
                        </section>
                    ) : (
                        <>
                            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 space-y-4">
                                <div>
                                    <h3 className="text-sm font-extrabold text-[#06315b]">{selectedBatch.name}</h3>
                                    <p className="mt-1 text-xs text-slate-500">{selectedBatch.batch_code} · {formatMonth(selectedBatch.departure_month)}</p>
                                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                                            <p className="text-[10px] font-semibold text-amber-800">Perkiraan tanggal keberangkatan</p>
                                            <p className="mt-1 text-sm font-bold text-amber-950">{formatDate(selectedBatch.estimated_departure_date)}</p>
                                            <p className="mt-1 text-[10px] text-amber-800">Informasi perkiraan; dapat berubah. Minje dapat menyampaikan sebagai perkiraan.</p>
                                        </div>
                                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                                            <p className="text-[10px] font-semibold text-emerald-800">Tanggal final</p>
                                            <p className="mt-1 text-sm font-bold text-emerald-950">{formatDate(selectedBatch.confirmed_departure_date)}</p>
                                            <p className="mt-1 text-[10px] text-emerald-800">H-45 dihitung hanya dari tanggal final terkonfirmasi.</p>
                                        </div>
                                    </div>
                                </div>
                                <form onSubmit={updateEstimate} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                                    <label className="text-xs font-semibold text-slate-600">
                                        Tanggal estimasi
                                        <input type="date" min={todayDateValue()} value={estimateDate} onChange={(event) => setEstimateDate(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm" />
                                    </label>
                                    <label className="text-xs font-semibold text-slate-600">
                                        Alasan perubahan estimasi
                                        <input value={dateReason} onChange={(event) => setDateReason(event.target.value)} minLength={3} maxLength={1000} placeholder="Alasan update estimasi" className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm" />
                                    </label>
                                    <button type="submit" disabled={Boolean(busy)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-[#06315b] disabled:opacity-50">
                                        {busy === 'estimate' ? 'Menyimpan…' : 'Simpan Estimasi'}
                                    </button>
                                </form>
                                <form onSubmit={saveConfirmedDate} className="grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                                    <label className="text-xs font-semibold text-slate-600">
                                        {selectedBatch.confirmed_departure_date ? 'Ubah tanggal final' : 'Konfirmasi tanggal final'}
                                        <input type="date" min={todayDateValue()} value={confirmedDate} onChange={(event) => setConfirmedDate(event.target.value)} required className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm" />
                                    </label>
                                    <label className="text-xs font-semibold text-slate-600">
                                        Alasan konfirmasi/perubahan
                                        <input value={dateReason} onChange={(event) => setDateReason(event.target.value)} minLength={3} maxLength={1000} required placeholder="Alasan operasional KDJ" className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm" />
                                    </label>
                                    <button type="submit" disabled={Boolean(busy)} className="rounded-lg bg-[#06315b] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
                                        {busy === 'confirm' || busy === 'change' ? 'Menyimpan…' : selectedBatch.confirmed_departure_date ? 'Simpan Perubahan Tanggal Final' : 'Konfirmasi Tanggal Final'}
                                    </button>
                                </form>
                            </section>

                            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 space-y-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <h3 className="text-sm font-extrabold text-[#06315b]">Penempatan Order</h3>
                                    <span className="text-[11px] text-slate-500">{selectedOrders.length} order di gelombang ini</span>
                                </div>
                                <form onSubmit={assignOrder} className="space-y-3">
                                    <label className="block text-xs font-semibold text-slate-600">
                                        Pilih order paket
                                        <select value={assignOrderId} onChange={(event) => setAssignOrderId(event.target.value)} required className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm">
                                            <option value="">Pilih pendaftar…</option>
                                            {availableOrders.map((order) => (
                                                <option key={order.id} value={order.id}>
                                                    {order.student_name} · {order.package_name} · Sisa {formatRupiah(order.remaining_amount_idr)}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    <label className="block text-xs font-semibold text-slate-600">
                                        Alasan penempatan/perpindahan
                                        <input value={assignReason} onChange={(event) => setAssignReason(event.target.value)} minLength={3} maxLength={1000} required placeholder="Alasan penempatan ke gelombang ini" className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm" />
                                    </label>
                                    <button type="submit" disabled={Boolean(busy) || !assignOrderId} className="rounded-lg bg-[#06315b] px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50">
                                        {busy === 'assign' ? 'Menyimpan…' : 'Tempatkan Order'}
                                    </button>
                                </form>

                                {selectedOrders.length > 0 ? (
                                    <div className="space-y-2 border-t border-slate-100 pt-3">
                                        {selectedOrders.map((order) => (
                                            <div key={order.id} className="rounded-lg bg-slate-50 p-3">
                                                <p className="text-xs font-bold text-[#06315b]">{order.student_name}</p>
                                                <p className="mt-1 text-[11px] text-slate-500">{order.package_name} · Sisa {formatRupiah(order.remaining_amount_idr)}</p>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="rounded-lg border border-dashed border-slate-300 p-3 text-center text-xs text-slate-500">Belum ada order aktif yang ditempatkan ke gelombang ini.</p>
                                )}
                            </section>

                            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                                <h3 className="text-sm font-extrabold text-[#06315b]">Riwayat Gelombang</h3>
                                {events.length === 0 ? (
                                    <p className="mt-3 text-xs text-slate-500">Belum ada riwayat untuk gelombang ini.</p>
                                ) : (
                                    <ol className="mt-3 space-y-3">
                                        {events.map((event) => (
                                            <li key={event.id} className="border-l-2 border-slate-200 pl-3">
                                                <p className="text-xs font-bold text-slate-800">{event.event_type.replaceAll('_', ' ')}</p>
                                                <p className="mt-0.5 text-[11px] text-slate-500">{formatDate(event.created_at?.slice(0, 10))} · {event.reason}</p>
                                            </li>
                                        ))}
                                    </ol>
                                )}
                            </section>
                        </>
                    )}
                </div>
            </section>
        </main>
    );
}
