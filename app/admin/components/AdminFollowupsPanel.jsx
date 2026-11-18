'use client';

import { useCallback, useEffect, useState } from 'react';

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Waktu tidak valid';
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date) + ' WIB';
}

function formatCategory(value) {
  const categories = {
    DINGIN: 'Dingin',
    HANGAT: 'Hangat',
    PANAS: 'Panas',
    UNCLASSIFIED: 'Belum diklasifikasi'
  };
  if (!value) return 'Belum ada klasifikasi';
  return categories[value] || String(value).toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getQualification(qualification) {
  if (!qualification) {
    return { category: 'Belum ada klasifikasi', review: 'Belum ada rekomendasi' };
  }

  const confirmed = qualification.qualification_status === 'CONFIRMED';
  return {
    category: formatCategory(confirmed ? qualification.confirmed_category : qualification.recommendation_category),
    review: confirmed ? 'Dikonfirmasi Admin' : 'Menunggu review Admin'
  };
}

function getSequenceInfo(profile) {
  const status = profile.sequence_status;
  const states = {
    AWAITING_CONSENT: {
      title: 'Menunggu persetujuan',
      description: 'Follow Up belum dimulai',
      style: 'bg-slate-100 text-slate-700'
    },
    AWAITING_INBOUND: {
      title: 'Menunggu pesan baru',
      description: 'Belum ada aktivitas baru untuk memulai sequence',
      style: 'bg-slate-100 text-slate-700'
    },
    AWAITING_IDLE: {
      title: 'Menunggu 30 menit',
      description: 'Menunggu tidak ada pesan baru',
      style: 'bg-blue-50 text-blue-700'
    },
    AWAITING_ADMIN_REVIEW: {
      title: 'Menunggu review Admin',
      description: 'Klasifikasi perlu dikonfirmasi terlebih dahulu',
      style: 'bg-amber-50 text-amber-800'
    },
    ACTIVE: {
      title: 'Sequence aktif',
      description: 'Tahap H+1 / H+3 / H+7 tercatat',
      style: 'bg-blue-50 text-blue-700'
    },
    STOPPED: {
      title: 'Follow Up dihentikan',
      description: formatStopReason(profile.stop_reason),
      style: 'bg-red-50 text-red-700'
    },
    COMPLETED: {
      title: 'Follow Up selesai',
      description: 'Tidak ada tahap lanjutan',
      style: 'bg-slate-100 text-slate-700'
    }
  };

  return states[status] || {
    title: 'Status belum tersedia',
    description: 'Periksa detail teknis bila diperlukan',
    style: 'bg-slate-100 text-slate-700'
  };
}

function formatStopReason(value) {
  const reasons = {
    ADMIN_STOP: 'Dihentikan oleh Super Admin',
    CONSENT_WITHDRAWN: 'Persetujuan Follow Up dicabut',
    HUMAN_HANDOVER: 'Percakapan dialihkan ke Admin',
    ACTIVE_BOOKING: 'Lead sudah memiliki jadwal konsultasi',
    REGISTRATION_IN_PROGRESS: 'Proses pendaftaran sudah dimulai',
    NEW_INBOUND: 'Ada pesan baru dari lead'
  };
  return reasons[value] || 'Dihentikan sesuai aturan sistem';
}

function getConsentInfo(profile) {
  if (profile.opted_out) {
    return { label: 'Opt-out', style: 'bg-red-50 text-red-700' };
  }
  if (profile.consent_granted) {
    return { label: 'Consent aktif', style: 'bg-emerald-50 text-emerald-700' };
  }
  return { label: 'Belum setuju', style: 'bg-slate-100 text-slate-700' };
}

function formatJobStep(step) {
  return ({ 1: 'H+1', 2: 'H+3', 3: 'H+7' })[step] || ('Tahap ' + step);
}

function formatJobStatus(status) {
  const labels = {
    HELD_COMPLIANCE: 'Ditahan sampai persetujuan selesai',
    SCHEDULED: 'Terjadwal',
    PROCESSING: 'Sedang diproses',
    SENT: 'Terkirim',
    FAILED: 'Gagal',
    UNKNOWN: 'Perlu pemeriksaan',
    CANCELLED: 'Dibatalkan'
  };
  return labels[status] || 'Status tidak tersedia';
}

function canStopProfile(profile) {
  return !profile.opted_out
    && !profile.admin_stopped_at
    && ['AWAITING_IDLE', 'AWAITING_ADMIN_REVIEW', 'ACTIVE'].includes(profile.sequence_status);
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
      if (!response.ok || !result?.success) {
        throw new Error(result?.message || 'Data Follow Up gagal dimuat.');
      }
      setError('');
      setData(result);
    } catch (err) {
      setError(err.message || 'Data Follow Up tidak tersedia.');
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
          throw new Error(result?.message || 'Data Follow Up gagal dimuat.');
        }
        if (active) {
          setError('');
          setData(result);
        }
      })
      .catch((err) => {
        if (active) setError(err.message || 'Data Follow Up tidak tersedia.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const stopProfile = async (profile) => {
    const reason = window.prompt(
      'Alasan menghentikan Follow Up untuk ' + profile.phone_masked + ' (wajib dicatat):',
      'Dihentikan manual oleh Super Admin.'
    );
    if (!reason || reason.trim().length < 5) return;

    setBusyProfile(profile.profile_id);
    try {
      const response = await fetch('/api/admin/followups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: profile.profile_id, reason: reason.trim() })
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) {
        throw new Error(result?.message || 'Penghentian Follow Up gagal.');
      }
      await refresh();
    } catch (err) {
      window.alert(err.message || 'Penghentian Follow Up gagal.');
    } finally {
      setBusyProfile('');
    }
  };

  const summary = data?.summary || {};
  const counts = summary.jobs_by_status || {};
  const profiles = Array.isArray(data?.profiles) ? data.profiles : [];
  const jobs = Array.isArray(data?.jobs) ? data.jobs : [];

  return (
    <main className="max-w-7xl mx-auto p-4 sm:p-6 space-y-5">
      <section className="bg-white rounded-2xl border-t-4 border-[#06315b] shadow-sm p-4 sm:p-5">
        <div className="flex flex-wrap justify-between items-center gap-3">
          <div>
            <h2 className="font-extrabold text-[#06315b] text-lg">Follow Up</h2>
            <p className="text-xs text-slate-500 mt-1">Pantau lead dan status tindak lanjut H+1, H+3, dan H+7.</p>
          </div>
          <button
            type="button"
            onClick={() => { setLoading(true); setError(''); void refresh(); }}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-[#06315b] text-amber-300 text-xs font-bold disabled:opacity-50"
          >
            {loading ? 'Memuat...' : 'Perbarui'}
          </button>
        </div>

        {error && (
          <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}

        {data && (
          <>
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 sm:p-4">
              <p className="text-sm font-bold text-amber-900">Pengiriman WhatsApp otomatis belum aktif</p>
              <p className="text-xs text-amber-800 mt-1">
                Follow Up hanya dicatat di sistem. Belum ada pesan WhatsApp yang dikirim otomatis.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
              {[
                ['Lead dipantau', summary.profiles ?? 0],
                ['Consent aktif', summary.consented ?? 0],
                ['Opt-out', summary.opted_out ?? 0]
              ].map(([title, value]) => (
                <article key={title} className="rounded-xl border border-slate-200 p-4">
                  <p className="text-[11px] text-slate-500">{title}</p>
                  <p className="text-2xl font-extrabold text-[#06315b] mt-1">{value}</p>
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      {data && (
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-extrabold text-[#06315b]">Daftar Follow Up</h2>
              <p className="text-xs text-slate-500 mt-1">Satu baris untuk setiap lead. Detail teknis tersedia saat dibuka.</p>
            </div>
            <span className="text-[10px] text-slate-500">Stop Follow Up hanya oleh Super Admin</span>
          </div>

          <div className="overflow-x-auto mt-4">
            <table className="w-full text-xs text-left min-w-[760px]">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="p-3">Penerima</th>
                  <th className="p-3">Klasifikasi</th>
                  <th className="p-3">Status Follow Up</th>
                  <th className="p-3">Pesan terakhir</th>
                  <th className="p-3">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading && profiles.length === 0 ? (
                  <tr><td colSpan={5} className="p-5 text-slate-500">Memuat daftar Follow Up...</td></tr>
                ) : profiles.length === 0 ? (
                  <tr><td colSpan={5} className="p-5 text-slate-500">Belum ada lead dalam pemantauan Follow Up.</td></tr>
                ) : profiles.map((profile) => {
                  const consent = getConsentInfo(profile);
                  const qualification = getQualification(profile.qualification);
                  const sequence = getSequenceInfo(profile);

                  return (
                    <tr key={profile.profile_id} className="align-top">
                      <td className="p-3">
                        <div className="font-mono font-semibold text-slate-800">{profile.phone_masked}</div>
                        <span className={'inline-flex mt-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ' + consent.style}>
                          {consent.label}
                        </span>
                      </td>
                      <td className="p-3">
                        <div className="font-semibold text-slate-800">{qualification.category}</div>
                        <div className="text-[10px] text-slate-500 mt-1">{qualification.review}</div>
                      </td>
                      <td className="p-3">
                        <span className={'inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ' + sequence.style}>
                          {sequence.title}
                        </span>
                        <p className="text-[11px] text-slate-500 mt-1 max-w-[230px]">{sequence.description}</p>
                        {profile.admin_stop_reason && (
                          <p className="text-[10px] text-slate-500 mt-1">Catatan: {profile.admin_stop_reason}</p>
                        )}
                      </td>
                      <td className="p-3 whitespace-nowrap">{formatDate(profile.last_inbound_at)}</td>
                      <td className="p-3">
                        {canStopProfile(profile) ? (
                          <button
                            type="button"
                            disabled={busyProfile === profile.profile_id}
                            onClick={() => void stopProfile(profile)}
                            className="rounded-lg border border-red-300 px-3 py-1.5 font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
                          >
                            {busyProfile === profile.profile_id ? 'Menyimpan...' : 'Stop FU'}
                          </button>
                        ) : profile.admin_stopped_at ? (
                          <span className="font-semibold text-red-700">Dihentikan</span>
                        ) : profile.opted_out ? (
                          <span className="font-semibold text-slate-500">Opt-out</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {data && (
        <details className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5">
          <summary className="cursor-pointer list-none flex flex-wrap justify-between items-center gap-2">
            <span className="font-bold text-sm text-[#06315b]">Detail teknis</span>
            <span className="text-xs text-slate-500">{jobs.length} job tercatat · buka bila diperlukan</span>
          </summary>

          <div className="mt-4 border-t border-slate-100 pt-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
              {Object.entries(counts).map(([status, count]) => (
                <div key={status} className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                  <p className="text-[10px] font-bold text-slate-500">{formatJobStatus(status)}</p>
                  <p className="text-lg font-extrabold text-slate-800">{count}</p>
                </div>
              ))}
            </div>

            <div className="mt-4">
              <p className="text-xs font-bold text-slate-700 mb-2">Catatan job Follow Up</p>
              {jobs.length === 0 ? (
                <p className="text-xs text-slate-500">Belum ada job Follow Up yang tercatat.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {jobs.map((job) => (
                    <li key={job.id} className="py-2.5 flex flex-wrap items-start justify-between gap-2 text-xs">
                      <div>
                        <p className="font-semibold text-slate-800">
                          {job.phone_masked} · {formatJobStep(job.step)}
                        </p>
                        <p className="text-slate-500 mt-0.5">Jatuh tempo: {formatDate(job.due_at)}</p>
                        {(job.held_reason || job.stop_reason) && (
                          <p className="text-slate-500 mt-0.5">Catatan: {job.held_reason || job.stop_reason}</p>
                        )}
                      </div>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-700">
                        {formatJobStatus(job.status)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <p className="text-[11px] text-slate-500 mt-4">
              Status compliance: {data.gate?.compliance_status || 'BLOCKED'} · Pengiriman otomatis tetap nonaktif (dispatch disabled).
            </p>
          </div>
        </details>
      )}
    </main>
  );
}
