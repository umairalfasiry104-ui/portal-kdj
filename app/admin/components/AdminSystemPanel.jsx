'use client';

import { useCallback, useEffect, useState } from 'react';

const STATUS_CLASS = {
  OK: 'bg-emerald-100 text-emerald-800',
  DEGRADED: 'bg-amber-100 text-amber-800',
  STARTING: 'bg-sky-100 text-sky-800',
  DOWN: 'bg-red-100 text-red-800',
  UNKNOWN: 'bg-slate-100 text-slate-700',
  NOT_CONFIGURED: 'bg-slate-100 text-slate-700'
};

function label(value) {
  return String(value || '').replaceAll('_', ' ');
}

function formatDate(value) {
  if (!value) return 'Belum ada heartbeat';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Waktu tidak valid';
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short'
  }).format(date) + ' WIB';
}

export default function AdminSystemPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyIncident, setBusyIncident] = useState('');

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/system', { cache: 'no-store' });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) throw new Error(result?.message || 'Monitoring gagal dimuat.');
      setError('');
      setData(result);
    } catch (err) {
      setError(err.message || 'Monitoring tidak tersedia.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    fetch('/api/admin/system', { cache: 'no-store' })
      .then(async (response) => {
        const result = await response.json().catch(() => null);
        return { response, result };
      })
      .then(({ response, result }) => {
        if (!response.ok || !result?.success) {
          throw new Error(result?.message || 'Monitoring gagal dimuat.');
        }
        if (active) {
          setError('');
          setData(result);
        }
      })
      .catch((err) => {
        if (active) setError(err.message || 'Monitoring tidak tersedia.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const updateIncident = async (incident, action) => {
    let notes = '';
    if (action === 'RESOLVE') {
      notes = window.prompt('Catatan penyelesaian incident (minimal 5 karakter):', 'Kondisi telah diperiksa dan pulih.') || '';
      if (notes.trim().length < 5) return;
    }

    setBusyIncident(incident.id);
    try {
      const response = await fetch('/api/admin/system', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, incident_id: incident.id, notes })
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) throw new Error(result?.message || 'Aksi incident gagal.');
      await refresh();
    } catch (err) {
      window.alert(err.message || 'Aksi incident gagal.');
    } finally {
      setBusyIncident('');
    }
  };

  return (
    <main className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
      <section className="bg-white rounded-2xl border-t-4 border-[#06315b] shadow-sm p-4 sm:p-5">
        <div className="flex flex-wrap justify-between items-center gap-3">
          <div>
            <h2 className="font-extrabold text-[#06315b] text-lg">Pemantauan Sistem KDJ</h2>
            <p className="text-xs text-slate-500 mt-1">Heartbeat aplikasi, status koneksi, dan incident operasional.</p>
          </div>
          <button type="button" onClick={() => { setLoading(true); setError(''); void refresh(); }} disabled={loading}
            className="px-4 py-2 rounded-lg bg-[#06315b] text-amber-300 text-xs font-bold disabled:opacity-50">
            {loading ? 'Memuat...' : 'Refresh Monitoring'}
          </button>
        </div>
        {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {data && (
          <>
            <p className="mt-3 text-[11px] text-slate-500">Snapshot: {formatDate(data.generated_at)} · Monitoring: {data.monitoring_level}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
              {data.components.map((component) => (
                <article key={component.component} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex justify-between items-center gap-2">
                    <h3 className="font-bold text-sm text-[#06315b]">{label(component.component)}</h3>
                    <span className={`px-2 py-1 rounded-full text-[10px] font-extrabold ${STATUS_CLASS[component.status] || STATUS_CLASS.UNKNOWN}`}>{component.status}</span>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-2">{formatDate(component.observed_at)}</p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    {component.age_seconds === null ? 'Umur heartbeat: —' : `Heartbeat ${component.age_seconds} detik lalu`}
                    {component.latency_ms !== null ? ` · ${component.latency_ms} ms` : ''}
                  </p>
                  {component.details?.state && <p className="text-[10px] text-slate-400 mt-1">State: {component.details.state}</p>}
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      {data && (
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-5">
          <div className="flex flex-wrap justify-between items-center gap-3 border-b border-slate-100 pb-3">
            <div>
              <h2 className="font-extrabold text-[#06315b]">Incident Operasional</h2>
              <p className="text-xs text-slate-500">Acknowledge dan resolve tercatat pada incident event ledger.</p>
            </div>
            <span className="text-xs font-bold text-slate-600">{data.incidents.filter((item) => item.status !== 'RESOLVED').length} aktif</span>
          </div>
          <div className="divide-y divide-slate-100">
            {data.incidents.length === 0 ? <p className="py-5 text-sm text-slate-500">Belum ada incident tercatat.</p> : data.incidents.map((incident) => (
              <article key={incident.id} className="py-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className={`rounded px-2 py-1 text-[10px] font-extrabold ${incident.severity === 'P0' ? 'bg-red-100 text-red-800' : incident.severity === 'P1' ? 'bg-orange-100 text-orange-800' : 'bg-amber-100 text-amber-800'}`}>{incident.severity}</span>
                    <span className="text-[10px] font-bold text-slate-500">{incident.status}</span>
                    <span className="text-[10px] text-slate-400">{label(incident.module)}</span>
                  </div>
                  <h3 className="font-bold text-sm text-slate-800 mt-1">{incident.title}</h3>
                  <p className="text-[11px] text-slate-500 mt-1">Terakhir terlihat: {formatDate(incident.last_seen_at)} · {incident.occurrence_count} kejadian</p>
                  {incident.resolution_notes && <p className="text-xs text-slate-600 mt-2">Catatan: {incident.resolution_notes}</p>}
                </div>
                {incident.status !== 'RESOLVED' && (
                  <div className="flex gap-2 shrink-0">
                    {incident.status === 'OPEN' && <button type="button" disabled={busyIncident === incident.id} onClick={() => void updateIncident(incident, 'ACKNOWLEDGE')} className="rounded-lg border border-amber-500 px-3 py-2 text-[11px] font-bold text-amber-900 disabled:opacity-50">Acknowledge</button>}
                    <button type="button" disabled={busyIncident === incident.id} onClick={() => void updateIncident(incident, 'RESOLVE')} className="rounded-lg bg-[#06315b] px-3 py-2 text-[11px] font-bold text-white disabled:opacity-50">Resolve</button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {data?.limitations?.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h3 className="font-bold text-sm text-amber-900">Komponen monitoring lanjutan belum aktif</h3>
          <ul className="list-disc pl-5 mt-2 space-y-1 text-xs text-amber-900">
            {data.limitations.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
      )}
    </main>
  );
}
