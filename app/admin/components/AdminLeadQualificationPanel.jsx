'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getQualificationSnapshot, groupQualificationEvents } from '@/lib/lead-qualification-summary.mjs';

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

function formatCategory(value) {
  const labels = {
    PROSPEK: 'Prospek',
    DINGIN: 'Dingin',
    BIMBANG: 'Bimbang',
    UNCLASSIFIED: 'Belum diklasifikasikan'
  };
  return labels[value] || value || '—';
}

function formatOperationalStatus(value) {
  const labels = {
    NORMAL: 'Normal',
    MASIH_BERTANYA: 'Masih bertanya'
  };
  return labels[value] || value || '—';
}

function getEventActorLabel(actorType) {
  if (actorType === 'BOT') return 'Rekomendasi Bot';
  if (actorType === 'ADMIN') return 'Keputusan Admin';
  if (actorType === 'SYSTEM') return 'Aktivitas Sistem';
  return 'Aktivitas';
}

function getEventActionLabel(event) {
  if (event.action === 'BOT_RECOMMENDATION') return 'Rekomendasi klasifikasi';
  if (event.action === 'INVALIDATED_BY_INBOUND') return 'Pesan baru diterima';
  return String(event.action || 'Aktivitas').replaceAll('_', ' ').toLowerCase();
}

