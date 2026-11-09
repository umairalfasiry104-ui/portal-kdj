'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import AdminSystemPanel from './components/AdminSystemPanel';
import AdminFollowupsPanel from './components/AdminFollowupsPanel';
import AdminLeadQualificationPanel from './components/AdminLeadQualificationPanel';
import AdminDailyReportPanel from './components/AdminDailyReportPanel';

function KDJLogoHeader() {
    return (
        <Link href="/" className="bg-white px-4 h-14 sm:h-16 w-52 sm:w-64 rounded-xl shadow-md flex items-center justify-center overflow-hidden border-2 border-amber-400/80">
            <img
                src="/logo-kdj-panjang.png"
                alt="Kuliah di Jordan"
                className="w-full h-auto object-cover scale-125"
            />
        </Link>
    );
}

function KDJLogoSquare({ size = 'md' }) {
    const dim = size === 'lg' ? 'w-24 h-24' : 'w-14 h-14';
    return (
        <div className={`${dim} rounded-2xl bg-white p-1.5 shadow-md border-2 border-slate-100 flex items-center justify-center overflow-hidden`}>
            <img
                src="/logo-kdj-square.png"
                alt="Logo KDJ"
                className="w-full h-full object-contain scale-105"
            />
        </div>
    );
}


function formatJakartaDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Waktu tidak valid';

    return new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        dateStyle: 'full',
        timeStyle: 'short',
        hourCycle: 'h23'
    }).format(date) + ' WIB';
}

function getJakartaDateTimeParts(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return { date: '', time: '' };
    }

    const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Jakarta',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23'
        }).formatToParts(date).map((part) => [part.type, part.value])
    );

    return {
        date: `${parts.year}-${parts.month}-${parts.day}`,
        time: `${parts.hour}:${parts.minute}`
    };
}

function normalizeScheduleMethodForForm(value) {
    const normalized = String(value || '').trim().toUpperCase();
    return normalized === 'ZOOM' ? 'Zoom' : 'Offline';
}

function canAccessPendaftarTab(role) {
    return ['Super Admin', 'Admin Verifikator'].includes(role);
}

function canAccessJadwalTab(role) {
    return ['Super Admin', 'Admin Konsultan'].includes(role);
}

function canAccessAdminsTab(role) {
    return role === 'Super Admin';
}

function canAccessLeadQualificationTab(role) {
    return ['Super Admin', 'Admin Konsultan'].includes(role);
}


function getDefaultTabForRole(role) {
    if (canAccessPendaftarTab(role)) return 'pendaftar';
    if (canAccessJadwalTab(role)) return 'jadwal';
    return 'pendaftar';
}

export default function AdminDashboard() {
    const [adminUser, setAdminUser] = useState(null);
    const [identifier, setIdentifier] = useState('');
    const [password, setPassword] = useState('');
    const [authMsg, setAuthMsg] = useState('');
    const [activeTab, setActiveTab] = useState('pendaftar');
    const [pendaftarList, setPendaftarList] = useState([]);
    const [adminList, setAdminList] = useState([]);
    const [jadwalList, setJadwalList] = useState([]); // State untuk Jadwal
    const [editingScheduleId, setEditingScheduleId] = useState(null);
    const [scheduleDraft, setScheduleDraft] = useState({
        date: '',
        time: '',
        metode: 'Zoom'
    });
    const [savingJadwalId, setSavingJadwalId] = useState(null);

    // State Tambah Jadwal Manual
    const [showAddJadwalModal, setShowAddJadwalModal] = useState(false);
    const [newJadwalForm, setNewJadwalForm] = useState({
        no_wa: '',
        nama_leads: '',
        metode: 'Zoom',
        date: '',
        time: '',
        status: 'Terjadwal'
    });
    const [manualBookingRequest, setManualBookingRequest] = useState(null);

    const [selectedUser, setSelectedUser] = useState(null);
    const [statusBaru, setStatusBaru] = useState('');
    const [statusPembayaranBaru, setStatusPembayaranBaru] = useState('');
    const [catatanAdmin, setCatatanAdmin] = useState('');
    const [catatanPembayaran, setCatatanPembayaran] = useState('');
    const [docUpdates, setDocUpdates] = useState([]);
    const [loading, setLoading] = useState(false);

    const fetchPendaftar = useCallback(async () => {
        try {
            const res = await fetch('/api/admin/pendaftar');
            if (res.status === 401) {
                localStorage.removeItem('kdj_admin');
                setAdminUser(null);
                return;
            }
            const result = await res.json();
            if (result.success) setPendaftarList(result.data);
        } catch (error) {
            console.error('Gagal mengambil data pendaftar:', error);
        }
    }, []);

    const fetchAdmins = useCallback(async (roleOverride) => {
        const effectiveRole = roleOverride;
        if (!canAccessAdminsTab(effectiveRole)) {
            setAdminList([]);
            return;
        }
        try {
            const res = await fetch('/api/admin/auth');
            if (!res.ok) return;
            const result = await res.json();
            if (result.success) setAdminList(result.admins);
        } catch (error) {
            console.error('Gagal mengambil data admin:', error);
        }
    }, []);

    const fetchJadwal = useCallback(async () => {
        try {
            const res = await fetch('/api/admin/jadwal');
            if (!res.ok) {
                console.warn('API Jadwal bermasalah atau belum tersedia.');
                return;
            }
            const result = await res.json();
            if (result.success) setJadwalList(result.data);
        } catch (error) {
            console.error('Gagal mengambil data jadwal:', error);
        }
    }, []);

    const loadRoleScopedData = useCallback((role) => {
        if (canAccessPendaftarTab(role)) {
            void fetchPendaftar();
        } else {
            setPendaftarList([]);
        }

        if (canAccessJadwalTab(role)) {
            void fetchJadwal();
        } else {
            setJadwalList([]);
        }

        if (canAccessAdminsTab(role)) {
            void fetchAdmins(role);
        } else {
            setAdminList([]);
        }
    }, [fetchAdmins, fetchJadwal, fetchPendaftar]);

    const handleRetryBookingNotification = async (notification) => {
        if (!notification?.id) return;

        const confirmUnknown = notification.status === 'UNKNOWN';
        if (confirmUnknown) {
            const confirmed = window.confirm(
                'Hasil pengiriman sebelumnya tidak dapat dipastikan. Periksa chat WhatsApp penerima terlebih dahulu.\n\nJika pesan ternyata sudah terkirim, jangan lanjutkan retry karena penerima dapat menerima pesan ganda.\n\nSudah diperiksa dan tetap ingin mengirim ulang?'
            );
            if (!confirmed) return;
        }

        const bookingId = notification.booking_id;
        setSavingJadwalId(bookingId);

        try {
            const res = await fetch('/api/admin/jadwal/notifications/retry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    notification_id: notification.id,
                    confirm_unknown: confirmUnknown
                })
            });
            const result = await res.json();

            if (!res.ok || !result.success) {
                throw new Error(result.message || 'Gagal memasukkan notifikasi ke antrean retry.');
            }

            alert(result.message);
            await fetchJadwal();
        } catch (error) {
            alert(error.message || 'Terjadi kesalahan saat retry notifikasi.');
            await fetchJadwal();
        } finally {
            setSavingJadwalId(null);
        }
    };

    const handleCreateManualJadwal = async (e) => {
        e.preventDefault();
        if (!newJadwalForm.no_wa || !newJadwalForm.nama_leads || !newJadwalForm.date || !newJadwalForm.time) {
            alert('Semua field wajib diisi (Nomor WA, Nama, Tanggal, dan Jam).');
            return;
        }

        try {
            const jadwalPilihan = `${newJadwalForm.date}T${newJadwalForm.time}:00+07:00`;
            const requestFingerprint = JSON.stringify({
                no_wa: newJadwalForm.no_wa.trim(),
                nama_leads: newJadwalForm.nama_leads.trim(),
                metode: newJadwalForm.metode,
                jadwal_pilihan: jadwalPilihan,
                status: newJadwalForm.status
            });
            const bookingRequest = manualBookingRequest?.fingerprint === requestFingerprint
                ? manualBookingRequest
                : {
                    fingerprint: requestFingerprint,
                    key: `admin-manual:${window.crypto.randomUUID()}`
                };
            setManualBookingRequest(bookingRequest);

            const res = await fetch('/api/admin/jadwal', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-idempotency-key': bookingRequest.key
                },
                body: JSON.stringify({
                    action: 'CREATE',
                    no_wa: newJadwalForm.no_wa,
                    nama_leads: newJadwalForm.nama_leads,
                    metode: newJadwalForm.metode,
                    jadwal_pilihan: jadwalPilihan,
                    status: newJadwalForm.status
                })
            });
            const result = await res.json();

            if (!res.ok || !result.success) {
                throw new Error(result.message || 'Gagal menambahkan jadwal manual.');
            }

            alert(result.message || 'Jadwal konsultasi manual berhasil ditambahkan.');
            setShowAddJadwalModal(false);
            setNewJadwalForm({
                no_wa: '',
                nama_leads: '',
                metode: 'Zoom',
                date: '',
                time: '',
                status: 'Terjadwal'
            });
            setManualBookingRequest(null);
            await fetchJadwal();
        } catch (error) {
            alert(error.message || 'Terjadi kesalahan saat menyimpan jadwal.');
        }
    };

