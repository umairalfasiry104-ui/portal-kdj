'use client';

import { useEffect, useState } from 'react';
import {
    canViewDeparturePayments,
    canReviewDeparturePayments
} from '../lib/admin-access';

function formatRupiah(value) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        maximumFractionDigits: 0
    }).format(Number(value) || 0);
}

function formatDate(value) {
    if (!value) return 'Tanggal tidak tersedia';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Tanggal tidak valid';
    return new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        dateStyle: 'medium',
        timeStyle: 'short'
    }).format(date) + ' WIB';
}

const STATUS_META = {
    PENDING_VERIFICATION: {
        label: 'Menunggu verifikasi',
        style: 'bg-amber-100 text-amber-900'
    },
    VERIFIED: {
        label: 'Diverifikasi',
        style: 'bg-emerald-100 text-emerald-800'
    },
    REJECTED: {
        label: 'Perlu revisi',
        style: 'bg-red-100 text-red-800'
    }
};

function getFileKind(filename) {
    const extension = String(filename || '').split('.').pop()?.toLowerCase();
    if (extension === 'pdf') return 'pdf';
    if (['jpg', 'jpeg', 'png'].includes(extension)) return 'image';
    return 'unknown';
}

/**
 * Panel verifikasi cicilan paket keberangkatan pada detail pendaftar.
 * Komponen hanya mengatur presentasi; keputusan tetap ditangani oleh onReview.
 */
