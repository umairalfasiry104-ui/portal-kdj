'use client';

import { useCallback, useEffect, useState } from 'react';

function formatRupiah(value) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        maximumFractionDigits: 0
    }).format(Number(value) || 0);
}

function formatDate(value, withTime = false) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        dateStyle: 'medium',
        ...(withTime ? { timeStyle: 'short' } : {})
    }).format(date) + (withTime ? ' WIB' : '');
}

function statusLabel(status) {
    if (status === 'PAID') return 'LUNAS';
    if (status === 'SUPERSEDED') return 'DIGANTIKAN';
    if (status === 'VOID') return 'DIBATALKAN';
    return 'DITERBITKAN';
}

export default function FinancialDocumentsList({
    title = 'Invoice & Kwitansi Pembayaran',
    description = 'Arsip resmi tagihan dan bukti pembayaran Anda.',
    compact = false
}) {
    const [documents, setDocuments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState('');

    const fetchDocuments = useCallback(async () => {
        const response = await fetch('/api/financial-documents', {
            cache: 'no-store',
            headers: { Accept: 'application/json' }
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || result?.success !== true) {
            throw new Error(result?.message || 'Gagal memuat dokumen keuangan.');
        }
        return Array.isArray(result.documents) ? result.documents : [];
    }, []);

    useEffect(() => {
        let active = true;
        const applyDocuments = (nextDocuments) => {
            if (!active) return;
            setDocuments(nextDocuments);
            setError('');
            setLoading(false);
            setRefreshing(false);
        };
        const applyError = (loadError) => {
            if (!active) return;
            setError(loadError?.message || 'Gagal memuat invoice dan kwitansi.');
            setLoading(false);
            setRefreshing(false);
        };
        const load = () => {
            fetchDocuments().then(applyDocuments).catch(applyError);
        };
        load();
        window.addEventListener('focus', load);
        return () => {
            active = false;
            window.removeEventListener('focus', load);
        };
    }, [fetchDocuments]);

    const refresh = () => {
        setRefreshing(true);
        fetchDocuments()
            .then((nextDocuments) => {
                setDocuments(nextDocuments);
                setError('');
            })
            .catch((loadError) => {
                setError(loadError?.message || 'Gagal memuat invoice dan kwitansi.');
            })
            .finally(() => setRefreshing(false));
    };

    return (
        <section className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                    <h3 className="text-xs font-black uppercase text-[#06315b]">{title}</h3>
                    <p className="mt-1 text-[11px] text-slate-500">{description}</p>
                </div>
                <button
                    type="button"
                    onClick={refresh}
                    disabled={refreshing || loading}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[10px] font-bold text-slate-700 disabled:opacity-50"
                >
                    {refreshing ? 'Memuat...' : 'Perbarui'}
                </button>
            </div>

            {error && (
                <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                    {error}
                </p>
            )}

            {loading ? (
                <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">Memuat invoice dan kwitansi...</p>
            ) : documents.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-300 bg-white p-3 text-xs text-slate-500">
                    Belum ada invoice atau kwitansi yang diterbitkan.
                </p>
            ) : (
                <div className={compact ? 'space-y-2' : 'space-y-2.5'}>
                    {documents.map((document) => (
                        <article
                            key={document.id}
                            className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-xs font-extrabold text-[#06315b]">
                                        {document.document_type === 'INVOICE' ? 'INVOICE' : 'KWITANSI'}
                                    </span>
                                    <span className="font-mono text-[10px] text-slate-500">{document.document_number}</span>
                                    <span className={
                                        'rounded px-2 py-0.5 text-[9px] font-bold ' +
                                        (document.status === 'PAID'
                                            ? 'bg-emerald-100 text-emerald-800'
                                            : document.status === 'SUPERSEDED'
                                                ? 'bg-slate-100 text-slate-600'
                                                : document.status === 'VOID'
                                                    ? 'bg-red-100 text-red-700'
                                                    : 'bg-amber-100 text-amber-900')
                                    }>
                                        {statusLabel(document.status)}
                                    </span>
                                </div>
                                <p className="mt-1 text-sm font-black text-slate-900">{formatRupiah(document.amount_idr)}</p>
                                <p className="text-[10px] text-slate-500">
                                    Terbit {formatDate(document.issued_at, true)}
                                    {document.due_at ? ' • Jatuh tempo ' + formatDate(document.due_at) : ''}
                                    {document.paid_at ? ' • Lunas ' + formatDate(document.paid_at) : ''}
                                </p>
                                {!document.rendered_at && (
                                    <p className="mt-1 text-[10px] text-amber-700">
                                        PDF akan disiapkan saat diunduh.
                                    </p>
                                )}
                                {document.supersedes_document_id && (
                                    <p className="mt-1 text-[10px] text-slate-500">
                                        Invoice pengganti; arsip sebelumnya tetap tersimpan.
                                    </p>
                                )}
                            </div>
                            <a
                                href={'/api/financial-documents/' + document.id + '/download'}
                                className="inline-flex shrink-0 items-center justify-center rounded-lg bg-[#06315b] px-3 py-2 text-[11px] font-bold text-white hover:bg-[#042444]"
                            >
                                Unduh PDF
                            </a>
                        </article>
                    ))}
                </div>
            )}
        </section>
    );
}
