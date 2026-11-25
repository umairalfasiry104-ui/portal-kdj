'use client';

import { useState } from 'react';

function formatRupiah(value) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        maximumFractionDigits: 0
    }).format(Number(value) || 0);
}

function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        dateStyle: 'medium',
        timeStyle: 'short'
    }).format(date) + ' WIB';
}

const DELIVERY_LABEL = {
    PENDING: 'MENUNGGU ANTREAN',
    PROCESSING: 'SEDANG DIKIRIM',
    SENT: 'TERKIRIM',
    FAILED: 'GAGAL',
    UNKNOWN: 'PERLU REKONSILIASI'
};

export default function AdminFinancialDocumentsPanel({
    pendaftarId,
    documents = [],
    loading = false
}) {
    const [refreshedItems, setRefreshedItems] = useState(null);
    const items = refreshedItems ?? documents;
    const [busyOutboxId, setBusyOutboxId] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const refresh = async () => {
        if (!pendaftarId) return;
        const response = await fetch(
            '/api/financial-documents?pendaftar_id=' + encodeURIComponent(pendaftarId),
            { cache: 'no-store' }
        );
        const result = await response.json().catch(() => null);
        if (!response.ok || result?.success !== true) {
            throw new Error(result?.message || 'Gagal memuat ulang dokumen keuangan.');
        }
        setRefreshedItems(result.documents || []);
    };

    const runDeliveryAction = async (document, delivery, action) => {
        let reason = '';
        let providerMessageId = null;

        if (action === 'RESEND') {
            reason = window.prompt(
                'Alasan pengiriman ulang dokumen yang sama:',
                'Customer meminta dokumen dikirim ulang.'
            ) || '';
        } else if (action === 'RECONCILE_SENT') {
            providerMessageId = window.prompt(
                'Masukkan provider message ID sebagai bukti pesan sudah terkirim:',
                delivery.provider_message_id || ''
            ) || '';
            if (!providerMessageId.trim()) return;
            reason = window.prompt('Alasan konfirmasi bahwa dokumen sudah terkirim:') || '';
        } else if (action === 'RECONCILE_NOT_SENT') {
            reason = window.prompt(
                'Jelaskan hasil pengecekan provider bahwa dokumen belum terkirim:'
            ) || '';
        }

        if (reason.trim().length < 3) {
            setError('Alasan wajib diisi minimal 3 karakter.');
            return;
        }

        setBusyOutboxId(delivery.id);
        setError('');
        setSuccess('');
        try {
            const response = await fetch(
                '/api/admin/financial-documents/' + document.id + '/delivery',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action,
                        outbox_id: delivery.id,
                        reason: reason.trim(),
                        provider_message_id: providerMessageId
                    })
                }
            );
            const result = await response.json().catch(() => null);
            if (!response.ok || result?.success !== true) {
                throw new Error(result?.message || 'Tindakan pengiriman dokumen gagal.');
            }
            setSuccess(
                action === 'RESEND'
                    ? 'Dokumen dimasukkan kembali ke antrean menggunakan nomor dokumen dan PDF yang sama.'
                    : action === 'RECONCILE_SENT'
                        ? 'Status pengiriman direkonsiliasi sebagai TERKIRIM.'
                        : 'Status direkonsiliasi sebagai BELUM TERKIRIM dan dimasukkan ke antrean.'
            );
            await refresh();
        } catch (actionError) {
            setError(actionError?.message || 'Gagal memproses pengiriman dokumen.');
        } finally {
            setBusyOutboxId('');
        }
    };

    return (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
            <div>
                <h3 className="text-xs font-black uppercase text-[#06315b]">Invoice &amp; Kuitansi Keuangan</h3>
                <p className="mt-1 text-[11px] text-slate-500">
                    Arsip dokumen resmi, status pembayaran, dan pengiriman WhatsApp
                </p>
            </div>

            {error && (
                <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
                    {error}
                </p>
            )}
            {success && (
                <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800">
                    {success}
                </p>
            )}

            {loading ? (
                <p className="text-xs text-slate-500">Memuat invoice dan kuitansi...</p>
            ) : items.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-xs text-slate-500">
                    Belum ada invoice atau kuitansi yang diterbitkan untuk pendaftar ini.
                </p>
            ) : (
                <div className="space-y-3">
                    {items.map((document) => (
                        <article key={document.id} className="rounded-xl border border-slate-200 p-3 sm:p-4 space-y-3">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-xs font-extrabold text-[#06315b]">
                                            {document.document_type === 'INVOICE' ? 'INVOICE' : 'KUITANSI PEMBAYARAN'}
                                        </span>
                                        <span className="font-mono text-[10px] text-slate-500">{document.document_number}</span>
                                    </div>
                                    <p className="mt-1 text-base font-black text-slate-900">{formatRupiah(document.amount_idr)}</p>
                                    <p className="mt-1 text-[10px] text-slate-500">
                                        Terbit {formatDate(document.issued_at)}
                                        {document.due_at ? ' • Jatuh tempo ' + formatDate(document.due_at) : ''}
                                        {document.paid_at ? ' • Lunas ' + formatDate(document.paid_at) : ''}
                                    </p>
                                </div>
                                <span className={
                                    'rounded px-2.5 py-1 text-[9px] font-bold ' +
                                    (document.status === 'PAID'
                                        ? 'bg-emerald-100 text-emerald-800'
                                        : document.status === 'SUPERSEDED'
                                            ? 'bg-slate-100 text-slate-600'
                                            : document.status === 'VOID'
                                                ? 'bg-red-100 text-red-700'
                                                : 'bg-amber-100 text-amber-900')
                                }>
                                    {document.status === 'ISSUED' ? 'DITERBITKAN'
                                        : document.status === 'PAID' ? 'LUNAS'
                                            : document.status === 'SUPERSEDED' ? 'DIGANTIKAN'
                                                : 'DIBATALKAN'}
                                </span>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                                <a
                                    href={'/api/financial-documents/' + document.id + '/download'}
                                    className="rounded-lg bg-[#06315b] px-3 py-2 text-[11px] font-bold text-white hover:bg-[#042444]"
                                >
                                    Unduh PDF
                                </a>
                                {document.supersedes_document_id && (
                                    <span className="text-[10px] text-slate-500">
                                        Invoice pengganti; arsip sebelumnya tetap dipertahankan
                                    </span>
                                )}
                            </div>

                            {document.delivery?.length > 0 && (
                                <div className="space-y-2 border-t border-slate-100 pt-3">
                                    <p className="text-[10px] font-bold uppercase text-slate-500">Pengiriman WhatsApp</p>
                                    {document.delivery.map((delivery) => (
                                        <div key={delivery.id} className="flex flex-col gap-2 rounded-lg bg-slate-50 p-2.5 sm:flex-row sm:items-center sm:justify-between">
                                            <div>
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="font-mono text-[10px] text-slate-600">
                                                        {delivery.recipient_phone_masked || 'Nomor terdaftar'}
                                                    </span>
                                                    <span className={
                                                        'rounded px-2 py-0.5 text-[9px] font-bold ' +
                                                        (delivery.status === 'SENT' ? 'bg-emerald-100 text-emerald-800'
                                                            : delivery.status === 'FAILED' || delivery.status === 'UNKNOWN'
                                                                ? 'bg-red-100 text-red-800'
                                                                : 'bg-blue-100 text-blue-800')
                                                    }>
                                                        {DELIVERY_LABEL[delivery.status] || delivery.status}
                                                    </span>
                                                    <span className="text-[9px] text-slate-500">Percobaan: {delivery.attempts}</span>
                                                </div>
                                                {delivery.last_error_code && (
                                                    <p className="mt-1 text-[10px] text-red-700">
                                                        {delivery.last_error_code}: {delivery.last_error_message}
                                                    </p>
                                                )}
                                            </div>
                                            <div className="flex flex-wrap gap-1.5">
                                                {['FAILED', 'SENT'].includes(delivery.status) && (
                                                    <button
                                                        type="button"
                                                        disabled={busyOutboxId === delivery.id}
                                                        onClick={() => runDeliveryAction(document, delivery, 'RESEND')}
                                                        className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-[10px] font-bold text-slate-700 disabled:opacity-50"
                                                    >
                                                        {busyOutboxId === delivery.id ? 'Memproses...' : 'Kirim ulang'}
                                                    </button>
                                                )}
                                                {delivery.status === 'UNKNOWN' && (
                                                    <>
                                                        <button
                                                            type="button"
                                                            disabled={busyOutboxId === delivery.id}
                                                            onClick={() => runDeliveryAction(document, delivery, 'RECONCILE_SENT')}
                                                            className="rounded bg-emerald-700 px-2.5 py-1.5 text-[10px] font-bold text-white disabled:opacity-50"
                                                        >
                                                            Konfirmasi terkirim
                                                        </button>
                                                        <button
                                                            type="button"
                                                            disabled={busyOutboxId === delivery.id}
                                                            onClick={() => runDeliveryAction(document, delivery, 'RECONCILE_NOT_SENT')}
                                                            className="rounded bg-amber-700 px-2.5 py-1.5 text-[10px] font-bold text-white disabled:opacity-50"
                                                        >
                                                            Konfirmasi belum terkirim
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </article>
                    ))}
                </div>
            )}
        </section>
    );
}