export default function AdminDepartureReviewPanel({
    statusPendaftaran,
    adminRole,
    info,
    loading,
    reviewingInstallmentId,
    onReview
}) {
    const [previewInstallment, setPreviewInstallment] = useState(null);
    const [rejectingInstallmentId, setRejectingInstallmentId] = useState(null);
    const [rejectionReason, setRejectionReason] = useState('');
    const [actionError, setActionError] = useState('');

    useEffect(() => {
        if (!previewInstallment) return undefined;
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') setPreviewInstallment(null);
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [previewInstallment]);

    if (statusPendaftaran !== 'Approved' || !canViewDeparturePayments(adminRole)) {
        return null;
    }

    const order = info?.order || null;
    const installments = Array.isArray(info?.installments) ? info.installments : [];
    const pendingInstallments = installments.filter((item) => item.status === 'PENDING_VERIFICATION');
    const historyInstallments = installments.filter((item) => item.status !== 'PENDING_VERIFICATION');
    const canReview = canReviewDeparturePayments(adminRole);
    const totalAmount = Number(order?.total_amount_idr) || 0;
    const paidAmount = Number(order?.paid_amount_idr) || 0;
    const remainingAmount = Number(order?.remaining_amount_idr) || 0;
    const paidPercent = totalAmount > 0
        ? Math.min(100, Math.max(0, Math.round((paidAmount / totalAmount) * 100)))
        : 0;
    const isPaid = order?.payment_status === 'PAID';

    const handleApprove = (installment) => {
        const confirmed = window.confirm(
            'Setujui pembayaran ' + formatRupiah(installment.amount_idr) +
            ' untuk cicilan ke-' + installment.installment_no + '?'
        );
        if (!confirmed) return;
        setActionError('');
        onReview(installment.id, 'APPROVE');
    };

    const openRejectForm = (installment) => {
        setActionError('');
        setRejectingInstallmentId(installment.id);
        setRejectionReason('');
    };

    const submitRejection = (event) => {
        event.preventDefault();
        const reason = rejectionReason.trim();
        if (reason.length < 3) {
            setActionError('Alasan revisi wajib diisi minimal 3 karakter.');
            return;
        }
        const installmentId = rejectingInstallmentId;
        setActionError('');
        setRejectingInstallmentId(null);
        setRejectionReason('');
        onReview(installmentId, 'REJECT', reason);
    };

    const renderInstallment = (installment, isPending) => {
        const status = STATUS_META[installment.status] || {
            label: 'Status tidak dikenal',
            style: 'bg-slate-100 text-slate-700'
        };
        return (
            <article
                key={installment.id}
                className={'rounded-xl border p-3 sm:p-4 space-y-3 ' + (
                    isPending ? 'border-amber-200 bg-white' : 'border-slate-200 bg-slate-50/70'
                )}
            >
                <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                        <p className="text-xs font-bold text-[#06315b]">
                            Cicilan ke-{installment.installment_no}
                        </p>
                        <p className="mt-1 text-xl font-black tracking-tight text-slate-900">
                            {formatRupiah(installment.amount_idr)}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-500">
                            Diajukan {formatDate(installment.submitted_at)}
                        </p>
                    </div>
                    <span className={'rounded-full px-2.5 py-1 text-[10px] font-bold ' + status.style}>
                        {status.label}
                    </span>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                    <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                            Bukti pembayaran
                        </p>
                        <p className="mt-0.5 max-w-[260px] truncate text-xs font-medium text-slate-700">
                            {installment.original_filename || 'Nama file tidak tersedia'}
                        </p>
                    </div>
                    {installment.receipt_url ? (
                        <button
                            type="button"
                            onClick={() => setPreviewInstallment(installment)}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-[#06315b] hover:bg-slate-50"
                        >
                            Tinjau bukti
                        </button>
                    ) : (
                        <span className="text-[11px] text-red-600">Bukti tidak tersedia</span>
                    )}
                </div>

                {installment.rejection_reason && (
                    <div className="rounded-lg border border-red-100 bg-red-50 p-3">
                        <p className="text-[10px] font-bold uppercase text-red-700">Catatan revisi sebelumnya</p>
                        <p className="mt-1 whitespace-pre-wrap text-xs text-red-800">{installment.rejection_reason}</p>
                    </div>
                )}

                {isPending && canReview && (
                    <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:justify-end">
                        <button
                            type="button"
                            disabled={reviewingInstallmentId === installment.id}
                            onClick={() => openRejectForm(installment)}
                            className="rounded-lg border border-red-200 bg-white px-4 py-2.5 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                            Minta Revisi
                        </button>
                        <button
                            type="button"
                            disabled={reviewingInstallmentId === installment.id}
                            onClick={() => handleApprove(installment)}
                            className="rounded-lg bg-emerald-700 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
                        >
                            {reviewingInstallmentId === installment.id ? 'Memproses...' : 'Setujui Pembayaran'}
                        </button>
                    </div>
                )}

                {reviewingInstallmentId === installment.id && (
                    <p className="text-[11px] font-medium text-blue-700">Permintaan sedang diproses...</p>
                )}

                {rejectingInstallmentId === installment.id && (
                    <form onSubmit={submitRejection} className="rounded-lg border border-red-200 bg-red-50/70 p-3 space-y-2">
                        <label className="block text-xs font-bold text-red-900" htmlFor={'departure-reject-' + installment.id}>
                            Alasan meminta revisi
                        </label>
                        <textarea
                            id={'departure-reject-' + installment.id}
                            value={rejectionReason}
                            onChange={(event) => setRejectionReason(event.target.value)}
                            minLength={3}
                            maxLength={500}
                            rows={3}
                            required
                            placeholder="Jelaskan bagian bukti transfer yang perlu diperbaiki..."
                            className="w-full rounded-lg border border-red-200 bg-white p-2.5 text-xs text-slate-800 outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100"
                        />
                        {actionError && (
                            <p role="alert" className="text-xs font-semibold text-red-700">{actionError}</p>
                        )}
                        <div className="flex flex-wrap justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    setRejectingInstallmentId(null);
                                    setRejectionReason('');
                                    setActionError('');
                                }}
                                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                            >
                                Batal
                            </button>
                            <button
                                type="submit"
                                disabled={rejectionReason.trim().length < 3 || reviewingInstallmentId === installment.id}
                                className="rounded-lg bg-red-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                            >
                                Kirim permintaan revisi
                            </button>
                        </div>
                    </form>
                )}
            </article>
        );
    };

    return (
        <>
            <section
                aria-label="Status & Verifikasi Cicilan Paket Keberangkatan"
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 space-y-4"
            >
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <h3 className="text-sm font-extrabold text-[#06315b]">
                            Status &amp; Verifikasi Cicilan Paket Keberangkatan
                        </h3>
                        <p className="mt-1 text-[11px] text-slate-500">
                            Periksa bukti transfer sebelum mengambil keputusan.
                        </p>
                    </div>
                    {order && (
                        <span className={'rounded-full px-3 py-1 text-[10px] font-bold ' + (
                            isPaid ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'
                        )}>
                            {isPaid ? 'Lunas 100%' : 'Belum lunas'}
                        </span>
                    )}
                </div>

                {loading ? (
                    <div className="rounded-lg bg-slate-50 p-4 text-xs text-slate-500">
                        Memuat data pembayaran paket...
                    </div>
                ) : !order ? (
                    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-xs text-slate-600">
                        Pendaftar belum memilih paket keberangkatan di Portal.
                    </div>
                ) : (
                    <>
                        <div className="rounded-xl bg-slate-50 p-3 sm:p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Paket terpilih</p>
                                    <p className="mt-1 text-sm font-extrabold text-[#06315b]">{order.package_name}</p>
                                </div>
                                <div className="sm:text-right">
                                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Total biaya</p>
                                    <p className="mt-1 text-base font-black text-slate-900">{formatRupiah(totalAmount)}</p>
                                </div>
                            </div>

                            <div className="mt-4 grid grid-cols-2 gap-3">
                                <div className="rounded-lg border border-emerald-100 bg-white p-3">
                                    <p className="text-[10px] font-semibold text-slate-500">Sudah diverifikasi</p>
                                    <p className="mt-1 text-sm font-extrabold text-emerald-700">{formatRupiah(paidAmount)}</p>
                                </div>
                                <div className="rounded-lg border border-amber-100 bg-white p-3">
                                    <p className="text-[10px] font-semibold text-slate-500">Sisa pembayaran</p>
                                    <p className="mt-1 text-sm font-extrabold text-amber-800">{formatRupiah(remainingAmount)}</p>
                                </div>
                            </div>

                            <div className="mt-4">
                                <div className="mb-1.5 flex items-center justify-between gap-2 text-[10px]">
                                    <span className="font-semibold text-slate-600">Progres pelunasan</span>
                                    <span className="font-extrabold text-[#06315b]">{paidPercent}%</span>
                                </div>
                                <div
                                    className="h-2.5 overflow-hidden rounded-full bg-slate-200"
                                    role="progressbar"
                                    aria-label="Progres pembayaran paket"
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                    aria-valuenow={paidPercent}
                                >
                                    <div
                                        className="h-full rounded-full bg-emerald-600 transition-all"
                                        style={{ width: paidPercent + '%' }}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <h4 className="text-xs font-extrabold text-[#06315b]">
                                    Menunggu verifikasi
                                </h4>
                                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold text-amber-900">
                                    {pendingInstallments.length} bukti
                                </span>
                            </div>

                            {pendingInstallments.length > 0 ? (
                                <div className="space-y-3">
                                    {pendingInstallments.map((installment) => renderInstallment(installment, true))}
                                </div>
                            ) : (
                                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-xs text-slate-500">
                                    Tidak ada bukti pembayaran yang menunggu verifikasi.
                                </div>
                            )}
                        </div>

                        <details className="rounded-xl border border-slate-200">
                            <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-3 py-3 text-xs font-bold text-[#06315b]">
                                <span>Riwayat pembayaran</span>
                                <span className="text-[10px] font-semibold text-slate-500">
                                    {historyInstallments.length} transaksi · buka detail
                                </span>
                            </summary>
                            <div className="space-y-3 border-t border-slate-100 p-3">
                                {historyInstallments.length > 0 ? (
                                    historyInstallments.map((installment) => renderInstallment(installment, false))
                                ) : (
                                    <p className="text-xs text-slate-500">Belum ada pembayaran yang selesai diverifikasi atau ditolak.</p>
                                )}
                            </div>
                        </details>

                        {!canReview && (
                            <p className="text-[10px] text-slate-500">
                                Akun Anda hanya memiliki akses melihat. Keputusan pembayaran dilakukan oleh Super Admin atau Admin Verifikator.
                            </p>
                        )}
                    </>
                )}
            </section>

            {previewInstallment && (
                <div
                    className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 p-3 sm:p-6"
                    role="presentation"
                    onMouseDown={(event) => {
                        if (event.target === event.currentTarget) setPreviewInstallment(null);
                    }}
                >
                    <section
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="departure-receipt-preview-title"
                        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
                    >
                        <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                            <div className="min-w-0">
                                <h3 id="departure-receipt-preview-title" className="text-sm font-extrabold text-[#06315b]">
                                    Bukti pembayaran · Cicilan ke-{previewInstallment.installment_no}
                                </h3>
                                <p className="mt-0.5 truncate text-[11px] text-slate-500">
                                    {previewInstallment.original_filename || 'Bukti transfer'}
                                </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                                {previewInstallment.receipt_url && (
                                    <a
                                        href={previewInstallment.receipt_url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="rounded-lg border border-slate-300 px-3 py-2 text-[11px] font-bold text-[#06315b] hover:bg-slate-50"
                                    >
                                        Buka tab baru
                                    </a>
                                )}
                                <button
                                    type="button"
                                    onClick={() => setPreviewInstallment(null)}
                                    aria-label="Tutup preview bukti"
                                    className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200"
                                >
                                    Tutup
                                </button>
                            </div>
                        </header>

                        <div className="min-h-[300px] flex-1 overflow-auto bg-slate-100 p-2 sm:p-4">
                            {getFileKind(previewInstallment.original_filename) === 'pdf' ? (
                                <iframe
                                    title="Preview bukti transfer PDF"
                                    src={previewInstallment.receipt_url}
                                    className="h-[70vh] min-h-[420px] w-full rounded-lg border border-slate-300 bg-white"
                                />
                            ) : getFileKind(previewInstallment.original_filename) === 'image' ? (
                                <div className="flex min-h-[300px] items-center justify-center">
                                    {/* Signed private Storage URLs are previewed directly; no public image host is configured. */}
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={previewInstallment.receipt_url}
                                        alt={'Bukti pembayaran cicilan ke-' + previewInstallment.installment_no}
                                        className="max-h-[70vh] max-w-full rounded-lg object-contain shadow"
                                    />
                                </div>
                            ) : (
                                <div className="flex min-h-[300px] flex-col items-center justify-center gap-2 rounded-lg bg-white p-6 text-center">
                                    <p className="text-sm font-bold text-slate-700">Preview tidak tersedia untuk format file ini.</p>
                                    <a
                                        href={previewInstallment.receipt_url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-xs font-bold text-blue-700 underline"
                                    >
                                        Buka bukti di tab baru
                                    </a>
                                </div>
                            )}
                        </div>
                    </section>
                </div>
            )}
        </>
    );
}
