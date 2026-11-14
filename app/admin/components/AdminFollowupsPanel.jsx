'use client';

import { useCallback, useEffect, useState } from 'react';

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Waktu tidak valid';
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short'
  }).format(date) + ' WIB';
}

export default function AdminFollowupsPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyProfile, setBusyProfile] = useState('');

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/followups', { cache: 'no-store' });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) throw new Error(result?.message || 'Data FU gagal dimuat.');
      setError('');
      setData(result);
    } catch (err) {
      setError(err.message || 'Data FU tidak tersedia.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    fetch('/api/admin/followups', { cache: 'no-store' })
      .then(async (response) => {
        const result = await response.json().catch(() => null);
        return { response, result };
      })
      .then(({ response, result }) => {
        if (!response.ok || !result?.success) {
          throw new Error(result?.message || 'Data FU gagal dimuat.');
        }
        if (active) {
          setError('');
          setData(result);
        }
      })
      .catch((err) => {
        if (active) setError(err.message || 'Data FU tidak tersedia.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const stopProfile = async (profile) => {
    const reason = window.prompt(`Alasan menghentikan FU untuk ${profile.phone_masked} (wajib dicatat):`, 'Dihentikan manual oleh Super Admin.');
    if (!reason || reason.trim().length < 5) return;

    setBusyProfile(profile.profile_id);
    try {
      const response = await fetch('/api/admin/followups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: profile.profile_id, reason: reason.trim() })
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) throw new Error(result?.message || 'Penghentian FU gagal.');
      await refresh();
    } catch (err) {
      window.alert(err.message || 'Penghentian FU gagal.');
    } finally {
      setBusyProfile('');
    }
  };

  const counts = data?.summary?.jobs_by_status || {};
  return (
    <main className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
      <section className="bg-white rounded-2xl border-t-4 border-[#06315b] shadow-sm p-4 sm:p-5">
        <div className="flex flex-wrap justify-between items-center gap-3">
          <div>
            <h2 className="font-extrabold text-[#06315b] text-lg">Follow Up H+1 / H+3 / H+7</h2>
            <p className="text-xs text-slate-500 mt-1">Sequence dihitung dari inbound terakhir. Evaluator menunggu idle 30 menit, review klasifikasi Admin, dan seluruh stop-condition.</p>
          </div>
          <button type="button" onClick={() => { setLoading(true); setError(''); void refresh(); }} disabled={loading} className="px-4 py-2 rounded-lg bg-[#06315b] text-amber-300 text-xs font-bold disabled:opacity-50">
            {loading ? 'Memuat...' : 'Refresh FU'}
          </button>
        </div>
        {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {data && (
          <>
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-red-100 px-2.5 py-1 text-[10px] font-extrabold text-red-800">DELIVERY BLOCKED</span>
                <span className="text-xs font-bold text-red-900">Compliance status: {data.gate?.compliance_status || 'BLOCKED'}</span>
              </div>
              <p className="text-xs text-red-800 mt-2">Job FU hanya dicatat dan ditahan. Tidak ada pesan WhatsApp FU yang dikirim otomatis dari rilis ini.</p>
              <p className="text-[11px] text-red-700 mt-1">Aktivasi tetap membutuhkan review consent, channel-policy, kelayakan teknologi pengiriman, dan persetujuan release gate.</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
              {[
                ['Profil lead', data.summary.profiles],
                ['Consent aktif', data.summary.consented],
                ['Opt-out', data.summary.opted_out],
                ['Total job', data.summary.jobs]
              ].map(([title, value]) => (
                <article key={title} className="rounded-xl border border-slate-200 p-4">
                  <p className="text-[11px] text-slate-500">{title}</p>
                  <p className="text-2xl font-extrabold text-[#06315b] mt-1">{value}</p>
                </article>
              ))}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 mt-3">
              {Object.entries(counts).map(([status, count]) => (
                <div key={status} className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                  <p className="text-[10px] font-bold text-slate-500">{status}</p>
                  <p className="text-lg font-extrabold text-slate-800">{count}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {data && (
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-extrabold text-[#06315b]">Kontrol Sequence per Lead</h2>
            <span className="text-[10px] text-slate-500">Stop manual hanya oleh Super Admin</span>
          </div>
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-xs text-left min-w-[860px]">
              <thead className="bg-slate-50 text-slate-600"><tr><th className="p-2">Penerima</th><th className="p-2">Consent</th><th className="p-2">Klasifikasi</th><th className="p-2">Sequence</th><th className="p-2">Inbound terakhir</th><th className="p-2">Aksi</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.profiles.length === 0 ? <tr><td colSpan={6} className="p-4 text-slate-500">Belum ada profil follow-up.</td></tr> : data.profiles.map((profile) => (
                  <tr key={profile.profile_id}>
                    <td className="p-2 font-mono">{profile.phone_masked}</td>
                    <td className="p-2">{profile.opted_out ? 'Opt-out' : profile.consent_granted ? 'Setuju' : 'Belum setuju'}</td>
                    <td className="p-2">{profile.qualification?.qualification_status === 'CONFIRMED' ? profile.qualification.confirmed_category : profile.qualification?.recommendation_category || 'UNCLASSIFIED'}<div className="text-[10px] text-slate-400">{profile.qualification?.qualification_status === 'CONFIRMED' ? 'FINAL ADMIN' : 'PENDING REVIEW'}</div></td>
                    <td className="p-2">{profile.sequence_status}{profile.stop_reason ? ` · ${profile.stop_reason}` : ''}</td>
                    <td className="p-2">{formatDate(profile.last_inbound_at)}</td>
                    <td className="p-2">{profile.admin_stopped_at ? <span className="font-bold text-red-700">Dihentikan</span> : !profile.opted_out && ['AWAITING_IDLE', 'AWAITING_ADMIN_REVIEW', 'ACTIVE'].includes(profile.sequence_status) ? <button type="button" disabled={busyProfile === profile.profile_id} onClick={() => void stopProfile(profile)} className="rounded-lg border border-red-300 px-2 py-1 font-bold text-red-700 disabled:opacity-50">{busyProfile === profile.profile_id ? 'Menyimpan...' : 'Stop FU'}</button> : <span className="text-slate-400">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {data && (
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5">
          <h2 className="font-extrabold text-[#06315b]">Antrean FU</h2>
          <p className="text-xs text-slate-500 mt-1">Nomor disamarkan. UNKNOWN tidak akan dikirim ulang otomatis.</p>
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-xs text-left min-w-[680px]">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="p-2">Penerima</th><th className="p-2">Tahap</th><th className="p-2">Due (WIB)</th><th className="p-2">Status</th><th className="p-2">Keterangan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.jobs.length === 0 ? (
                  <tr><td className="p-4 text-slate-500" colSpan={5}>Belum ada job FU. Job dibuat setelah idle 30 menit, kategori Dingin dikonfirmasi Admin, dan seluruh eligibility lolos.</td></tr>
                ) : data.jobs.map((job) => (
                  <tr key={job.id}>
                    <td className="p-2 font-mono">{job.phone_masked}</td>
                    <td className="p-2 font-bold">FU{job.step}</td>
                    <td className="p-2">{formatDate(job.due_at)}</td>
                    <td className="p-2"><span className="rounded bg-amber-100 px-2 py-1 font-bold text-amber-900">{job.status}</span></td>
                    <td className="p-2 text-slate-500">{job.held_reason || job.stop_reason || `Attempt ${job.attempt_count}`}</td>
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