useEffect(() => {
    const savedAdmin = localStorage.getItem('kdj_admin');
    if (!savedAdmin) return;

    let parsedAdmin;

    try {
        parsedAdmin = JSON.parse(savedAdmin);
    } catch (error) {
        console.error('Gagal membaca sesi admin:', error);
        localStorage.removeItem('kdj_admin');
        return;
    }

    let cancelled = false;

    queueMicrotask(() => {
    if (cancelled) return;

    setAdminUser(parsedAdmin);
    setActiveTab(getDefaultTabForRole(parsedAdmin?.role));
    loadRoleScopedData(parsedAdmin?.role);
  });

    return () => {
        cancelled = true;
    };
}, [loadRoleScopedData]);


    const handleUpdateStatusJadwal = async (id, newStatus) => {
        setSavingJadwalId(id);

        try {
            const res = await fetch('/api/admin/jadwal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, status: newStatus })
            });
            const result = await res.json();

            if (!res.ok || !result.success) {
                throw new Error(result.message || 'Gagal memperbarui status jadwal.');
            }

            await fetchJadwal();

            if (result.wa_notified === false) {
                alert(result.message);
            }
        } catch (error) {
            alert(error.message || 'Terjadi kesalahan server.');
            await fetchJadwal();
        } finally {
            setSavingJadwalId(null);
        }
    };

    const beginReschedule = (jadwal) => {
        const parts = getJakartaDateTimeParts(jadwal.jadwal_pilihan);

        setScheduleDraft({
            date: parts.date,
            time: parts.time,
            metode: normalizeScheduleMethodForForm(jadwal.metode)
        });
        setEditingScheduleId(jadwal.id);
    };

    const handleRescheduleJadwal = async (event, id) => {
        event.preventDefault();

        if (!scheduleDraft.date || !scheduleDraft.time) {
            alert('Tanggal dan jam jadwal baru wajib diisi.');
            return;
        }

        setSavingJadwalId(id);

        try {
            const jadwalPilihan =
                `${scheduleDraft.date}T${scheduleDraft.time}:00+07:00`;

            const res = await fetch('/api/admin/jadwal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id,
                    jadwal_pilihan: jadwalPilihan,
                    metode: scheduleDraft.metode
                })
            });
            const result = await res.json();

            if (!res.ok || !result.success) {
                throw new Error(result.message || 'Gagal mengubah jadwal konsultasi.');
            }

            setEditingScheduleId(null);
            await fetchJadwal();

            if (result.wa_notified === false) {
                alert(result.message);
            } else {
                alert(result.message || 'Jadwal berhasil diperbarui.');
            }
        } catch (error) {
            alert(error.message || 'Terjadi kesalahan server.');
            await fetchJadwal();
        } finally {
            setSavingJadwalId(null);
        }
    };

    const handleLoginAdmin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setAuthMsg('');

    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'login_admin',
          identifier,
          password
        })
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setAdminUser(data.admin);
        setPassword('');
        localStorage.setItem('kdj_admin', JSON.stringify(data.admin));
        setActiveTab(getDefaultTabForRole(data.admin?.role));
        loadRoleScopedData(data.admin?.role);
      } else {
        setAuthMsg('❌ ' + (data.message || 'Gagal login Admin.'));
      }
    } catch {
      setAuthMsg('❌ Terjadi kesalahan jaringan.');
    } finally {
      setLoading(false);
    }
  };

    const handleSelectUser = (u) => {
    setSelectedUser(u);
    setStatusBaru(u.status_pendaftaran || 'Submitted');
    setStatusPembayaranBaru(u.status_pembayaran || 'Belum Bayar');
    setCatatanAdmin(u.catatan_admin || '');
    setDocUpdates(u.dokumen_pendaftar || []);
  };

    const handleDocStatusChange = (docId, newStatus) => {
        setDocUpdates((prev) =>
            prev.map((d) => (d.id === docId ? { ...d, status_dokumen: newStatus } : d))
        );
    };

    const handleUpdateAndNotify = async (e) => {
    e.preventDefault();
    if (!selectedUser) return;
    setLoading(true);

    const role = adminUser?.role;
    const payload = {
      pendaftar_id: selectedUser.id
    };

    if (['Super Admin', 'Admin Verifikator'].includes(role)) {
      payload.status_pendaftaran = statusBaru;
      payload.catatan_admin = typeof catatanAdmin === 'string' ? catatanAdmin : '';
      payload.doc_updates = (docUpdates || []).map((d) => ({
        id: d.id,
        status_dokumen: d.status_dokumen || 'pending'
      }));
    }

    if (role === 'Super Admin') {
      payload.status_pembayaran = statusPembayaranBaru;
    }

    try {
      const res = await fetch('/api/admin/pendaftar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => null);

      if (res.ok && data?.success) {
        const updatedLabel = role === 'Super Admin'
          ? 'Status pendaftaran dan pembayaran'
          : 'Status pendaftaran dan dokumen akademik';

        if (data.wa_notified) {
          alert(`${updatedLabel} berhasil diperbarui, dan notifikasi WA telah terkirim.`);
        } else {
          alert(`${updatedLabel} berhasil disimpan di database, namun notifikasi WA belum terkirim. Periksa status WhatsApp Bot.`);
        }
        await fetchPendaftar();
        setSelectedUser(null);
      } else {
        alert('❌ Gagal update: ' + (data?.message || 'Terjadi kesalahan pada server.'));
      }
    } catch (err) {
      console.error('Error saat update data pendaftar:', err);
      alert('❌ Terjadi kesalahan jaringan atau server tidak merespons.');
    } finally {
      setLoading(false);
    }
  };

    const handleLogoutAdmin = async () => {
    try {
      await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'logout' })
      });
    } catch {}
    localStorage.removeItem('kdj_admin');
    setAdminUser(null);
    setAdminList([]);
    setPendaftarList([]);
    setJadwalList([]);
    setSelectedUser(null);
    setPassword('');
    setAuthMsg('');
  };

    // ================= LOGIN ADMIN (USERNAME/EMAIL + PASSWORD) =================
  if (!adminUser) {
    return (
      <div className="min-h-screen flex flex-col bg-[#06315b]">
        <div className="bg-[#042444] text-slate-200 text-xs py-2 px-6 border-b border-[#0a3f73]">
          <div className="max-w-6xl mx-auto flex justify-between items-center">
            <span>📞 0813-6624-5544 | ✉️ admin@kuliahdijordan.com</span>
            <Link href="/" className="text-amber-400 hover:underline font-semibold">&larr; Ke Portal Mahasiswa</Link>
          </div>
        </div>

        <main className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white text-slate-800 rounded-2xl p-8 shadow-2xl border-t-8 border-amber-400">
            <div className="flex flex-col items-center text-center mb-6">
              <KDJLogoSquare size="lg" />
              <span className="mt-3 px-2.5 py-0.5 bg-[#06315b] text-amber-400 text-[10px] font-extrabold uppercase rounded">
                Internal System
              </span>
              <h1 className="text-xl font-extrabold text-[#06315b] mt-1">Login Admin Portal KDJ</h1>
              <p className="text-slate-500 text-xs mt-0.5">Masuk menggunakan Username atau Email Tim Admin</p>
            </div>

            {authMsg && (
              <div className="mb-4 p-3 rounded-lg text-xs font-semibold bg-slate-100 border border-slate-300 text-[#06315b] text-center">
                {authMsg}
              </div>
            )}

            <form onSubmit={handleLoginAdmin} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#06315b] mb-1">
                  Username atau Email Admin
                </label>
                <input
                  type="text"
                  required
                  autoComplete="username"
                  placeholder="Contoh: superadmin / verifikator"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:outline-none focus:border-[#06315b]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#06315b] mb-1">
                  Password
                </label>
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  placeholder="Masukkan password Admin"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:outline-none focus:border-[#06315b]"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-amber-400 hover:bg-amber-300 text-[#06315b] font-extrabold rounded-xl text-sm transition shadow-md"
              >
                {loading ? 'Memverifikasi Akses...' : 'Masuk Dashboard Admin'}
              </button>
            </form>
          </div>
        </main>
        <div className="h-4 bg-amber-400 w-full" />
      </div>
    );
  }

    // ================= DASHBOARD ADMIN =================
    return (
        <div className="min-h-screen bg-slate-100 text-slate-800">
            <header className="bg-[#06315b] text-white px-6 py-3.5 flex flex-wrap justify-between items-center gap-4 shadow-md border-b-4 border-amber-400">
                <div className="flex items-center gap-4">
                    <KDJLogoHeader />
                    <div>
                        <h1 className="font-extrabold text-sm sm:text-base tracking-wide uppercase">ADMIN PANEL KDJ</h1>
                        <p className="text-xs text-amber-400 font-semibold">
                            Admin: {adminUser.nama_admin} ({adminUser.role})
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2.5">
                    {canAccessPendaftarTab(adminUser.role) && (
                        <button
                        onClick={() => setActiveTab('pendaftar')}
                        className={`px-4 py-2 text-xs rounded-lg font-bold transition ${
                            activeTab === 'pendaftar'
                            ? 'bg-amber-400 text-[#06315b] shadow'
                            : 'bg-[#042444] text-slate-200 hover:bg-[#083e73]'
                        }`}
                        >
                        📋 Data Pendaftar ({pendaftarList.length})
                        </button>
                    )}
                    {canAccessJadwalTab(adminUser.role) && (
                        <button
                        onClick={() => setActiveTab('jadwal')}
                        className={`px-4 py-2 text-xs rounded-lg font-bold transition ${
                            activeTab === 'jadwal'
                            ? 'bg-amber-400 text-[#06315b] shadow'
                            : 'bg-[#042444] text-slate-200 hover:bg-[#083e73]'
                        }`}
                        >
                        📅 Jadwal Konsultasi ({jadwalList.length})
                        </button>
                    )}
                    {canAccessAdminsTab(adminUser.role) && (
                        <button
                        onClick={() => setActiveTab('admins')}
                        className={`px-4 py-2 text-xs rounded-lg font-bold transition ${
                            activeTab === 'admins'
                            ? 'bg-amber-400 text-[#06315b] shadow'
                            : 'bg-[#042444] text-slate-200 hover:bg-[#083e73]'
                        }`}
                        >
                        👥 Tim Admin ({adminList.length})
                        </button>
                    )}
                    {adminUser.role === 'Super Admin' && (
                        <button
                        onClick={() => setActiveTab('system')}
                        className={`px-4 py-2 text-xs rounded-lg font-bold transition ${
                            activeTab === 'system'
                            ? 'bg-amber-400 text-[#06315b] shadow'
                            : 'bg-[#042444] text-slate-200 hover:bg-[#083e73]'
                        }`}
                        >
                        Monitoring Sistem
                        </button>
                    )}
                    {canAccessLeadQualificationTab(adminUser.role) && (
                        <button
                        onClick={() => setActiveTab('lead-qualification')}
                        className={`px-4 py-2 text-xs rounded-lg font-bold transition ${
                            activeTab === 'lead-qualification'
                            ? 'bg-amber-400 text-[#06315b] shadow'
                            : 'bg-[#042444] text-slate-200 hover:bg-[#083e73]'
                        }`}
                        >
                        Kualifikasi Lead
                        </button>
                    )}
                    {adminUser.role === 'Super Admin' && (
                        <button
                        onClick={() => setActiveTab('followups')}
                        className={`px-4 py-2 text-xs rounded-lg font-bold transition ${
                            activeTab === 'followups'
                            ? 'bg-amber-400 text-[#06315b] shadow'
                            : 'bg-[#042444] text-slate-200 hover:bg-[#083e73]'
                        }`}
                        >
                        Follow Up
                        </button>
                    )}
                    {['Super Admin', 'Admin Konsultan'].includes(adminUser.role) && (
                        <button
                        onClick={() => setActiveTab('daily-report')}
                        className={`px-4 py-2 text-xs rounded-lg font-bold transition ${
                            activeTab === 'daily-report'
                            ? 'bg-amber-400 text-[#06315b] shadow'
                            : 'bg-[#042444] text-slate-200 hover:bg-[#083e73]'
                        }`}
                        >
                        Laporan Harian Bot
                        </button>
                    )}
                    <button
                        onClick={handleLogoutAdmin}
                        className="px-3.5 py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-lg transition"
                    >
                        Logout
                    </button>
                    </div>
            </header>

            {/* TAB PENDAFTAR */}
            {activeTab === 'pendaftar' && (
                <div className="max-w-7xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border-t-4 border-[#06315b] overflow-hidden">
                        <div className="p-5 border-b border-slate-100 flex justify-between items-center">
                            <h2 className="font-extrabold text-[#06315b]">Daftar Calon Mahasiswa</h2>
                            <button onClick={fetchPendaftar} className="text-xs font-bold text-[#06315b] hover:underline">
                                🔄 Refresh Data
                            </button>
                        </div>
                        <div className="divide-y divide-slate-100">
                            {pendaftarList.map((item) => {
                                const st = (item.status_pendaftaran || '').toLowerCase();
                                return (
                                    <div
                                        key={item.id}
                                        onClick={() => handleSelectUser(item)}
                                        className={`p-4 cursor-pointer hover:bg-slate-50 transition flex items-center justify-between ${
                                            selectedUser?.id === item.id ? 'bg-amber-50/70 border-l-4 border-[#06315b]' : ''
                                        }`}
                                    >
                                        <div>
                                            <div className="font-extrabold text-sm text-[#06315b]">
                                                {item.nama_leads || item.nama_lengkap || 'Nama belum diberikan'}
                                            </div>
                                            <div className="text-xs text-slate-600 mt-0.5">
                                                WA: <span className="font-mono">{item.no_wa}</span> • Kampus: <span className="font-bold text-[#06315b]">{item.pilihan_kampus || '-'}</span>
                                            </div>
                                            <div className="text-[11px] text-slate-400 mt-1">
                                                Berkas: {item.dokumen_pendaftar?.length || 0} / 4 • Bayar: <strong className="text-slate-600">{item.status_pembayaran || 'Belum Bayar'}</strong>
                                            </div>
                                        </div>
                                        <span className={`px-3 py-1 rounded-full text-[11px] font-extrabold uppercase ${
                                            st === 'approved' ? 'bg-emerald-100 text-emerald-800' :
                                            st === 'rejected' ? 'bg-red-100 text-red-800' :
                                            st === 'revisi diajukan' ? 'bg-purple-100 text-purple-800 animate-pulse' :
                                            'bg-amber-100 text-amber-800'
                                        }`}>
                                            {item.status_pendaftaran?.replace('_', ' ') || 'Submitted'}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div className="lg:col-span-1">
                        {selectedUser ? (
                        <form onSubmit={handleUpdateAndNotify} className="bg-white rounded-2xl shadow-sm border-t-4 border-amber-400 p-6 space-y-5">
                            <div className="border-b border-slate-100 pb-3">
                            <h3 className="font-extrabold text-base text-[#06315b]">
                                {selectedUser.nama_leads || selectedUser.nama_lengkap || 'Calon Mahasiswa'}
                            </h3>
                            <p className="text-xs text-slate-500 mt-1">
                                Nama lengkap: {selectedUser.nama_lengkap || 'Belum diisi'}
                            </p>
                            <p className="text-xs text-slate-500">
                                WA: {selectedUser.no_wa} • Paspor: {selectedUser.no_paspor || '-'}
                            </p>
                            </div>

                            {/* DATA LENGKAP PENDAFTAR - READ ONLY */}
                            {['Super Admin', 'Admin Verifikator'].includes(adminUser?.role) && (
                            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                                <div className="border-b border-slate-200 pb-2">
                                <h4 className="text-xs font-extrabold text-[#06315b] uppercase">
                                    Data Lengkap Pendaftar
                                </h4>
                                <p className="text-[10px] text-slate-500 mt-1">
                                    Biodata yang diisi melalui Dashboard Pendaftar.
                                </p>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {[
                                    { label: 'Nama Lengkap (Sesuai Paspor)', value: selectedUser.nama_lengkap },
                                    { label: 'Jenis Kelamin', value: selectedUser.jenis_kelamin },
                                    { label: 'Tempat Lahir', value: selectedUser.tempat_lahir },
                                    { label: 'Tanggal Lahir', value: selectedUser.tanggal_lahir },
                                    { label: 'Nomor Paspor', value: selectedUser.no_paspor },
                                    { label: 'Nomor WhatsApp', value: selectedUser.no_wa },
                                    { label: 'Asal Sekolah / Pesantren', value: selectedUser.asal_sekolah },
                                    { label: 'Tahun Kelulusan', value: selectedUser.tahun_lulus },
                                    { label: 'Pilihan Universitas', value: selectedUser.pilihan_kampus },
                                    { label: 'Pilihan Jurusan', value: selectedUser.pilihan_jurusan },
                                    { label: 'Alamat Lengkap Domisili', value: selectedUser.alamat_lengkap, fullWidth: true }
                                ].map((field) => (
                                    <div key={field.label} className={`min-w-0 ${field.fullWidth ? 'sm:col-span-2' : ''}`}>
                                    <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">
                                        {field.label}
                                    </p>
                                    <p className="text-xs font-semibold text-slate-800 whitespace-pre-wrap break-words">
                                        {field.value !== null && field.value !== undefined && String(field.value).trim() !== '' ? String(field.value) : '-'}
                                    </p>
                                    </div>
                                ))}
                                </div>
                            </div>
                            )}

                            {/* BAGIAN PEMERIKSAAN BUKTI PEMBAYARAN */}
                            {adminUser?.role === 'Super Admin' && (
                            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                                <label className="block text-xs font-extrabold text-[#06315b] uppercase">Verifikasi Pembayaran</label>
                                <div className="flex justify-between items-center text-xs">
                                <span className="text-slate-600">Tagihan: Rp {Number(selectedUser.nominal_tagihan || 1500000).toLocaleString('id-ID')}</span>
                                {selectedUser.bukti_bayar_url ? (
                                    <Link href={selectedUser.bukti_bayar_url} target="_blank" rel="noreferrer" className="text-amber-600 font-bold underline">
                                    🔍 Lihat Bukti Transfer
                                    </Link>
                                ) : (
                                    <span className="text-red-500 font-semibold">⚠️ Belum upload bukti bayar</span>
                                )}
                                </div>
                                <select
                                    value={statusPembayaranBaru}
                                    onChange={(e) => setStatusPembayaranBaru(e.target.value)}
                                    className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white font-semibold"
                                    >
                                    <option value="Belum Bayar" disabled={adminUser?.role === 'Admin Verifikator'}>
                                        Belum Bayar {adminUser?.role === 'Admin Verifikator' ? '(Status Awal)' : ''}
                                    </option>
                                    <option value="Menunggu Verifikasi" disabled={adminUser?.role === 'Admin Verifikator'}>
                                        Menunggu Verifikasi {adminUser?.role === 'Admin Verifikator' ? '(Status Awal)' : ''}
                                    </option>
                                    <option value="Lunas">Lunas (Approved) ✅</option>
                                    <option value="Ditolak">Ditolak ❌</option>
                                    </select>
                            </div>
                            )}

                            {/* PEMERIKSAAN DOKUMEN PERSYARATAN */}
                            {['Super Admin', 'Admin Verifikator'].includes(adminUser?.role) && (
                            <div className="space-y-2.5">
                                <label className="block text-xs font-extrabold text-[#06315b] uppercase">Pemeriksaan Dokumen Persyaratan</label>
                                {docUpdates.length === 0 ? (
                                <p className="text-xs text-slate-400 italic">Belum ada dokumen yang diunggah.</p>
                                ) : (
                                docUpdates.map((doc) => (
                                    <div key={doc.id} className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
                                    <div>
                                        <div className="text-xs font-bold uppercase text-[#06315b]">{doc.jenis_dokumen}</div>
                                        <Link href={doc.file_path} target="_blank" rel="noreferrer" className="text-xs text-amber-600 font-semibold underline">
                                        Buka Berkas
                                        </Link>
                                    </div>
                                    <select
                                        value={doc.status_dokumen || 'pending'}
                                        onChange={(e) => handleDocStatusChange(doc.id, e.target.value)}
                                        className="text-xs border border-slate-300 rounded-lg px-2 py-1 bg-white font-semibold"
                                    >
                                        <option value="pending">Pending</option>
                                        <option value="approved">Approved ✅</option>
                                        <option value="rejected">Rejected ❌</option>
                                    </select>
                                    </div>
                                ))
                                )}
                            </div>
                            )}

                            {/* UBAH STATUS PENDAFTARAN */}
                            {['Super Admin', 'Admin Verifikator'].includes(adminUser?.role) && (
                            <div>
                                <label className="block text-xs font-extrabold text-[#06315b] uppercase mb-1.5">Ubah Status Pendaftaran</label>
                                <select
                                  value={statusBaru}
                                  onChange={(e) => setStatusBaru(e.target.value)}
                                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white font-semibold"
                                >
                                  {adminUser?.role === 'Admin Verifikator' ? (
                                    <>
                                      <option value="Submitted">Submitted (Menunggu Verifikasi)</option>
                                      <option value="Revisi Diajukan">Revisi Diajukan</option>
                                      <option value="Approved">Approved (Lolos Berkas) ✅</option>
                                      <option value="Rejected">Rejected / Perlu Revisi ⚠️</option>
                                    </>
                                  ) : (
                                    <>
                                      <option value="Draft">Draft</option>
                                      <option value="draft_berkas">Draft Berkas</option>
                                      <option value="Submitted">Submitted (Menunggu Verifikasi)</option>
                                      <option value="Revisi Diajukan">Revisi Diajukan</option>
                                      <option value="Approved">Approved (Lolos Berkas) ✅</option>
                                      <option value="Rejected">Rejected / Perlu Revisi ⚠️</option>
                                    </>
                                  )}
                                </select>
                            </div>
                            )}

                            {/* CATATAN BERKAS (VERIFIKATOR & SUPER ADMIN) */}
                            {['Super Admin', 'Admin Verifikator'].includes(adminUser?.role) && (
                                <div>
                                <label className="block text-xs font-extrabold text-[#06315b] uppercase mb-1.5">
                                    Catatan Berkas ke WA Pendaftar (Alasan Revisi / Catatan Khusus)
                                </label>
                                <textarea
                                    rows={3}
                                    value={catatanAdmin}
                                    onChange={(e) => setCatatanAdmin(e.target.value)}
                                    placeholder="Tulis pesan perbaikan berkas untuk dikirim ke WA calon mahasiswa..."
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white font-normal"
                                />
                                </div>
                            )}

                            <button type="submit" disabled={loading} className="w-full py-3 bg-[#06315b] hover:bg-[#042444] text-amber-400 font-extrabold text-sm rounded-xl transition shadow">
                            {loading ? 'Memproses...' : 'Simpan Perubahan'}
                            </button>
                        </form>
                        ) : (
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center text-slate-400 text-sm">
                            Pilih salah satu pendaftar di sebelah kiri untuk melihat detail atau melakukan verifikasi.
                        </div>
                        )}
                    </div>
                </div>
            )}

            {/* TAB JADWAL KONSULTASI */}
            {activeTab === 'jadwal' && (
                <div className="max-w-6xl mx-auto p-6 space-y-6">
                    <div className="bg-white rounded-2xl shadow-sm border-t-4 border-amber-400 p-6">
                        <div className="flex justify-between items-center mb-6">
                            <div>
                                <h2 className="font-extrabold text-[#06315b] text-lg">Daftar Jadwal Konsultasi Leads</h2>
                                <p className="text-xs text-slate-500">Kelola reservasi dan penjadwalan konsultasi calon mahasiswa.</p>
                            </div>
                            <div className="flex items-center gap-3">
                                {['Super Admin', 'Admin Konsultan'].includes(adminUser?.role) && (
                                    <button
                                        onClick={() => setShowAddJadwalModal(true)}
                                        className="px-4 py-2 bg-[#06315b] hover:bg-[#042444] text-amber-400 font-bold text-xs rounded-lg shadow transition"
                                    >
                                        + Tambah Jadwal Manual
                                    </button>
                                )}
                                <button onClick={fetchJadwal} className="text-xs font-bold text-blue-600 hover:underline">
                                    🔄 Refresh Jadwal
                                </button>
                            </div>
                        </div>

                        {jadwalList.length === 0 ? (
                            <p className="text-center text-slate-400 py-10 text-sm">Belum ada jadwal konsultasi yang terdaftar.</p>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {jadwalList.map((j) => {
                                    const status = j.status || 'Terjadwal';
                                    const isEditing = editingScheduleId === j.id;
                                    const isSaving = savingJadwalId === j.id;

                                    return (
                                        <div
                                            key={j.id}
                                            className="border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col justify-between hover:shadow-md transition bg-slate-50"
                                        >
                                            <div>
                                                <div className="flex justify-between items-start mb-2">
                                                    <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                                                        status === 'Selesai' ? 'bg-emerald-100 text-emerald-700' :
                                                        status === 'Batal' ? 'bg-red-100 text-red-700' :
                                                        'bg-amber-100 text-amber-800'
                                                    }`}>
                                                        {status}
                                                    </span>
                                                    <span className="text-[10px] font-bold text-slate-500 bg-white px-2 py-0.5 border rounded">
                                                        {j.metode === 'Datang ke Kantor' ? 'Offline' : j.metode}
                                                    </span>
                                                </div>

                                                <h3 className="font-extrabold text-[#06315b] text-base mb-1">
                                                    {j.nama_leads || 'Leads Tanpa Nama'}
                                                </h3>
                                                <p className="text-xs font-mono text-slate-500 mb-3">
                                                    WA: {j.no_wa}
                                                </p>

                                                <div className="bg-white border rounded-lg p-3 mb-4">
                                                    <p className="text-[10px] font-bold text-slate-400 uppercase">
                                                        Waktu Konsultasi:
                                                    </p>
                                                    <p className="text-xs font-semibold text-[#06315b]">
                                                        {formatJakartaDateTime(j.jadwal_pilihan)}
                                                    </p>
                                                    <p className="text-[10px] text-slate-500 mt-2">
                                                        Durasi sesi: 120 menit · Kalender diblokir: 150 menit termasuk buffer.
                                                    </p>

                                                    {(() => {
                                                        const notification = j.latest_notification;

                                                        const notificationStatus =
                                                            j.notification_status_source === 'OUTBOX'
                                                                ? notification?.status || null
                                                                : j.notification_status_source === 'LEGACY_SUMMARY'
                                                                    ? j.notification_status || null
                                                                    : null;

                                                        const notificationAlerts = j.notification_alerts || [];

                                                        if (
                                                            !notificationStatus &&
                                                            !j.notification_integrity &&
                                                            notificationAlerts.length === 0
                                                        ) {
                                                            return null;
                                                        }

                                                        return (
                                                            <div className="mt-2 space-y-2">
                                                                {j.notification_integrity && (
                                                                    <p
                                                                        role="alert"
                                                                        className="rounded-md border border-red-200 bg-red-50 p-2 text-[10px] font-semibold text-red-700"
                                                                    >
                                                                        Status notifikasi tidak dapat diverifikasi:{' '}
                                                                        {j.notification_integrity.message || j.notification_integrity.code}
                                                                        {' '}Periksa integritas Outbox sebelum melakukan retry.
                                                                    </p>
                                                                )}

                                                                {notificationStatus && (
                                                                    <>
                                                                        <p className={`text-[10px] font-bold ${
                                                                            notificationStatus === 'SENT'
                                                                                ? 'text-emerald-700'
                                                                                : ['FAILED', 'UNKNOWN'].includes(notificationStatus)
                                                                                    ? 'text-red-600'
                                                                                    : 'text-amber-700'
                                                                        }`}>
                                                                            Notifikasi WA: {notificationStatus}
                                                                        </p>

                                                                        {j.notification_status_source === 'LEGACY_SUMMARY' && (
                                                                            <p className="text-[10px] text-slate-500">
                                                                                Ringkasan kompatibilitas lama. Tidak tersedia event Outbox untuk verifikasi detail pengiriman.
                                                                            </p>
                                                                        )}

                                                                        {notification?.last_error && (
                                                                            <p className="text-[10px] text-slate-500 break-words">
                                                                                {notification.last_error}
                                                                            </p>
                                                                        )}
                                                                    </>
                                                                )}

                                                                {notificationAlerts.length > 0 && (
                                                                    <div className="mt-2 border-t border-slate-200 pt-2 space-y-2">
                                                                        <p className="text-[10px] font-bold text-red-700">
                                                                            Notifikasi yang perlu ditindaklanjuti
                                                                        </p>

                                                                        {notificationAlerts.map((alertEvent) => (
                                                                            <div
                                                                                key={alertEvent.id}
                                                                                className="rounded-md bg-amber-50 border border-amber-200 p-2"
                                                                            >
                                                                                <p className="text-[10px] font-bold text-slate-800">
                                                                                    {alertEvent.event_type} · {alertEvent.status}
                                                                                </p>

                                                                                {alertEvent.last_error && (
                                                                                    <p className="text-[10px] text-slate-600 break-words mt-1">
                                                                                        {alertEvent.last_error}
                                                                                    </p>
                                                                                )}

                                                                                {alertEvent.is_latest ? (
                                                                                    <button
                                                                                        type="button"
                                                                                        disabled={isSaving}
                                                                                        onClick={() => handleRetryBookingNotification(alertEvent)}
                                                                                        className="w-full mt-2 rounded-lg border border-amber-500 bg-white px-2 py-1.5 text-[10px] font-bold text-amber-900 disabled:opacity-60"
                                                                                    >
                                                                                        {alertEvent.status === 'UNKNOWN'
                                                                                            ? 'Periksa WhatsApp & konfirmasi retry'
                                                                                            : 'Coba ulang notifikasi'}
                                                                                    </button>
                                                                                ) : (
                                                                                    <p className="mt-2 text-[10px] text-slate-600">
                                                                                        Event lama telah digantikan perubahan terbaru. Jangan kirim ulang isi notifikasi lama.
                                                                                    </p>
                                                                                )}
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })()}
                                                </div>
                                            </div>

                                            <div className="space-y-3">
                                                <div>
                                                    <label className="block text-[10px] font-bold text-slate-500 mb-1">
                                                        Update Status:
                                                    </label>
                                                    <select
                                                        value={status}
                                                        disabled={isSaving || isEditing}
                                                        onChange={(event) => handleUpdateStatusJadwal(j.id, event.target.value)}
                                                        className="w-full text-xs font-semibold px-2 py-1.5 border border-slate-300 rounded-lg bg-white focus:outline-none disabled:opacity-60"
                                                    >
                                                        <option value="Terjadwal">📅 Terjadwal</option>
                                                        <option value="Selesai">✅ Selesai</option>
                                                        <option value="Batal">❌ Batal</option>
                                                    </select>
                                                </div>

                                                {!isEditing ? (
                                                    status === 'Terjadwal' ? (
                                                        <button
                                                            type="button"
                                                            disabled={isSaving}
                                                            onClick={() => beginReschedule(j)}
                                                            className="w-full px-3 py-2 text-xs font-bold rounded-lg border border-[#06315b] text-[#06315b] hover:bg-blue-50 disabled:opacity-60"
                                                        >
                                                            Ubah Jadwal / Metode
                                                        </button>
                                                    ) : (
                                                        <p className="text-[10px] text-slate-500">
                                                            Reschedule hanya tersedia untuk booking berstatus Terjadwal.
                                                        </p>
                                                    )
                                                ) : (
                                                    <form
                                                        onSubmit={(event) => handleRescheduleJadwal(event, j.id)}
                                                        className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3"
                                                    >
                                                        <p className="text-xs font-extrabold text-[#06315b]">
                                                            Jadwal Baru (WIB)
                                                        </p>

                                                        <div>
                                                            <label className="block text-[10px] font-bold text-slate-600 mb-1">
                                                                Tanggal
                                                            </label>
                                                            <input
                                                                type="date"
                                                                required
                                                                value={scheduleDraft.date}
                                                                onChange={(event) => setScheduleDraft((current) => ({
                                                                    ...current,
                                                                    date: event.target.value
                                                                }))}
                                                                className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs"
                                                            />
                                                        </div>

                                                        <div>
                                                            <label className="block text-[10px] font-bold text-slate-600 mb-1">
                                                                Jam Mulai
                                                            </label>
                                                            <input
                                                                type="time"
                                                                required
                                                                step="60"
                                                                value={scheduleDraft.time}
                                                                onChange={(event) => setScheduleDraft((current) => ({
                                                                    ...current,
                                                                    time: event.target.value
                                                                }))}
                                                                className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs"
                                                            />
                                                            <p className="mt-1 text-[10px] text-slate-500">
                                                                Senin–Jumat, 09.00–15.00 WIB. Sistem memeriksa ketersediaan kalender.
                                                            </p>
                                                        </div>

                                                        <div>
                                                            <label className="block text-[10px] font-bold text-slate-600 mb-1">
                                                                Metode Konsultasi
                                                            </label>
                                                            <select
                                                                value={scheduleDraft.metode}
                                                                onChange={(event) => setScheduleDraft((current) => ({
                                                                    ...current,
                                                                    metode: event.target.value
                                                                }))}
                                                                className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs"
                                                            >
                                                                <option value="Zoom">Zoom</option>
                                                                <option value="Offline">Offline</option>
                                                            </select>
                                                        </div>

                                                        <div className="flex gap-2">
                                                            <button
                                                                type="submit"
                                                                disabled={isSaving}
                                                                className="flex-1 rounded-lg bg-[#06315b] px-3 py-2 text-xs font-bold text-amber-400 disabled:opacity-60"
                                                            >
                                                                {isSaving ? 'Menyimpan...' : 'Simpan Perubahan'}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                disabled={isSaving}
                                                                onClick={() => setEditingScheduleId(null)}
                                                                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-600 disabled:opacity-60"
                                                            >
                                                                Batal
                                                            </button>
                                                        </div>
                                                    </form>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* MODAL TAMBAH JADWAL MANUAL */}
                    {showAddJadwalModal && (
                        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
                            <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl space-y-4">
                                <h3 className="text-base font-bold text-[#06315b]">Tambah Jadwal Konsultasi Manual</h3>
                                <form onSubmit={handleCreateManualJadwal} className="space-y-3">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 mb-1">Nama Calon Mahasiswa / Leads</label>
                                        <input
                                            type="text"
                                            required
                                            value={newJadwalForm.nama_leads}
                                            onChange={(e) => setNewJadwalForm({ ...newJadwalForm, nama_leads: e.target.value })}
                                            className="w-full text-xs border border-slate-300 rounded-lg p-2"
                                            placeholder="cth: Ahmad Fauzi"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 mb-1">Nomor WhatsApp</label>
                                        <input
                                            type="text"
                                            required
                                            value={newJadwalForm.no_wa}
                                            onChange={(e) => setNewJadwalForm({ ...newJadwalForm, no_wa: e.target.value })}
                                            className="w-full text-xs border border-slate-300 rounded-lg p-2"
                                            placeholder="cth: 081234567890"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 mb-1">Metode Konsultasi</label>
                                        <select
                                            value={newJadwalForm.metode}
                                            onChange={(e) => setNewJadwalForm({ ...newJadwalForm, metode: e.target.value })}
                                            className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white"
                                        >
                                            <option value="Zoom">Zoom</option>
                                            <option value="Offline">Offline (Datang ke Kantor)</option>
                                        </select>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <label className="block text-xs font-bold text-slate-600 mb-1">Tanggal</label>
                                            <input
                                                type="date"
                                                required
                                                value={newJadwalForm.date}
                                                onChange={(e) => setNewJadwalForm({ ...newJadwalForm, date: e.target.value })}
                                                className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-slate-600 mb-1">Jam Mulai (WIB)</label>
                                            <input
                                                type="time"
                                                required
                                                step="60"
                                                value={newJadwalForm.time}
                                                onChange={(e) => setNewJadwalForm({ ...newJadwalForm, time: e.target.value })}
                                                className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs"
                                            />
                                        </div>
                                    </div>
                                    <div className="flex justify-end gap-2 pt-3">
                                        <button
                                            type="button"
                                            onClick={() => setShowAddJadwalModal(false)}
                                            className="px-4 py-2 border border-slate-300 text-slate-700 text-xs font-bold rounded-lg hover:bg-slate-50"
                                        >
                                            Batal
                                        </button>
                                        <button
                                            type="submit"
                                            className="px-4 py-2 bg-[#06315b] hover:bg-[#042444] text-amber-400 text-xs font-bold rounded-lg shadow"
                                        >
                                            Simpan & Tambah Jadwal
                                        </button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'system' && adminUser.role === 'Super Admin' && <AdminSystemPanel />}
            {activeTab === 'followups' && adminUser.role === 'Super Admin' && <AdminFollowupsPanel />}
            {activeTab === 'lead-qualification' && canAccessLeadQualificationTab(adminUser.role) && <AdminLeadQualificationPanel />}
            {activeTab === 'daily-report' && ['Super Admin', 'Admin Konsultan'].includes(adminUser.role) && <AdminDailyReportPanel />}

            {/* TAB TIM ADMIN (READ-ONLY KHUSUS SUPER ADMIN) */}
      {activeTab === 'admins' && canAccessAdminsTab(adminUser.role) && (
        <div className="max-w-4xl mx-auto p-6">
          <div className="bg-white rounded-2xl shadow-sm border-t-4 border-[#06315b] p-6">
            <div className="flex flex-wrap justify-between items-center gap-2 mb-4 border-b border-slate-100 pb-3">
              <div>
                <h2 className="font-extrabold text-[#06315b]">Direktori Tim Admin (Read-Only)</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Penambahan, penggantian, dan penonaktifan akun Admin dikelola sepenuhnya melalui Supabase.
                </p>
              </div>
              <button
                type="button"
                onClick={() => fetchAdmins(adminUser.role)}
                className="text-xs font-bold text-[#06315b] hover:underline"
              >
                🔄 Refresh Direktori
              </button>
            </div>
            <div className="divide-y divide-slate-100">
              {adminList.length === 0 ? (
                <p className="text-sm text-slate-500 py-4">
                  Belum ada data Admin.
                </p>
              ) : (
                adminList.map((adm) => (
                  <div
                    key={adm.id}
                    className="py-4 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3"
                  >
                    <div>
                      <div className="font-bold text-sm text-[#06315b]">
                        {adm.nama_admin}{' '}
                        {adm.username && (
                          <span className="text-xs font-mono text-slate-500">
                            (@{adm.username})
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 font-mono mt-0.5">
                        Email: {adm.email || 'Belum diisi'} • WA: {adm.no_wa || 'Belum diisi'}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-bold ${
                          adm.is_active
                            ? 'bg-green-100 text-green-700'
                            : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {adm.is_active ? 'Aktif' : 'Nonaktif'}
                      </span>

                      <span className="px-3 py-1 bg-amber-400/20 text-[#06315b] rounded-full text-xs font-extrabold">
                        {adm.role}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}