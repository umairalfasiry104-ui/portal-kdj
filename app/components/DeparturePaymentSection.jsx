'use client';

import { useState, useEffect, useCallback } from 'react';

function formatRupiah(num) {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(num || 0);
}

export default function DeparturePaymentSection({ onPaymentSuccess }) {
    const [packages, setPackages] = useState([]);
    const [order, setOrder] = useState(null);
    const [installments, setInstallments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [successMsg, setSuccessMsg] = useState('');

    // Form Cicilan
    const [selectedPkgId, setSelectedPkgId] = useState('');
    const [installmentAmount, setInstallmentAmount] = useState('');
    const [receiptFile, setReceiptFile] = useState(null);

    const loadData = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const res = await fetch('/api/departure-payments');
            const data = await res.json().catch(() => null);
            if (data?.success) {
                setPackages(data.packages || []);
                setOrder(data.order || null);
                setInstallments(data.installments || []);
                if (data.order?.package_id) {
                    setSelectedPkgId(data.order.package_id);
                } else if (data.packages?.length > 0) {
                    setSelectedPkgId(data.packages[1]?.id || data.packages[0]?.id);
                }
            }
        } catch (err) {
            console.error('Failed to load departure payment:', err);
            setError('Gagal memuat data paket keberangkatan.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        let active = true;

        fetch('/api/departure-payments')
            .then(async (res) => {
                const data = await res.json().catch(() => null);
                return { res, data };
            })
            .then(({ res, data }) => {
                if (!active) return;
                if (!res.ok || !data?.success) {
                    throw new Error(data?.message || 'Gagal memuat data paket keberangkatan.');
                }
                setPackages(data.packages || []);
                setOrder(data.order || null);
                setInstallments(data.installments || []);
                if (data.order?.package_id) {
                    setSelectedPkgId(data.order.package_id);
                } else if (data.packages?.length > 0) {
                    setSelectedPkgId(data.packages[1]?.id || data.packages[0]?.id);
                }
            })
            .catch((err) => {
                if (active) {
                    console.error('Failed to load departure payment:', err);
                    setError(err.message || 'Gagal memuat data paket keberangkatan.');
                }
            })
            .finally(() => {
                if (active) setLoading(false);
            });

        return () => {
            active = false;
        };
    }, []);

    const handleSelectPackage = async (pkgId) => {
        if (order?.is_locked) return;
        setSubmitting(true);
        setError('');
        setSuccessMsg('');
        try {
            const res = await fetch('/api/departure-payments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ package_id: pkgId })
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.success) {
                if (data?.message === 'PACKAGE_ALREADY_LOCKED_CANNOT_CHANGE') {
                throw new Error('Paket keberangkatan sudah dikunci dan tidak dapat diubah lagi.');
            }
            throw new Error(data?.message || 'Gagal memilih paket.');
            }
            setOrder(data.order);
            setSelectedPkgId(data.order.package_id);
            setSuccessMsg(`Berhasil memilih ${data.order.package_name}. Silakan lakukan transfer pembayaran.`);
        } catch (err) {
            setError(err.message || 'Gagal memilih paket.');
        } finally {
            setSubmitting(false);
        }
    };

    const handleSubmitInstallment = async (e) => {
        e.preventDefault();
        const amount = Number(installmentAmount);
        if (!amount || amount <= 0) {
            setError('Masukkan nominal pembayaran transfer yang valid.');
            return;
        }
        if (!receiptFile) {
            setError('Pilih file struk/bukti transfer bank.');
            return;
        }

        setSubmitting(true);
        setError('');
        setSuccessMsg('');

        try {
            const formData = new FormData();
            formData.append('amount_idr', String(amount));
            formData.append('file', receiptFile);

            const res = await fetch('/api/departure-payments', {
                method: 'POST',
                body: formData
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.success) {
                throw new Error(data?.message || 'Gagal mengunggah bukti cicilan.');
            }

            setSuccessMsg('✅ Bukti pembayaran cicilan berhasil diunggah! Menunggu verifikasi tim Admin KDJ.');
            setInstallmentAmount('');
            setReceiptFile(null);
            await loadData();
            if (onPaymentSuccess) onPaymentSuccess();
        } catch (err) {
            setError(err.message || 'Gagal mengunggah bukti transfer.');
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="p-6 bg-amber-50/50 rounded-2xl border border-amber-200 text-center text-xs text-amber-800">
                Memuat data paket keberangkatan...
            </div>
        );
    }

    const hasPendingReview = installments.some((i) => i.status === 'PENDING_VERIFICATION');
    const isFullyPaid = order?.payment_status === 'PAID';

    return (
        <section className="mb-8 rounded-2xl border-2 border-amber-400 bg-gradient-to-b from-amber-50/40 to-white p-5 sm:p-6 shadow-sm space-y-6">
            <div>
                <div className="flex items-center justify-between flex-wrap gap-2">
                    <h2 className="text-base sm:text-lg font-black text-[#06315b]">
                        Pilihan Paket Keberangkatan & Pembayaran Bertahap
                    </h2>
                    {order && (
                        <span className={`px-3 py-1 rounded-full text-xs font-black uppercase ${
                            isFullyPaid ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'
                        }`}>
                            {isFullyPaid ? 'LUNAS (100%)' : order.paid_amount_idr > 0 ? 'Sedang Dicicil' : 'Belum Membayar'}
                        </span>
                    )}
                </div>
                <p className="mt-1 text-xs text-slate-600">
                    Pilih paket keberangkatan resmi ke Yordania. Anda dapat melunasi sekaligus atau mencicil bertahap dengan nominal bebas hingga maksimal H-45 sebelum keberangkatan.
                </p>
            </div>

            {error && (
                <div className="p-3 bg-red-100 border border-red-300 rounded-lg text-xs text-red-700 font-semibold">
                    {error}
                </div>
            )}
            {successMsg && (
                <div className="p-3 bg-emerald-100 border border-emerald-300 rounded-lg text-xs text-emerald-800 font-semibold">
                    {successMsg}
                </div>
            )}

            {/* 1. KARTU PILIHAN PAKET */}
            <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-3">
                    1. Pilih Paket Keberangkatan {order?.is_locked && <span className="text-emerald-700 text-[11px] font-normal">(Terkunci permanen karena pembayaran sudah masuk)</span>}
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    {packages.map((pkg) => {
                        const isSelected = (order?.package_id || selectedPkgId) === pkg.id;
                        return (
                            <div
                                key={pkg.id}
                                onClick={() => !order?.is_locked && !submitting && handleSelectPackage(pkg.id)}
                                className={`rounded-xl border-2 p-4 transition relative flex flex-col justify-between ${
                                    isSelected
                                        ? 'border-[#06315b] bg-blue-50/50 shadow-md ring-2 ring-[#06315b]/20'
                                        : 'border-slate-200 bg-white hover:border-slate-300'
                                } ${order?.is_locked ? 'cursor-default' : 'cursor-pointer'}`}
                            >
                                {isSelected && (
                                    <div className="absolute top-2 right-2 px-2 py-0.5 bg-[#06315b] text-white text-[10px] font-bold rounded">
                                        Dipilih
                                    </div>
                                )}
                                <div>
                                    <h3 className="text-sm font-extrabold text-[#06315b]">{pkg.name}</h3>
                                    <p className="mt-1 text-base font-black text-amber-700">{formatRupiah(pkg.base_price_idr)}</p>
                                    <p className="mt-2 text-[11px] text-slate-600 leading-relaxed">{pkg.description}</p>
                                </div>
                                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px]">
                                    <span className="font-semibold text-slate-500">Tiket & Visa:</span>
                                    <span className={`font-bold ${pkg.includes_ticket_visa ? 'text-emerald-700' : 'text-slate-400'}`}>
                                        {pkg.includes_ticket_visa ? 'Termasuk ✅' : 'Belum termasuk'}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* 2. RINGKASAN SALDO & PROGRESS */}
            {order && (
                <div className="rounded-xl border border-amber-300 bg-white p-4 sm:p-5 shadow-sm space-y-4">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                        <div>
                            <p className="text-[11px] font-bold text-slate-500 uppercase">Paket Terpilih</p>
                            <p className="text-sm font-extrabold text-[#06315b]">{order.package_name}</p>
                        </div>
                        <div className="text-right">
                            <p className="text-[11px] font-bold text-slate-500 uppercase">Total Biaya Paket</p>
                            <p className="text-base font-black text-slate-900">{formatRupiah(order.total_amount_idr)}</p>
                        </div>
                    </div>

                    {/* Progress Bar */}
                    <div>
                        <div className="flex justify-between text-xs font-bold mb-1">
                            <span className="text-slate-600">Pelunasan: {Math.round((order.paid_amount_idr / order.total_amount_idr) * 100)}%</span>
                            <span className="text-emerald-700">Sudah Masuk: {formatRupiah(order.paid_amount_idr)}</span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden border border-slate-200">
                            <div
                                className="bg-gradient-to-r from-amber-500 to-emerald-600 h-3 rounded-full transition-all duration-500"
                                style={{ width: `${Math.min(100, Math.round((order.paid_amount_idr / order.total_amount_idr) * 100))}%` }}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                        <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
                            <p className="text-[11px] font-bold text-amber-900 uppercase">Sisa Pelunasan</p>
                            <p className="text-lg font-black text-amber-700 mt-0.5">{formatRupiah(order.remaining_amount_idr)}</p>
                            <p className="text-[10px] text-amber-800 mt-1 font-semibold">
                                *Wajib lunas paling lambat <strong>H-45 sebelum keberangkatan</strong>.
                            </p>
                        </div>
                        <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs text-slate-700 space-y-1">
                            <p className="font-bold text-[#06315b]">Rekening Resmi Pembayaran (BSI):</p>
                            <p className="font-mono text-sm font-black text-slate-900">7169735128</p>
                            <p className="text-[11px] text-slate-600">a.n. Yayasan Generasi Cerdas Akhlakul Karimah</p>
                        </div>
                    </div>
                </div>
            )}

            {/* 3. FORMULIR PEMBAYARAN CICILAN / LUNAS */}
            {order && !isFullyPaid && (
                <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
                    <h3 className="text-xs font-black text-[#06315b] uppercase">
                        2. Bayar Cicilan / Pelunasan Baru
                    </h3>

                    {hasPendingReview ? (
                        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-900 font-medium">
                            ⏳ Bukti cicilan Anda sebelumnya sedang dalam antrean verifikasi Admin KDJ. Formulir pembayaran baru akan aktif kembali setelah bukti diverifikasi atau direvisi.
                        </div>
                    ) : (
                        <form onSubmit={handleSubmitInstallment} className="space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                                        Nominal Transfer (Rp) <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="number"
                                        min={10000}
                                        max={order.remaining_amount_idr}
                                        value={installmentAmount}
                                        onChange={(e) => setInstallmentAmount(e.target.value)}
                                        placeholder={`Contoh: ${order.remaining_amount_idr >= 10000000 ? '10000000' : order.remaining_amount_idr}`}
                                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono font-bold"
                                        required
                                    />
                                    <div className="flex gap-2 mt-2 flex-wrap">
                                        <button
                                            type="button"
                                            onClick={() => setInstallmentAmount(String(order.remaining_amount_idr))}
                                            className="px-2.5 py-1 bg-amber-100 hover:bg-amber-200 text-amber-900 text-[10px] font-bold rounded"
                                        >
                                            Bayar Lunas Sekaligus ({formatRupiah(order.remaining_amount_idr)})
                                        </button>
                                        {order.remaining_amount_idr > 5000000 && (
                                            <button
                                                type="button"
                                                onClick={() => setInstallmentAmount('5000000')}
                                                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 text-[10px] font-bold rounded"
                                            >
                                                Rp 5 Juta
                                            </button>
                                        )}
                                        {order.remaining_amount_idr > 10000000 && (
                                            <button
                                                type="button"
                                                onClick={() => setInstallmentAmount('10000000')}
                                                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 text-[10px] font-bold rounded"
                                            >
                                                Rp 10 Juta
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                                        Unggah Bukti Struk / Transfer (PDF/JPG/PNG maks. 5 MB) <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="file"
                                        accept="application/pdf,image/jpeg,image/png"
                                        onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
                                        className="w-full text-xs file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-[#06315b] file:text-white file:font-bold"
                                        required
                                    />
                                </div>
                            </div>
                            <button
                                type="submit"
                                disabled={submitting}
                                className="w-full sm:w-auto px-6 py-2.5 bg-[#06315b] hover:bg-[#042444] text-white font-bold text-xs rounded-lg shadow disabled:opacity-50"
                            >
                                {submitting ? 'Mengunggah Bukti Pembayaran...' : 'Kirim Bukti Pembayaran Cicilan'}
                            </button>
                        </form>
                    )}
                </div>
            )}

            {/* 4. RIWAYAT CICILAN */}
            {installments.length > 0 && (
                <div className="space-y-2.5">
                    <h3 className="text-xs font-black text-[#06315b] uppercase">Riwayat Pembayaran Cicilan</h3>
                    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                        <table className="w-full min-w-[560px] text-left text-xs">
                            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px]">
                                <tr>
                                    <th className="p-3">Tahap</th>
                                    <th className="p-3">Tanggal Unggah</th>
                                    <th className="p-3">Nominal Transfer</th>
                                    <th className="p-3">Status</th>
                                    <th className="p-3 text-right">Struk</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 font-medium">
                                {installments.map((inst) => (
                                    <tr key={inst.id} className="hover:bg-slate-50/50">
                                        <td className="p-3 font-bold text-slate-800">Cicilan ke-{inst.installment_no}</td>
                                        <td className="p-3 text-slate-500">
                                            {new Date(inst.submitted_at).toLocaleDateString('id-ID', { dateStyle: 'medium' })}
                                        </td>
                                        <td className="p-3 font-bold text-slate-900 font-mono">{formatRupiah(inst.amount_idr)}</td>
                                        <td className="p-3">
                                            {inst.status === 'VERIFIED' && (
                                                <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px]">
                                                    DIVERIFIKASI ✅
                                                </span>
                                            )}
                                            {inst.status === 'PENDING_VERIFICATION' && (
                                                <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800 font-bold text-[10px]">
                                                    MENUNGGU VERIFIKASI ⏳
                                                </span>
                                            )}
                                            {inst.status === 'REJECTED' && (
                                                <div>
                                                    <span className="px-2 py-0.5 rounded bg-red-100 text-red-800 font-bold text-[10px]">
                                                        DITOLAK ❌
                                                    </span>
                                                    {inst.rejection_reason && (
                                                        <p className="mt-1 text-[10px] text-red-600 italic">&quot;{inst.rejection_reason}&quot;</p>
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                        <td className="p-3 text-right">
                                            {inst.receipt_url && (
                                                <a
                                                    href={inst.receipt_url}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="text-amber-700 font-bold hover:underline"
                                                >
                                                    Lihat Struk
                                                </a>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </section>
    );
}
