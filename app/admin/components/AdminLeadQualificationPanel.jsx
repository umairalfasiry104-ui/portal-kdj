'use client';

import { useCallback, useEffect, useState } from 'react';

const CATEGORIES = [
  { value: 'PROSPEK', label: 'Prospek' },
  { value: 'DINGIN', label: 'Dingin' },
  { value: 'BIMBANG', label: 'Bimbang' }
];
const OPERATIONAL = [
  { value: 'NORMAL', label: 'Normal' },
  { value: 'MASIH_BERTANYA', label: 'Masih Bertanya' }
];

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Waktu tidak valid';
  return new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' }).format(date) + ' WIB';
}

export default function AdminLeadQualificationPanel({ isReadOnly = false }) {
  const [rows, setRows] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [drafts, setDrafts] = useState({});

  const fetchQualifications = useCallback(async () => {
    const response = await fetch('/api/admin/lead-qualification', { cache: 'no-store' });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.success) {
      throw new Error(result?.message || 'Gagal memuat lead.');
    }
    return result;
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchQualifications();
      setRows(result.qualifications || []);
      setEvents(result.events || []);
      setError('');
    } catch (err) {
      setError(err.message || 'Gagal memuat lead.');
    } finally {
      setLoading(false);
    }
  }, [fetchQualifications]);

  useEffect(() => {
    let active = true;

    fetchQualifications()
      .then((result) => {
        if (!active) return;
        setRows(result.qualifications || []);
        setEvents(result.events || []);
        setError('');
      })
      .catch((err) => {
        if (active) setError(err.message || 'Gagal memuat lead.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [fetchQualifications]);

  const updateDraft = (row, patch) => setDrafts((current) => {
    const id = row.id;
    const existing = current[id] || {
      category: row.qualification_status === 'CONFIRMED' ? row.confirmed_category : '',
      operational_status: row.confirmed_operational_status || row.recommendation_operational_status || 'NORMAL',
      reason: ''
    };
    return { ...current, [id]: { ...existing, ...patch } };
  });

  const submit = async (row) => {
    const draft = drafts[row.id] || { category: row.qualification_status === 'CONFIRMED' ? row.confirmed_category : '', operational_status: row.confirmed_operational_status || row.recommendation_operational_status || 'NORMAL', reason: '' };
    if (!CATEGORIES.some((item) => item.value === draft.category)) { setError('Pilih klasifikasi final sebelum menyimpan.'); return; }
    if (!draft.reason || draft.reason.trim().length < 5) { setError('Alasan keputusan minimal 5 karakter.'); return; }
    setBusy(row.id); setError('');
    try {
      const response = await fetch('/api/admin/lead-qualification', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qualification_id: row.id, expected_sequence_id: row.sequence_id || null, ...draft, reason: draft.reason.trim() })
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) throw new Error(result?.message || 'Gagal menyimpan klasifikasi.');
      await refresh();
    } catch (err) { setError(err.message || 'Gagal menyimpan klasifikasi.'); }
    finally { setBusy(''); }
  };

  return (
    <main className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
      <section className="bg-white rounded-2xl border-t-4 border-[#06315b] shadow-sm p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-extrabold text-lg text-[#06315b]">Lead Qualification Review</h2>
            <p className="text-xs text-slate-500 mt-1">Bot hanya memberi rekomendasi. Klasifikasi final memerlukan keputusan Admin.</p>
          </div>
          <button type="button" onClick={() => void refresh()} disabled={loading} className="px-4 py-2 rounded-lg bg-[#06315b] text-amber-300 text-xs font-bold disabled:opacity-50">{loading ? 'Memuat...' : 'Refresh Lead'}</button>
        </div>
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          Follow Up hanya eligible untuk kategori final <b>Dingin</b>, status operasional <b>Normal</b>, consent aktif, idle minimal 30 menit, dan seluruh stop-condition lolos. Pengiriman WhatsApp tetap BLOCKED.
        </div>
        {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 border border-red-200 text-red-700 p-3 text-sm">{error}</p>}
      </section>
      {loading && rows.length === 0 ? <p className="text-sm text-slate-500">Memuat data lead…</p> : rows.length === 0 ? <p className="rounded-xl bg-white border p-4 sm:p-5 text-sm text-slate-500">Belum ada lead yang masuk ke modul qualification.</p> : rows.map((row) => {
        const draft = drafts[row.id] || { category: row.qualification_status === 'CONFIRMED' ? row.confirmed_category : '', operational_status: row.confirmed_operational_status || row.recommendation_operational_status || 'NORMAL', reason: '' };
        return (
          <section key={row.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 space-y-3">
            <div className="flex flex-wrap justify-between gap-2">
              <div>
                <p className="font-mono font-bold text-[#06315b]">{row.phone_masked}</p>
                <p className="text-xs text-slate-500">Inbound terakhir: {formatDate(row.last_inbound_at)} · Sequence: {row.sequence_status || '—'}</p>
              </div>
              <span className="text-xs rounded-full px-3 py-1 bg-slate-100 font-bold">{row.qualification_status === 'CONFIRMED' ? `FINAL: ${row.confirmed_category}` : 'MENUNGGU REVIEW'}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
              <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Rekomendasi Bot</p><b>{row.recommendation_category || 'UNCLASSIFIED'}</b><p className="text-xs mt-1 text-slate-600">{row.recommendation_rationale || 'Belum ada rekomendasi.'}</p></div>
              <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Consent</p><b>{row.opted_out ? 'Opt-out' : row.consent_granted ? 'Aktif' : 'Belum diberikan'}</b><p className="text-xs mt-1 text-slate-600">Eligibility bukan hanya berdasarkan klasifikasi.</p></div>
              <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Alasan blokir FU</p><b>{row.sequence_stop_reason || '—'}</b><p className="text-xs mt-1 text-slate-600">Due time tetap dihitung dari inbound terakhir.</p></div>
            </div>
            {!isReadOnly && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <label className="text-xs font-semibold text-slate-600">Klasifikasi final
                    <select value={draft.category} onChange={(e) => updateDraft(row, { category: e.target.value })} className="mt-1 w-full border rounded-lg p-2 bg-white">
                      <option value="">Pilih klasifikasi…</option>
                      {CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                  </label>
                  <label className="text-xs font-semibold text-slate-600">Status operasional
                    <select value={draft.operational_status} onChange={(e) => updateDraft(row, { operational_status: e.target.value })} className="mt-1 w-full border rounded-lg p-2 bg-white">
                      {OPERATIONAL.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                  </label>
                  <label className="text-xs font-semibold text-slate-600">Alasan keputusan (wajib)
                    <input value={draft.reason} onChange={(e) => updateDraft(row, { reason: e.target.value })} maxLength={500} placeholder="Alasan berdasarkan konteks lead" className="mt-1 w-full border rounded-lg p-2" />
                  </label>
                </div>
                <div className="flex justify-end">
                  <button type="button" onClick={() => void submit(row)} disabled={busy === row.id || !draft.category} className="px-4 py-2 rounded-lg bg-[#06315b] text-white text-xs font-bold disabled:opacity-50">{busy === row.id ? 'Menyimpan…' : 'Simpan Keputusan Admin'}</button>
                </div>
              </>
            )}
            {isReadOnly && (
              <div className="text-xs text-slate-500 italic bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                Mode Read-Only: Akun Admin Viewer hanya dapat memantau klasifikasi dan status leads tanpa izin mengubah keputusan.
              </div>
            )}
          </section>
        );
      })}
      {events.length > 0 && (
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5">
          <h3 className="font-extrabold text-[#06315b]">Riwayat Klasifikasi Terbaru</h3>
          <p className="text-xs text-slate-500 mt-1">Jejak rekomendasi Bot dan keputusan Admin; keputusan final tidak dapat ditulis oleh Bot.</p>
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-xs text-left min-w-[720px]">
              <thead className="bg-slate-50 text-slate-600"><tr><th className="p-2">Waktu</th><th className="p-2">Lead</th><th className="p-2">Aktor</th><th className="p-2">Aksi</th><th className="p-2">Kategori</th><th className="p-2">Alasan</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {events.slice(0, 30).map((event) => (
                  <tr key={event.id}>
                    <td className="p-2 whitespace-nowrap">{formatDate(event.created_at)}</td>
                    <td className="p-2 font-mono">{event.phone_masked}</td>
                    <td className="p-2">{event.actor_type}{event.actor_admin_id ? ` · ${event.actor_admin_id.slice(0, 8)}` : ''}</td>
                    <td className="p-2">{event.action}</td>
                    <td className="p-2">{event.category} / {event.operational_status}</td>
                    <td className="p-2 text-slate-600 max-w-sm">{event.rationale || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
