'use client';

import { useState, useEffect } from 'react';

function KDJLogoHeader() {
    return (
        <a href="/" className="bg-white px-4 h-14 sm:h-16 w-52 sm:w-64 rounded-xl shadow-md flex items-center justify-center overflow-hidden border-2 border-amber-400/80">
            <img
                src="/logo-kdj-panjang.png"
                alt="Kuliah di Jordan"
                className="w-full h-auto object-cover scale-125"
            />
        </a>
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

export default function AdminDashboard() {
    const [adminUser, setAdminUser] = useState(null);
    const [phone, setPhone] = useState('');
    const [otp, setOtp] = useState('');
    const [authStep, setAuthStep] = useState(1);
    const [authMsg, setAuthMsg] = useState('');

    const [activeTab, setActiveTab] = useState('pendaftar');
    const [pendaftarList, setPendaftarList] = useState([]);
    const [adminList, setAdminList] = useState([]);
    const [jadwalList, setJadwalList] = useState([]); // State untuk Jadwal
    
    const [selectedUser, setSelectedUser] = useState(null);
    const [statusBaru, setStatusBaru] = useState('');
    const [statusPembayaranBaru, setStatusPembayaranBaru] = useState('');
    const [catatanAdmin, setCatatanAdmin] = useState('');
    const [docUpdates, setDocUpdates] = useState([]);
    const [loading, setLoading] = useState(false);

    const [newAdmin, setNewAdmin] = useState({ no_wa: '', nama_admin: '', role: 'Admin Verifikator' });

    useEffect(() => {
        const savedAdmin = localStorage.getItem('kdj_admin');
        if (savedAdmin) {
            setAdminUser(JSON.parse(savedAdmin));
            fetchPendaftar();
            fetchAdmins();
            fetchJadwal();
        }
    }, []);

    const fetchPendaftar = async () => {
        const res = await fetch('/api/admin/pendaftar');
        const result = await res.json();
        if (result.success) setPendaftarList(result.data);
    };

    const fetchAdmins = async () => {
        const res = await fetch('/api/admin/auth');
        const result = await res.json();
        if (result.success) setAdminList(result.admins);
    };

    const fetchJadwal = async () => {
        try {
            const res = await fetch('/api/admin/jadwal');
            // Cek apakah respons dari server adalah OK (status 200)
            if (!res.ok) {
                console.warn('API Jadwal bermasalah atau belum tersedia.');
                return;
            }
            const result = await res.json();
            if (result.success) setJadwalList(result.data);
        } catch (error) {
            console.error('Gagal mengambil data jadwal:', error);
        }
    };

    const handleUpdateStatusJadwal = async (id, newStatus) => {
        try {
            const res = await fetch('/api/admin/jadwal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, status: newStatus })
            });
            const result = await res.json();
            if (result.success) {
                fetchJadwal();
            } else {
                alert('Gagal update jadwal: ' + result.message);
            }
        } catch (error) {
            alert('Terjadi kesalahan server.');
        }
    };

    const handleRequestAdminOtp = async (e) => {
        e.preventDefault();
        setLoading(true);
        setAuthMsg('');

        try {
            const checkRes = await fetch('/api/admin/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'check_admin', phone })
            });
            const checkData = await checkRes.json();

            if (!checkData.success) {
                setAuthMsg('❌ ' + checkData.message);
                setLoading(false);
                return;
            }

            const otpRes = await fetch('/api/auth/request-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone })
            });
            const otpData = await otpRes.json();

            if (otpData.success) {
                setAuthStep(2);
                setAuthMsg(`✅ Halo ${checkData.admin.nama_admin}! Kode OTP telah dikirim ke WA.`);
            } else {
                setAuthMsg('❌ ' + otpData.message);
            }
        } catch {
            setAuthMsg('❌ Gagal menghubungi server.');
        } finally {
            setLoading(false);
        }
    };

    const handleVerifyAdminOtp = async (e) => {
        e.preventDefault();
        setLoading(true);
        setAuthMsg('');

        try {
            const res = await fetch('/api/admin/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'verify_admin_otp', phone, otp })
            });
            const data = await res.json();

            if (data.success) {
                setAdminUser(data.admin);
                localStorage.setItem('kdj_admin', JSON.stringify(data.admin));
                fetchPendaftar();
                fetchAdmins();
                fetchJadwal();
            } else {
                setAuthMsg('❌ ' + data.message);
            }
        } catch {
            setAuthMsg('❌ Terjadi kesalahan jaringan.');
        } finally {
            setLoading(false);
        }
    };

    const handleAddAdmin = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            const res = await fetch('/api/admin/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'add_admin',
                    new_admin_phone: newAdmin.no_wa,
                    new_admin_name: newAdmin.nama_admin,
                    new_admin_role: newAdmin.role
                })
            });
            const data = await res.json();
            if (data.success) {
                alert(`✅ Admin ${newAdmin.nama_admin} berhasil ditambahkan!`);
                setNewAdmin({ no_wa: '', nama_admin: '', role: 'Admin Verifikator' });
                fetchAdmins();
            } else {
                alert('❌ Gagal menambah admin: ' + data.message);
            }
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

        try {
            const res = await fetch('/api/admin/pendaftar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pendaftar_id: selectedUser.id,
                    no_wa: selectedUser.no_wa,
                    nama_lengkap: selectedUser.nama_lengkap,
                    status_pendaftaran: statusBaru,
                    status_pembayaran: statusPembayaranBaru,
                    catatan_admin: catatanAdmin,
                    doc_updates: docUpdates
                })
            });
            const data = await res.json();
            if (data.success) {
                alert('✅ Status pendaftaran & pembayaran diperbarui, serta Notifikasi WA telah dikirim!');
                fetchPendaftar();
                setSelectedUser(null);
            } else {
                alert('❌ Gagal update: ' + data.message);
            }
        } finally {
            setLoading(false);
        }
    };

    const handleLogoutAdmin = () => {
        localStorage.removeItem('kdj_admin');
        setAdminUser(null);
        setOtp('');
        setAuthStep(1);
    };

    // ================= LOGIN ADMIN =================
    if (!adminUser) {
        return (
            <div className="min-h-screen flex flex-col bg-[#06315b]">
                <div className="bg-[#042444] text-slate-200 text-xs py-2 px-6 border-b border-[#0a3f73]">
                    <div className="max-w-6xl mx-auto flex justify-between items-center">
                        <span>📞 0813-6624-5544 | ✉️ admin@kuliahdijordan.com</span>
                        <a href="/" className="text-amber-400 hover:underline font-semibold">&larr; Ke Portal Mahasiswa</a>
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
                            <p className="text-slate-500 text-xs mt-0.5">Khusus nomor WhatsApp Tim Admin terdaftar</p>
                        </div>

                        {authMsg && (
                            <div className="mb-4 p-3 rounded-lg text-xs font-semibold bg-slate-100 border border-slate-300 text-[#06315b] text-center">
                                {authMsg}
                            </div>
                        )}

                        {authStep === 1 ? (
                            <form onSubmit={handleRequestAdminOtp} className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-[#06315b] mb-1">Nomor WhatsApp Admin</label>
                                    <input
                                        type="text"
                                        required
                                        placeholder="08xxxxxxxxxx"
                                        value={phone}
                                        onChange={(e) => setPhone(e.target.value)}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:outline-none focus:border-[#06315b]"
                                    />
                                </div>
                                <button type="submit" disabled={loading} className="w-full py-3 bg-amber-400 hover:bg-amber-300 text-[#06315b] font-extrabold rounded-xl text-sm transition shadow-md">
                                    {loading ? 'Memeriksa Akses...' : 'Kirim OTP Admin'}
                                </button>
                            </form>
                        ) : (
                            <form onSubmit={handleVerifyAdminOtp} className="space-y-4">
                                <input
                                    type="text"
                                    required
                                    maxLength={6}
                                    placeholder="123456"
                                    value={otp}
                                    onChange={(e) => setOtp(e.target.value)}
                                    className="w-full text-center tracking-widest text-2xl font-bold px-4 py-3 bg-slate-50 border border-slate-300 rounded-xl"
                                />
                                <button type="submit" disabled={loading} className="w-full py-3 bg-[#06315b] hover:bg-[#042444] text-amber-400 font-extrabold rounded-xl text-sm transition shadow-md">
                                    {loading ? 'Memverifikasi...' : 'Verifikasi & Masuk Dashboard'}
                                </button>
                            </form>
                        )}
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
                                                {item.nama_lengkap || item.push_name || 'Belum Mengisi Nama'}
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
                                    <h3 className="font-extrabold text-base text-[#06315b]">{selectedUser.nama_lengkap || 'Calon Mahasiswa'}</h3>
                                    <p className="text-xs text-slate-500">WA: {selectedUser.no_wa} • Paspor: {selectedUser.no_paspor || '-'}</p>
                                </div>

                                {/* BAGIAN PEMERIKSAAN BUKTI PEMBAYARAN */}
                                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                                    <label className="block text-xs font-extrabold text-[#06315b] uppercase">Verifikasi Pembayaran</label>
                                    <div className="flex justify-between items-center text-xs">
                                        <span className="text-slate-600">Tagihan: Rp {Number(selectedUser.nominal_tagihan || 1500000).toLocaleString('id-ID')}</span>
                                        {selectedUser.bukti_bayar_url ? (
                                            <a href={selectedUser.bukti_bayar_url} target="_blank" rel="noreferrer" className="text-amber-600 font-bold underline">
                                                🔍 Lihat Bukti Transfer
                                            </a>
                                        ) : (
                                            <span className="text-red-500 font-semibold">⚠️ Belum upload bukti bayar</span>
                                        )}
                                    </div>
                                    <select
                                        value={statusPembayaranBaru}
                                        onChange={(e) => setStatusPembayaranBaru(e.target.value)}
                                        className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white font-semibold"
                                    >
                                        <option value="Belum Bayar">Belum Bayar</option>
                                        <option value="Menunggu Verifikasi">Menunggu Verifikasi</option>
                                        <option value="Lunas">Lunas (Approved) ✅</option>
                                        <option value="Ditolak">Ditolak ❌</option>
                                    </select>
                                </div>

                                <div className="space-y-2.5">
                                    <label className="block text-xs font-extrabold text-[#06315b] uppercase">Pemeriksaan Dokumen Persyaratan</label>
                                    {docUpdates.length === 0 ? (
                                        <p className="text-xs text-slate-400 italic">Belum ada dokumen yang diunggah.</p>
                                    ) : (
                                        docUpdates.map((doc) => (
                                            <div key={doc.id} className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
                                                <div>
                                                    <div className="text-xs font-bold uppercase text-[#06315b]">{doc.jenis_dokumen}</div>
                                                    <a href={doc.file_path} target="_blank" rel="noreferrer" className="text-xs text-amber-600 font-semibold underline">
                                                        Buka Berkas
                                                    </a>
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

                                <div>
                                    <label className="block text-xs font-extrabold text-[#06315b] uppercase mb-1.5">Ubah Status Pendaftaran</label>
                                    <select
                                        value={statusBaru}
                                        onChange={(e) => setStatusBaru(e.target.value)}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white font-semibold"
                                    >
                                        <option value="Submitted">Submitted (Menunggu Verifikasi)</option>
                                        <option value="Revisi Diajukan">Revisi Diajukan</option>
                                        <option value="Approved">Approved (Lolos Berkas) ✅</option>
                                        <option value="Rejected">Rejected / Perlu Revisi ⚠️</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-xs font-extrabold text-[#06315b] uppercase mb-1.5">Catatan ke WA Pendaftar</label>
                                    <textarea
                                        rows={3}
                                        value={catatanAdmin}
                                        onChange={(e) => setCatatanAdmin(e.target.value)}
                                        placeholder="Tulis pesan catatan untuk dikirim ke WA pendaftar..."
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                                    />
                                </div>

                                <button type="submit" disabled={loading} className="w-full py-3 bg-[#06315b] hover:bg-[#042444] text-amber-400 font-extrabold text-sm rounded-xl transition shadow">
                                    {loading ? 'Memproses...' : 'Simpan & Kirim Notifikasi WA'}
                                </button>
                            </form>
                        ) : (
                            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center text-slate-400 text-sm">
                                Pilih salah satu pendaftar di sebelah kiri untuk melakukan verifikasi berkas dan pembayaran.
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* TAB JADWAL KONSULTASI */}
            {activeTab === 'jadwal' && (
                <div className="max-w-6xl mx-auto p-6">
                    <div className="bg-white rounded-2xl shadow-sm border-t-4 border-amber-400 p-6">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="font-extrabold text-[#06315b] text-lg">Daftar Jadwal Konsultasi Leads</h2>
                            <button onClick={fetchJadwal} className="text-xs font-bold text-blue-600 hover:underline">
                                🔄 Refresh Jadwal
                            </button>
                        </div>

                        {jadwalList.length === 0 ? (
                            <p className="text-center text-slate-400 py-10 text-sm">Belum ada jadwal konsultasi yang terdaftar.</p>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {jadwalList.map((j) => (
                                    <div key={j.id} className="border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col justify-between hover:shadow-md transition bg-slate-50">
                                        <div>
                                            <div className="flex justify-between items-start mb-2">
                                                <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                                                    j.status === 'Selesai' ? 'bg-emerald-100 text-emerald-700' :
                                                    j.status === 'Batal' ? 'bg-red-100 text-red-700' :
                                                    'bg-amber-100 text-amber-800'
                                                }`}>
                                                    {j.status}
                                                </span>
                                                <span className="text-[10px] font-bold text-slate-500 bg-white px-2 py-0.5 border rounded">
                                                    {j.metode}
                                                </span>
                                            </div>
                                            <h3 className="font-extrabold text-[#06315b] text-base mb-1">{j.nama_leads || 'Leads Tanpa Nama'}</h3>
                                            <p className="text-xs font-mono text-slate-500 mb-3">WA: {j.no_wa}</p>
                                            
                                            <div className="bg-white border rounded-lg p-2 mb-4">
                                                <p className="text-[10px] font-bold text-slate-400 uppercase">Waktu Konsultasi:</p>
                                                <p className="text-xs font-semibold text-[#06315b]">
                                                    {new Date(j.jadwal_pilihan).toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'short' })} WIB
                                                </p>
                                            </div>
                                        </div>

                                        <div>
                                            <label className="block text-[10px] font-bold text-slate-500 mb-1">Update Status:</label>
                                            <select
                                                value={j.status}
                                                onChange={(e) => handleUpdateStatusJadwal(j.id, e.target.value)}
                                                className="w-full text-xs font-semibold px-2 py-1.5 border border-slate-300 rounded-lg bg-white focus:outline-none"
                                            >
                                                <option value="Terjadwal">📅 Terjadwal</option>
                                                <option value="Selesai">✅ Selesai</option>
                                                <option value="Batal">❌ Batal</option>
                                            </select>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* TAB TIM ADMIN */}
            {activeTab === 'admins' && (
                <div className="max-w-5xl mx-auto p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="md:col-span-2 bg-white rounded-2xl shadow-sm border-t-4 border-[#06315b] p-6">
                        <h2 className="font-extrabold text-[#06315b] mb-4">Daftar Tim Admin Aktif</h2>
                        <div className="divide-y divide-slate-100">
                            {adminList.map((adm) => (
                                <div key={adm.id} className="py-3 flex justify-between items-center">
                                    <div>
                                        <div className="font-bold text-sm text-[#06315b]">{adm.nama_admin}</div>
                                        <div className="text-xs text-slate-500 font-mono">WA: {adm.no_wa}</div>
                                    </div>
                                    <span className="px-3 py-1 bg-amber-400/20 text-[#06315b] rounded-full text-xs font-extrabold">
                                        {adm.role}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <form onSubmit={handleAddAdmin} className="bg-white rounded-2xl shadow-sm border-t-4 border-amber-400 p-6 space-y-4">
                        <h3 className="font-extrabold text-[#06315b] border-b pb-2">Tambah Admin Baru</h3>
                        <div>
                            <label className="block text-xs font-bold text-slate-600 mb-1">Nama Admin</label>
                            <input
                                type="text"
                                required
                                placeholder="Contoh: Jihad"
                                value={newAdmin.nama_admin}
                                onChange={(e) => setNewAdmin({ ...newAdmin, nama_admin: e.target.value })}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-600 mb-1">Nomor WhatsApp (08xx)</label>
                            <input
                                type="text"
                                required
                                placeholder="0812xxxxxxxx"
                                value={newAdmin.no_wa}
                                onChange={(e) => setNewAdmin({ ...newAdmin, no_wa: e.target.value })}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-600 mb-1">Peran / Role</label>
                            <select
                                value={newAdmin.role}
                                onChange={(e) => setNewAdmin({ ...newAdmin, role: e.target.value })}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                            >
                                <option value="Admin Verifikator">Admin Verifikator</option>
                                <option value="Admin Keuangan">Admin Keuangan</option>
                                <option value="Super Admin">Super Admin</option>
                            </select>
                        </div>
                        <button type="submit" disabled={loading} className="w-full py-2.5 bg-[#06315b] hover:bg-[#042444] text-amber-400 font-extrabold text-sm rounded-xl transition shadow">
                            + Daftarkan Admin
                        </button>
                    </form>
                </div>
            )}
        </div>
    );
}