'use client';

import Link from 'next/link';
import {
    canViewDeparturePayments,
    canReviewDeparturePayments
} from '../lib/admin-access';

const INSTALLMENT_STATUS_STYLE = {
    VERIFIED: 'bg-emerald-100 text-emerald-800',
    REJECTED: 'bg-red-100 text-red-800'
};

/**
 * Panel verifikasi cicilan paket keberangkatan pada detail pendaftar.
 * Presentasi murni: seluruh mutasi data ditangani lewat prop onReview.
 */
export default function AdminDepartureReviewPanel({
    statusPendaftaran,
    adminRole,
    info,
    loading,
    reviewingInstallmentId,
    onReview
}) {
    if (statusPendaftaran !== 'Approved' || !canViewDeparturePayments(adminRole)) {
        return null;
    }

    const order = info?.order || null;
    const installments = info?.installments || [];
    const canReview = canReviewDeparturePayments(adminRole);

    const handleReject = (installmentId) => {
        const reason = window.prompt(
            'Masukkan alasan penolakan cicilan (min. 3 karakter):',
            ''
        );
        if (reason && reason.trim().length >= 3) {
            onReview(installmentId, 'REJECT', reason);
        }
    };

    return (
        <section className="rounded-2xl border-2 border-amber-400 bg-amber-50/40 p-4 sm:p-5 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
                <h3 className="text-xs font-black text-[#06315b] uppercase">
                    Status &amp; Verifikasi Cicilan Paket Keberangkatan
                </h3>
                {order && (
                    <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                        order.payment_status === 'PAID'
                            ? 'bg-emerald-200 text-emerald-800'
                            : 'bg-amber-200 text-amber-900'
                    }`}>
                        {order.payment_status === 'PAID' ? 'LUNAS 100%' : 'BELUM LUNAS'}
                    </span>
                )}
            </div>

            {loading ? (
                <p className="text-xs text-slate-500 italic">Memuat data pembayaran paket...</p>
            ) : !order ? (
                <p className="text-xs text-slate-500 italic">Pendaftar belum memilih paket keberangkatan di portal.</p>
            ) : (
                <div className="space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs bg-white p-3 rounded-xl border border-amber-200">
                        <div>
                            <p className="text-[10px] text-slate-500 font-bold uppercase">Paket</p>
                            <p className="font-extrabold text-[#06315b]">{order.package_name}</p>
                        </div>
                        <div>
                            <p className="text-[10px] text-slate-500 font-bold uppercase">Total Biaya</p>
                            <p className="font-bold text-slate-900 font-mono">Rp {order.total_amount_idr.toLocaleString('id-ID')}</p>
                        </div>
                        <div>
                            <p className="text-[10px] text-slate-500 font-bold uppercase">Sudah Masuk</p>
                            <p className="font-bold text-emerald-700 font-mono">Rp {order.paid_amount_idr.toLocaleString('id-ID')}</p>
                        </div>
                        <div>
                            <p className="text-[10px] text-slate-500 font-bold uppercase">Sisa Pelunasan</p>
                            <p className="font-bold text-amber-800 font-mono">Rp {order.remaining_amount_idr.toLocaleString('id-ID')}</p>
                        </div>
                    </div>

                    {installments.length > 0 && (
                        <div className="space-y-2">
                            <p className="text-[11px] font-bold text-slate-700 uppercase">Riwayat &amp; Verifikasi Cicilan:</p>
                            {installments.map((inst) => (
                                <div key={inst.id} className="p-3 bg-white rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold text-[#06315b]">Cicilan ke-{inst.installment_no}</span>
                                            <span className="font-mono font-black text-slate-900">Rp {inst.amount_idr.toLocaleString('id-ID')}</span>
                                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                                INSTALLMENT_STATUS_STYLE[inst.status] || 'bg-blue-100 text-blue-800'
                                            }`}>
                                                {inst.status}
                                            </span>
                                        </div>
                                        <p className="text-[10px] text-slate-500 mt-0.5">
                                            Diajukan: {new Date(inst.submitted_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB
                                        </p>
                                        {inst.rejection_reason && (
                                            <p className="text-[10px] text-red-600 mt-0.5">Alasan tolak: &quot;{inst.rejection_reason}&quot;</p>
                                        )}
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0">
                                        {inst.receipt_url && (
                                            <Link href={inst.receipt_url} target="_blank" rel="noreferrer" className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded font-bold text-[11px]">
                                                Lihat Struk
                                            </Link>
                                        )}

                                        {inst.status === 'PENDING_VERIFICATION' && canReview && (
                                            <div className="flex items-center gap-1.5">
                                                <button
                                                    type="button"
                                                    disabled={reviewingInstallmentId === inst.id}
                                                    onClick={() => onReview(inst.id, 'APPROVE')}
                                                    className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded font-bold text-[11px] disabled:opacity-50"
                                                >
                                                    {reviewingInstallmentId === inst.id ? 'Memproses...' : 'Setujui ✅'}
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={reviewingInstallmentId === inst.id}
                                                    onClick={() => handleReject(inst.id)}
                                                    className="px-2.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded font-bold text-[11px] disabled:opacity-50"
                                                >
                                                    Tolak ❌
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}