export default function AdminLeadQualificationPanel({ isReadOnly = false }) {
  const [rows, setRows] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [drafts, setDrafts] = useState({});
  const [eventFilter, setEventFilter] = useState('ALL');
  const [eventSearch, setEventSearch] = useState('');
  const [showFullHistory, setShowFullHistory] = useState(false);

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

  const normalizedEventSearch = eventSearch.trim().toLowerCase();
  const eventsByQualification = useMemo(() => groupQualificationEvents(events), [events]);
  const filteredAccounts = rows.filter((row) => {
    const snapshot = getQualificationSnapshot(row);
    const accountEvents = eventsByQualification.get(row.id) || [];
    const searchableText = [
      row.phone_masked,
      formatCategory(snapshot.category),
      formatOperationalStatus(snapshot.operational_status),
      snapshot.actor_label,
      snapshot.status_note,
      row.recommendation_rationale,
      row.decision_reason,
      ...accountEvents.flatMap((event) => [
        getEventActorLabel(event.actor_type),
        getEventActionLabel(event),
        formatCategory(event.category),
        formatOperationalStatus(event.operational_status),
        event.rationale
      ])
    ].filter(Boolean).join(' ').toLowerCase();

    return !normalizedEventSearch || searchableText.includes(normalizedEventSearch);
  });

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
      {(rows.length > 0 || events.length > 0) && (
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-extrabold text-[#06315b]">Riwayat Klasifikasi</h3>
              <p className="text-xs text-slate-500 mt-1">
                Ringkasan status terkini. Setiap nomor WhatsApp ditampilkan satu kali; riwayat aktivitas tersedia di Detail.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                const nextValue = !showFullHistory;
                setShowFullHistory(nextValue);
                if (!nextValue && eventFilter === 'SYSTEM') setEventFilter('ALL');
              }}
              className="px-3 py-2 rounded-lg border border-slate-300 text-xs font-bold text-[#06315b] hover:bg-slate-50"
              aria-expanded={showFullHistory}
            >
              {showFullHistory ? 'Tutup Riwayat Lengkap' : 'Riwayat Lengkap'}
            </button>
          </div>

          <div className="mt-4 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
            <input
              type="search"
              value={eventSearch}
              onChange={(e) => setEventSearch(e.target.value)}
              placeholder="Cari nomor WhatsApp atau kategori"
              aria-label="Cari ringkasan dan riwayat klasifikasi"
              className="w-full sm:max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#06315b]/20"
            />
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter aktivitas dalam detail riwayat">
              {[
                { value: 'ALL', label: 'Semua' },
                { value: 'BOT', label: 'Bot' },
                { value: 'ADMIN', label: 'Admin' },
                ...(showFullHistory ? [{ value: 'SYSTEM', label: 'Sistem' }] : [])
              ].map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => setEventFilter(filter.value)}
                  aria-pressed={eventFilter === filter.value}
                  className={`rounded-full px-3 py-2 text-xs font-semibold border transition ${eventFilter === filter.value
                    ? 'bg-[#06315b] border-[#06315b] text-white'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>

          <p className="mt-3 text-[11px] text-slate-500">
            Menampilkan maksimal 300 akun terbaru. Filter Bot/Admin/Sistem hanya memengaruhi aktivitas di dalam Detail, bukan menggandakan atau menghilangkan ringkasan akun.
            {showFullHistory
              ? ' Riwayat lengkap mencakup aktivitas Sistem.'
              : ' Aktivitas Sistem disembunyikan dari ringkasan dan dapat dilihat melalui Riwayat Lengkap.'}
            {' '}Maksimal 100 aktivitas terbaru lintas akun tersedia dari server.
          </p>

          <div className="mt-3 rounded-xl border border-slate-200 divide-y divide-slate-100">
            {filteredAccounts.length === 0 ? (
              <p className="p-4 text-sm text-slate-500 text-center">
                {normalizedEventSearch ? 'Tidak ada akun yang cocok dengan pencarian.' : 'Belum ada akun yang memiliki status klasifikasi.'}
              </p>
            ) : filteredAccounts.map((row) => {
              const snapshot = getQualificationSnapshot(row);
              const accountEvents = eventsByQualification.get(row.id) || [];
              const visibleAccountEvents = accountEvents.filter((event) => {
                if (!showFullHistory && event.actor_type === 'SYSTEM') return false;
                return eventFilter === 'ALL' || event.actor_type === eventFilter;
              });

              return (
                <details key={row.id} className="group">
                  <summary className="list-none cursor-pointer p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-3 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#06315b]">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-sm font-bold text-[#06315b]">{row.phone_masked}</p>
                      <p className="mt-1 text-[11px] text-slate-500">Status diperbarui: {formatDate(row.updated_at || snapshot.status_at)}</p>
                    </div>
                    <div className="sm:min-w-[150px]">
                      <p className="text-sm font-bold text-slate-800">{formatCategory(snapshot.category)}</p>
                      <p className="mt-1 text-xs text-slate-500">{formatOperationalStatus(snapshot.operational_status)}</p>
                    </div>
                    <div className="flex items-center justify-between sm:justify-end gap-3 sm:min-w-[190px]">
                      <div className="text-right">
                        <span className={`rounded-full px-3 py-1 text-[11px] font-bold ${
                          snapshot.actor_type === 'BOT'
                            ? 'bg-blue-50 text-blue-700'
                            : snapshot.actor_type === 'ADMIN'
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-slate-100 text-slate-600'
                        }`}>
                          {snapshot.actor_label}
                        </span>
                        <p className="mt-1 text-[10px] text-slate-500">{snapshot.status_note}</p>
                      </div>
                      <span className="text-xs font-semibold text-[#06315b] group-open:hidden">Detail +</span>
                      <span className="text-xs font-semibold text-[#06315b] hidden group-open:inline">Tutup −</span>
                    </div>
                  </summary>

                  <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-3 text-xs space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <p className="text-slate-500">Keputusan / rekomendasi yang berlaku</p>
                        <p className="mt-1 font-semibold text-slate-800">{snapshot.actor_label}</p>
                        <p className="mt-1 text-slate-600">{snapshot.status_note}</p>
                      </div>
                      <div>
                        <p className="text-slate-500">Waktu status tersebut</p>
                        <p className="mt-1 font-semibold text-slate-800">{formatDate(snapshot.status_at || row.updated_at)}</p>
                      </div>
                    </div>

                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <p className="font-bold text-slate-700">Riwayat aktivitas nomor ini</p>
                        <p className="text-[10px] text-slate-500">{visibleAccountEvents.length} aktivitas sesuai filter</p>
                      </div>
                      {visibleAccountEvents.length === 0 ? (
                        <p className="rounded-lg border border-slate-200 bg-white p-3 text-slate-500">
                          {accountEvents.length === 0
                            ? 'Tidak ada aktivitas nomor ini dalam 100 aktivitas terbaru yang dikirim server.'
                            : 'Tidak ada aktivitas yang cocok dengan filter. Ubah filter untuk melihat aktivitas lainnya.'}
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {visibleAccountEvents.map((event) => (
                            <div key={event.id} className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                  <p className="font-semibold text-slate-800">{getEventActionLabel(event)}</p>
                                  <p className="mt-1 text-[11px] text-slate-500">{formatDate(event.created_at)}</p>
                                </div>
                                <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
                                  event.actor_type === 'BOT'
                                    ? 'bg-blue-50 text-blue-700'
                                    : event.actor_type === 'ADMIN'
                                      ? 'bg-emerald-50 text-emerald-700'
                                      : 'bg-slate-100 text-slate-600'
                                }`}>
                                  {getEventActorLabel(event.actor_type)}
                                  {event.actor_admin_id ? ` · ${event.actor_admin_id.slice(0, 8)}` : ''}
                                </span>
                              </div>
                              <p className="text-slate-700">
                                {formatCategory(event.category)} · {formatOperationalStatus(event.operational_status)}
                              </p>
                              <div>
                                <p className="text-slate-500">Alasan / catatan</p>
                                <p className="mt-1 leading-relaxed text-slate-700">{event.rationale || 'Tidak ada catatan tambahan.'}</p>
                              </div>
                              {showFullHistory && event.action && (
                                <p className="text-[10px] text-slate-500">Kode aktivitas: <span className="font-mono">{event.action}</span></p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}
