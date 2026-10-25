'use client';

import { useState, useEffect } from 'react';

// Komponen Logo Header Navbar (Auto-crop ruang kosong putih agar tampil besar & proporsional)
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

// Komponen Logo Kotak (Untuk Card Login & Fallback Profil)
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

// Top Bar & Navbar Resmi
function OfficialHeader({ rightAction }) {
    return (
        <header className="w-full">
            <div className="bg-[#042444] text-slate-200 text-xs py-2 px-6 border-b border-[#0a3f73]">
                <div className="max-w-6xl mx-auto flex flex-wrap justify-between items-center gap-2">
                    <div className="flex items-center gap-5">
                        <span>📞 0813-6624-5544</span>
                        <span>✉️ admin@kuliahdijordan.com</span>
                    </div>
                    <div className="text-[11px] text-amber-400 font-medium">
                        Lembaga Pionir Pengurusan Kuliah di Yordania Sejak 2016
                    </div>
                </div>
            </div>

            <div className="bg-[#06315b] text-white py-3.5 px-6 shadow-md border-b-4 border-amber-400">
                <div className="max-w-6xl mx-auto flex justify-between items-center">
                    <KDJLogoHeader />
                    {rightAction && <div>{rightAction}</div>}
                </div>
            </div>
        </header>
    );
}

export default function PortalKDJ() {
    const [phone, setPhone] = useState('');
    const [otp, setOtp] = useState('');
    const [authStep, setAuthStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [uploadingDoc, setUploadingDoc] = useState('');
    const [message, setMessage] = useState('');
    const [user, setUser] = useState(null);

    const [wizardStep, setWizardStep] = useState(1);
    const [uploadedDocs, setUploadedDocs] = useState({});
    const [buktiBayarUrl, setBuktiBayarUrl] = useState('');

    const [formData, setFormData] = useState({
        nama_lengkap: '',
        tempat_lahir: '',
        tanggal_lahir: '',
        jenis_kelamin: 'Laki-laki',
        no_paspor: '',
        alamat_lengkap: '',
        asal_sekolah: '',
        tahun_lulus: '',
        pilihan_kampus: 'University of Jordan',
        pilihan_jurusan: 'Syariah / Ushuluddin'
    });

    useEffect(() => {
        const savedUser = localStorage.getItem('kdj_user');
        if (savedUser) {
            const parsed = JSON.parse(savedUser);
            setUser(parsed);
            setBuktiBayarUrl(parsed.bukti_bayar_url || '');
            setFormData({
                nama_lengkap: parsed.nama_lengkap || '',
                tempat_lahir: parsed.tempat_lahir || '',
                tanggal_lahir: parsed.tanggal_lahir || '',
                jenis_kelamin: parsed.jenis_kelamin || 'Laki-laki',
                no_paspor: parsed.no_paspor || '',
                alamat_lengkap: parsed.alamat_lengkap || '',
                asal_sekolah: parsed.asal_sekolah || '',
                tahun_lulus: parsed.tahun_lulus || '',
                pilihan_kampus: parsed.pilihan_kampus || 'University of Jordan',
                pilihan_jurusan: parsed.pilihan_jurusan || 'Syariah / Ushuluddin'
            });
            fetchUploadedDocs(parsed.no_wa);
        }
    }, []);

    const fetchUploadedDocs = async (userPhone) => {
        try {
            const res = await fetch(`/api/upload-dokumen?no_wa=${userPhone}`);
            const data = await res.json();
            if (data.success) {
                if (data.documents) {
                    const mapDocs = {};
                    data.documents.forEach((d) => {
                        mapDocs[d.jenis_dokumen] = d;
                    });
                    setUploadedDocs(mapDocs);
                }
                // Sinkronkan status terbaru pendaftar dari database (termasuk jika ada catatan revisi dari admin)
                if (data.pendaftar) {
                    setBuktiBayarUrl(data.pendaftar.bukti_bayar_url || '');
                    setUser((prev) => {
                        const updatedUser = { ...prev, ...data.pendaftar };
                        localStorage.setItem('kdj_user', JSON.stringify(updatedUser));
                        return updatedUser;
                    });

                    const st = (data.pendaftar.status_pendaftaran || '').toLowerCase();
                    if (st === 'rejected') {
                        setWizardStep(3);
                    }
                }
            }
        } catch (err) {
            console.error('Gagal memuat dokumen:', err);
        }
    };

    const calculateProgress = () => {
        const fields = [
            formData.nama_lengkap, formData.tempat_lahir, formData.tanggal_lahir,
            formData.no_paspor, formData.alamat_lengkap, formData.asal_sekolah,
            formData.tahun_lulus, formData.pilihan_kampus, formData.pilihan_jurusan,
            uploadedDocs['pasfoto'], uploadedDocs['paspor'], uploadedDocs['ijazah'], uploadedDocs['transkrip'],
            buktiBayarUrl
        ];
        const filled = fields.filter((f) => f && String(f).trim() !== '').length;
        return Math.round((filled / fields.length) * 100);
    };

    const handleRequestOtp = async (e) => {
        e.preventDefault();
        setLoading(true);
        setMessage('');
        try {
            const res = await fetch('/api/auth/request-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone })
            });
            const data = await res.json();
            if (data.success) {
                setAuthStep(2);
                setMessage('✅ Kode OTP telah dikirim ke WhatsApp Anda!');
            } else {
                setMessage('❌ ' + data.message);
            }
        } catch {
            setMessage('❌ Gagal menghubungi server.');
        } finally {
            setLoading(false);
        }
    };

    const handleVerifyOtp = async (e) => {
        e.preventDefault();
        setLoading(true);
        setMessage('');
        try {
            const res = await fetch('/api/auth/verify-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone, otp })
            });
            const data = await res.json();
            if (data.success) {
                setUser(data.user);
                setBuktiBayarUrl(data.user.bukti_bayar_url || '');
                localStorage.setItem('kdj_user', JSON.stringify(data.user));
                setFormData({
                    nama_lengkap: data.user.nama_lengkap || '',
                    tempat_lahir: data.user.tempat_lahir || '',
                    tanggal_lahir: data.user.tanggal_lahir || '',
                    jenis_kelamin: data.user.jenis_kelamin || 'Laki-laki',
                    no_paspor: data.user.no_paspor || '',
                    alamat_lengkap: data.user.alamat_lengkap || '',
                    asal_sekolah: data.user.asal_sekolah || '',
                    tahun_lulus: data.user.tahun_lulus || '',
                    pilihan_kampus: data.user.pilihan_kampus || 'University of Jordan',
                    pilihan_jurusan: data.user.pilihan_jurusan || 'Syariah / Ushuluddin'
                });
                fetchUploadedDocs(data.user.no_wa);
            } else {
                setMessage('❌ ' + data.message);
            }
        } catch {
            setMessage('❌ Terjadi kesalahan jaringan.');
        } finally {
            setLoading(false);
        }
    };

    const handleSaveStep = async (nextStep) => {
        const isFinalSubmit = nextStep === null;

        // Validasi kelengkapan saat tombol Final Submit ditekan
        if (isFinalSubmit) {
            const requiredDocs = ['pasfoto', 'paspor', 'ijazah', 'transkrip'];
            const missingDocs = requiredDocs.filter((doc) => !uploadedDocs[doc]);
            if (missingDocs.length > 0) {
                alert(`⚠️ Mohon lengkapi dokumen wajib di Step 3 terlebih dahulu: ${missingDocs.join(', ').toUpperCase()}`);
                setWizardStep(3);
                return;
            }
            if (!buktiBayarUrl) {
                alert('⚠️ Mohon unggah bukti transfer pembayaran di Step 4 sebelum mengirim pendaftaran!');
                setWizardStep(4);
                return;
            }
        }

        setLoading(true);
        const currentStatus = (user?.status_pendaftaran || '').toLowerCase();
        const isRevision = currentStatus === 'rejected';

        try {
            const res = await fetch('/api/pendaftar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    no_wa: user.no_wa,
                    ...formData,
                    is_final_submit: isFinalSubmit,
                    is_revision: isRevision
                })
            });
            const data = await res.json();
            if (data.success) {
                const updatedUser = {
                    ...user,
                    ...data.user,
                    ...(isFinalSubmit
                        ? {
                              status_pendaftaran: isRevision
                                  ? 'Revisi Diajukan'
                                  : data.user?.status_pendaftaran || 'Submitted'
                          }
                        : {})
                };
                setUser(updatedUser);
                localStorage.setItem('kdj_user', JSON.stringify(updatedUser));

                if (nextStep) {
                    setWizardStep(nextStep);
                } else {
                    alert(
                        isRevision
                            ? '🔄 Perbaikan berkas berhasil dikirim ulang! Tim Admin akan segera memeriksa kembali.'
                            : '🎉 Pendaftaran & Bukti Pembayaran selesai dikirim! Notifikasi konfirmasi telah dikirim ke WhatsApp Anda.'
                    );
                }
            } else {
                alert('❌ Gagal menyimpan: ' + data.message);
            }
        } finally {
            setLoading(false);
        }
    };

    const handleFileUpload = async (e, jenisDokumen) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.size > 5 * 1024 * 1024) {
            alert('Ukuran file maksimal 5 MB!');
            return;
        }

        setUploadingDoc(jenisDokumen);
        const data = new FormData();
        data.append('file', file);
        data.append('jenis_dokumen', jenisDokumen);
        data.append('no_wa', user.no_wa);

        try {
            const res = await fetch('/api/upload-dokumen', {
                method: 'POST',
                body: data
            });
            const result = await res.json();

            if (result.success) {
                if (jenisDokumen === 'bukti_bayar') {
                    setBuktiBayarUrl(result.url);
                    const updatedUser = {
                        ...user,
                        bukti_bayar_url: result.url,
                        status_pembayaran: 'Menunggu Verifikasi'
                    };
                    setUser(updatedUser);
                    localStorage.setItem('kdj_user', JSON.stringify(updatedUser));
                    alert('✅ Bukti transfer pembayaran berhasil diunggah!');
                } else {
                    setUploadedDocs((prev) => ({ ...prev, [jenisDokumen]: result.doc }));
                    alert(`✅ Dokumen ${jenisDokumen} berhasil diunggah!`);
                }
            } else {
                alert('❌ Gagal upload: ' + result.message);
            }
        } catch {
            alert('❌ Terjadi kesalahan saat mengunggah file.');
        } finally {
            setUploadingDoc('');
        }
    };

    const handleLogout = () => {
        localStorage.removeItem('kdj_user');
        setUser(null);
        setOtp('');
        setAuthStep(1);
    };

    // ================= TAMPILAN DASHBOARD =================
    if (user) {
        const progress = calculateProgress();
        const rawStatus = user.status_pendaftaran || 'Draft';
        const normStatus = rawStatus.toLowerCase();

        // Status penguncian form & deteksi mode revisi
        const isRejected = normStatus === 'rejected';
        const isApproved = normStatus === 'approved';
        const isWaitingVerification = ['submitted', 'menunggu verifikasi', 'Menunggu Verifikasi', 'revisi diajukan', 'final_submit'].includes(normStatus);
        const isLocked = isApproved || isWaitingVerification;

        return (
            <div className="min-h-screen bg-slate-100 text-slate-800 pb-14">
                <OfficialHeader
                    rightAction={
                        <button
                            onClick={handleLogout}
                            className="px-4 py-1.5 bg-amber-400 hover:bg-amber-300 text-[#06315b] font-bold text-xs rounded-lg transition shadow-sm"
                        >
                            Keluar (Logout)
                        </button>
                    }
                />

                <div className="bg-[#06315b] text-white pt-6 pb-24 px-6 text-center">
                    <div className="w-16 h-0.5 bg-amber-400 mx-auto mb-3" />
                    <h1 className="text-xl sm:text-2xl font-extrabold uppercase tracking-wide">
                        PORTAL PENDAFTARAN MAHASISWA BARU KDJ
                    </h1>
                    <p className="text-xs sm:text-sm text-slate-200 max-w-2xl mx-auto mt-1">
                        Lengkapi tahapan biodata, pilihan universitas di Yordania, dokumen pemberkasan, serta pembayaran administrasi Anda di bawah ini.
                    </p>
                </div>

                <div className="max-w-6xl mx-auto px-6 -mt-14 grid grid-cols-1 lg:grid-cols-4 gap-6 relative z-10">
                    <div className="lg:col-span-3 bg-white rounded-2xl shadow-md border-t-4 border-amber-400 p-8">
                        
                        {/* BANNER STATUS & CATATAN ADMIN */}
                        {isRejected && (
                            <div className="mb-8 p-5 bg-red-50 border-l-4 border-red-600 rounded-r-xl shadow-sm">
                                <div className="flex items-center justify-between flex-wrap gap-2">
                                    <h3 className="text-red-800 font-extrabold text-base flex items-center gap-2">
                                        ⚠️ Berkas / Pembayaran Perlu Direvisi (Ditolak Sementara)
                                    </h3>
                                    <span className="px-3 py-1 text-[11px] font-extrabold bg-red-200 text-red-900 rounded-full uppercase">
                                        Perlu Perbaikan
                                    </span>
                                </div>
                                <div className="mt-3 p-3.5 bg-white border border-red-200 rounded-lg text-sm text-slate-800 font-semibold">
                                    Catatan Admin: &ldquo;{user.catatan_admin || 'Mohon periksa kembali kelengkapan dan kejelasan dokumen atau bukti pembayaran Anda.'}&rdquo;
                                </div>
                                <p className="text-red-700 mt-2.5 text-xs">
                                    Silakan unggah ulang dokumen yang diminta pada <strong>Step 3</strong> atau bukti bayar pada <strong>Step 4</strong>, lalu klik tombol <strong>Kirim Ulang Perbaikan</strong>.
                                </p>
                            </div>
                        )}

                        {isWaitingVerification && (
                            <div className="mb-8 p-5 bg-amber-50 border-l-4 border-amber-400 rounded-r-xl shadow-sm">
                                <h3 className="text-[#06315b] font-extrabold text-base flex items-center gap-2">
                                    ⏳ Pendaftaran Sedang Diverifikasi Tim Admin
                                </h3>
                                <p className="text-slate-600 mt-1 text-xs leading-relaxed">
                                    Formulir dan dokumen Anda saat ini dikunci sementara karena sedang dalam antrean pemeriksaan. Hasil verifikasi akan dikirimkan langsung ke nomor WhatsApp Anda.
                                </p>
                            </div>
                        )}

                        {isApproved && (
                            <div className="mb-8 p-5 bg-emerald-50 border-l-4 border-emerald-600 rounded-r-xl shadow-sm">
                                <h3 className="text-emerald-800 font-extrabold text-base flex items-center gap-2">
                                    ✅ Pendaftaran & Berkas Disetujui (Approved)
                                </h3>
                                <p className="text-emerald-700 mt-1 text-xs leading-relaxed">
                                    Alhamdulillah! Seluruh berkas persyaratan dan pembayaran administrasi Anda telah dinyatakan lengkap dan valid oleh Tim Kuliah di Jordan.
                                </p>
                                {user.catatan_admin && (
                                    <div className="mt-2 p-2.5 bg-white border border-emerald-200 rounded-lg text-xs text-slate-700">
                                        <strong>Pesan Admin:</strong> {user.catatan_admin}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* WIZARD NAVIGATION (4 LANGKAH) */}
                        <div className="flex items-center justify-between max-w-2xl mx-auto mb-10">
                            {[
                                { num: 1, label: 'Data Diri' },
                                { num: 2, label: 'Kampus & Jurusan' },
                                { num: 3, label: 'Upload Berkas' },
                                { num: 4, label: 'Pembayaran' }
                            ].map((item, idx) => (
                                <div key={item.num} className="flex items-center flex-1 last:flex-none">
                                    <button
                                        type="button"
                                        onClick={() => setWizardStep(item.num)}
                                        className="flex flex-col items-center group focus:outline-none"
                                    >
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm border-2 transition ${
                                            wizardStep === item.num
                                                ? 'border-[#06315b] bg-amber-400 text-[#06315b] shadow'
                                                : wizardStep > item.num
                                                ? 'border-[#06315b] bg-[#06315b] text-white'
                                                : 'border-slate-300 text-slate-400 bg-white'
                                        }`}>
                                            {item.num}
                                        </div>
                                        <span className={`text-xs mt-2 font-bold text-center ${
                                            wizardStep >= item.num ? 'text-[#06315b]' : 'text-slate-400'
                                        }`}>
                                            {item.label}
                                        </span>
                                    </button>

                                    {idx < 3 && (
                                        <div className={`flex-1 h-0.5 mx-2 sm:mx-4 -mt-5 transition ${
                                            wizardStep > item.num ? 'bg-[#06315b]' : 'bg-slate-200'
                                        }`} />
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* STEP 1: DATA DIRI */}
                        {wizardStep === 1 && (
                            <div className="space-y-6">
                                <div className="border-l-4 border-[#06315b] pl-3">
                                    <h2 className="text-base font-bold text-[#06315b]">1. Personal Data (Data Diri Calon Mahasiswa)</h2>
                                    <p className="text-xs text-slate-500">Isi identitas diri sesuai dengan Paspor atau KTP resmi.</p>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">Nama Lengkap (Sesuai Paspor) <span className="text-red-500">*</span></label>
                                        <input type="text" disabled={isLocked} value={formData.nama_lengkap} onChange={(e) => setFormData({...formData, nama_lengkap: e.target.value})} placeholder="Masukkan nama lengkap" className="w-full px-3.5 py-2.5 bg-white disabled:bg-slate-100 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-[#06315b]" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">Jenis Kelamin <span className="text-red-500">*</span></label>
                                        <select disabled={isLocked} value={formData.jenis_kelamin} onChange={(e) => setFormData({...formData, jenis_kelamin: e.target.value})} className="w-full px-3.5 py-2.5 bg-white disabled:bg-slate-100 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-[#06315b]">
                                            <option value="Laki-laki">Laki-laki (Male)</option>
                                            <option value="Perempuan">Perempuan (Female)</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">Tempat Lahir <span className="text-red-500">*</span></label>
                                        <input type="text" disabled={isLocked} value={formData.tempat_lahir} onChange={(e) => setFormData({...formData, tempat_lahir: e.target.value})} placeholder="Contoh: Semarang" className="w-full px-3.5 py-2.5 bg-white disabled:bg-slate-100 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-[#06315b]" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">Tanggal Lahir <span className="text-red-500">*</span></label>
                                        <input type="date" disabled={isLocked} value={formData.tanggal_lahir} onChange={(e) => setFormData({...formData, tanggal_lahir: e.target.value})} className="w-full px-3.5 py-2.5 bg-white disabled:bg-slate-100 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-[#06315b]" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">Nomor Paspor <span className="text-red-500">*</span></label>
                                        <input type="text" disabled={isLocked} value={formData.no_paspor} onChange={(e) => setFormData({...formData, no_paspor: e.target.value})} placeholder="Contoh: X1234567" className="w-full px-3.5 py-2.5 bg-white disabled:bg-slate-100 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-[#06315b]" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">Nomor WhatsApp Terdaftar</label>
                                        <input type="text" disabled value={user.no_wa} className="w-full px-3.5 py-2.5 bg-slate-100 border border-slate-200 rounded-lg text-sm text-slate-500 font-mono" />
                                    </div>
                                    <div className="md:col-span-2">
                                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">Alamat Lengkap Domisili <span className="text-red-500">*</span></label>
                                        <textarea rows={2} disabled={isLocked} value={formData.alamat_lengkap} onChange={(e) => setFormData({...formData, alamat_lengkap: e.target.value})} placeholder="Nama jalan, kecamatan, kabupaten/kota, provinsi..." className="w-full px-3.5 py-2.5 bg-white disabled:bg-slate-100 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-[#06315b]" />
                                    </div>
                                </div>

                                <div className="flex justify-end pt-4 border-t border-slate-100">
                                    {isLocked ? (
                                        <button onClick={() => setWizardStep(2)} className="px-6 py-2.5 bg-[#06315b] text-amber-400 text-sm font-bold rounded-lg transition shadow">
                                            Lanjut ke Step 2 &rarr;
                                        </button>
                                    ) : (
                                        <button onClick={() => handleSaveStep(2)} disabled={loading} className="px-6 py-2.5 bg-[#06315b] hover:bg-[#042444] text-amber-400 text-sm font-bold rounded-lg transition shadow">
                                            {loading ? 'Menyimpan...' : 'Simpan & Lanjut (Next) >'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* STEP 2: KAMPUS & JURUSAN */}
                        {wizardStep === 2 && (
                            <div className="space-y-6">
                                <div className="border-l-4 border-[#06315b] pl-3">
                                    <h2 className="text-base font-bold text-[#06315b]">2. Pilihan Universitas & Jurusan di Yordania</h2>
                                    <p className="text-xs text-slate-500">Masukkan data sekolah asal serta kampus tujuan Anda di Yordania.</p>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">Nama Sekolah / Pesantren Asal <span className="text-red-500">*</span></label>
                                        <input type="text" disabled={isLocked} value={formData.asal_sekolah} onChange={(e) => setFormData({...formData, asal_sekolah: e.target.value})} placeholder="Contoh: MA Al-Irsyad / SMA Negeri 1" className="w-full px-3.5 py-2.5 bg-white disabled:bg-slate-100 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-[#06315b]" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">Tahun Kelulusan <span className="text-red-500">*</span></label>
                                        <input type="number" disabled={isLocked} value={formData.tahun_lulus} onChange={(e) => setFormData({...formData, tahun_lulus: e.target.value})} placeholder="Contoh: 2026" className="w-full px-3.5 py-2.5 bg-white disabled:bg-slate-100 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-[#06315b]" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">Pilihan Universitas di Yordania <span className="text-red-500">*</span></label>
                                        <select disabled={isLocked} value={formData.pilihan_kampus} onChange={(e) => setFormData({...formData, pilihan_kampus: e.target.value})} className="w-full px-3.5 py-2.5 bg-white disabled:bg-slate-100 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-[#06315b]">
                                            <option value="University of Jordan">University of Jordan (Amman)</option>
                                            <option value="Yarmouk University">Yarmouk University (Irbid)</option>
                                            <option value="Mutah University">Mu&apos;tah University (Karak)</option>
                                            <option value="WISE">WISE</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">Pilihan Jurusan <span className="text-red-500">*</span></label>
                                        <select disabled={isLocked} value={formData.pilihan_jurusan} onChange={(e) => setFormData({...formData, pilihan_jurusan: e.target.value})} className="w-full px-3.5 py-2.5 bg-white disabled:bg-slate-100 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-[#06315b]">
                                            <option value="Ekonomi Syariah">Ekonomi Syariah</option>
                                            <option value="Bahasa & Sastra Arab">Bahasa & Sastra Arab</option>
                                            <option value="Fiqh wa Ushuluhu">Fiqh wa Ushuluhu</option>
                                            <option value="Syariah">Syariah</option>
                                            <option value="Aqidah">Aqidah</option>
                                        </select>
                                    </div>
                                </div>

                                <div className="flex justify-between pt-4 border-t border-slate-100">
                                    <button onClick={() => setWizardStep(1)} className="px-5 py-2.5 border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-semibold rounded-lg transition">
                                        &lt; Kembali
                                    </button>
                                    {isLocked ? (
                                        <button onClick={() => setWizardStep(3)} className="px-6 py-2.5 bg-[#06315b] text-amber-400 text-sm font-bold rounded-lg transition shadow">
                                            Lanjut ke Step 3 &rarr;
                                        </button>
                                    ) : (
                                        <button onClick={() => handleSaveStep(3)} disabled={loading} className="px-6 py-2.5 bg-[#06315b] hover:bg-[#042444] text-amber-400 text-sm font-bold rounded-lg transition shadow">
                                            {loading ? 'Menyimpan...' : 'Simpan & Lanjut (Next) >'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* STEP 3: UPLOAD BERKAS */}
                        {wizardStep === 3 && (
                            <div className="space-y-6">
                                <div className="border-l-4 border-[#06315b] pl-3">
                                    <h2 className="text-base font-bold text-[#06315b]">3. Unggah Dokumen Persyaratan (Attachments)</h2>
                                    <p className="text-xs text-slate-500">Unggah berkas asli Anda dalam format PDF, JPG, atau PNG (Maks. 5 MB).</p>
                                </div>

                                <div className="space-y-4">
                                    {[
                                        { id: 'pasfoto', title: 'Pasfoto Resmi (4x6 Latar Putih)', req: 'Wajib' },
                                        { id: 'paspor', title: 'Scan Halaman Identitas Paspor Aktif', req: 'Wajib' },
                                        { id: 'ijazah', title: 'Ijazah SMA / MA / Pesantren Sederajat', req: 'Wajib' },
                                        { id: 'transkrip', title: 'Transkrip Nilai / SKHUN', req: 'Wajib' }
                                    ].map((doc) => {
                                        const uploaded = uploadedDocs[doc.id];
                                        const isCurrentUploading = uploadingDoc === doc.id;

                                        return (
                                            <div key={doc.id} className={`p-4 border rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition ${
                                                uploaded ? 'border-emerald-300 bg-emerald-50/40' : 'border-dashed border-slate-300 bg-slate-50'
                                            }`}>
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm font-bold text-[#06315b]">{doc.title}</span>
                                                        <span className="text-[11px] px-2 py-0.5 bg-amber-100 text-[#06315b] rounded font-bold">{doc.req}</span>
                                                    </div>
                                                    {uploaded ? (
                                                        <div className="flex items-center gap-3 mt-1">
                                                            <span className="text-xs text-emerald-700 font-semibold">✅ Berkas Terunggah</span>
                                                            <span className={`text-[11px] px-2 py-0.5 rounded font-bold uppercase ${
                                                                uploaded.status_dokumen === 'approved' ? 'bg-emerald-200 text-emerald-900' :
                                                                uploaded.status_dokumen === 'rejected' ? 'bg-red-200 text-red-900' :
                                                                'bg-amber-200 text-amber-900'
                                                            }`}>
                                                                Status: {uploaded.status_dokumen}
                                                            </span>
                                                            <a href={uploaded.file_path} target="_blank" rel="noreferrer" className="text-xs text-[#06315b] font-semibold underline">
                                                                Lihat File
                                                            </a>
                                                        </div>
                                                    ) : (
                                                        <p className="text-xs text-slate-400 mt-0.5">Belum ada file diunggah (PDF/JPG/PNG)</p>
                                                    )}
                                                </div>

                                                {!isLocked && (
                                                    <label className={`cursor-pointer px-4 py-2 text-xs font-bold rounded-lg shadow-sm transition shrink-0 ${
                                                        isCurrentUploading
                                                            ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                                                            : uploaded
                                                            ? 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'
                                                            : 'bg-[#06315b] hover:bg-[#042444] text-amber-400'
                                                    }`}>
                                                        {isCurrentUploading ? 'Mengunggah...' : uploaded ? 'Ganti Berkas' : 'Pilih & Upload'}
                                                        <input
                                                            type="file"
                                                            accept=".pdf,.jpg,.jpeg,.png"
                                                            disabled={isCurrentUploading || isLocked}
                                                            className="hidden"
                                                            onChange={(e) => handleFileUpload(e, doc.id)}
                                                        />
                                                    </label>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>

                                <div className="flex justify-between pt-4 border-t border-slate-100">
                                    <button onClick={() => setWizardStep(2)} className="px-5 py-2.5 border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-semibold rounded-lg transition">
                                        &lt; Kembali
                                    </button>
                                    <button onClick={() => setWizardStep(4)} className="px-6 py-2.5 bg-[#06315b] hover:bg-[#042444] text-amber-400 text-sm font-bold rounded-lg transition shadow">
                                        Lanjut ke Pembayaran (Step 4) &gt;
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* STEP 4: PEMBAYARAN ADMINISTRASI (OPSI B) */}
                        {wizardStep === 4 && (
                            <div className="space-y-6">
                                <div className="border-l-4 border-[#06315b] pl-3">
                                    <h2 className="text-base font-bold text-[#06315b]">4. Pembayaran Biaya Pendaftaran & Administrasi</h2>
                                    <p className="text-xs text-slate-500">Selesaikan pembayaran tagihan pendaftaran dan unggah bukti transfer Anda di bawah ini.</p>
                                </div>

                                {/* Ringkasan Tagihan */}
                                <div className="p-5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                                    <div className="flex justify-between items-center text-xs sm:text-sm text-slate-600 border-b border-slate-200 pb-3">
                                        <span>Deskripsi Tagihan</span>
                                        <span className="font-bold text-[#06315b]">Biaya Pendaftaran & Pemberkasan KDJ</span>
                                    </div>
                                    <div className="flex justify-between items-center text-xs sm:text-sm text-slate-600 border-b border-slate-200 pb-3">
                                        <span>Status Pembayaran</span>
                                        <span className={`px-2.5 py-0.5 rounded font-extrabold uppercase text-[11px] ${
                                            user.status_pembayaran === 'Lunas'
                                                ? 'bg-emerald-200 text-emerald-900'
                                                : user.status_pembayaran === 'Ditolak'
                                                ? 'bg-red-200 text-red-900'
                                                : user.status_pembayaran === 'Menunggu Verifikasi'
                                                ? 'bg-amber-200 text-amber-900'
                                                : 'bg-slate-200 text-slate-700'
                                        }`}>
                                            {user.status_pembayaran || 'Belum Bayar'}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center pt-1">
                                        <span className="text-sm font-bold text-slate-800">Total Nominal Tagihan</span>
                                        <span className="text-xl sm:text-2xl font-extrabold text-[#06315b]">
                                            Rp {Number(user.nominal_tagihan || 1500000).toLocaleString('id-ID')}
                                        </span>
                                    </div>
                                </div>

                                {/* Rekening Tujuan */}
                                <div className="p-4 bg-amber-50/70 border border-amber-300 rounded-xl">
                                    <h4 className="text-xs font-extrabold uppercase tracking-wider text-[#06315b] mb-2">
                                        💳 Rekening Resmi Pembayaran KDJ
                                    </h4>
                                    <div className="space-y-1 text-xs sm:text-sm text-slate-700">
                                        <p>Bank Tujuan: <strong className="text-[#06315b]">Bank Syariah Indonesia (BSI)</strong></p>
                                        <p>Nomor Rekening: <strong className="font-mono text-base text-[#06315b] bg-white px-2 py-0.5 rounded border border-amber-200">7123456789</strong></p>
                                        <p>Atas Nama: <strong className="text-[#06315b]">Kuliah di Jordan Official</strong></p>
                                    </div>
                                    <p className="text-[11px] text-slate-500 mt-3">
                                        *Harap cantumkan Nama Lengkap dan Nomor WhatsApp Anda pada berita/catatan transfer.
                                    </p>
                                </div>

                                {/* Box Upload Bukti Bayar */}
                                <div className={`p-4 border rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition ${
                                    buktiBayarUrl ? 'border-emerald-300 bg-emerald-50/40' : 'border-dashed border-slate-300 bg-slate-50'
                                }`}>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-bold text-[#06315b]">Bukti Transfer Pembayaran</span>
                                            <span className="text-[11px] px-2 py-0.5 bg-amber-100 text-[#06315b] rounded font-bold">Wajib</span>
                                        </div>
                                        {buktiBayarUrl ? (
                                            <div className="flex items-center gap-3 mt-1">
                                                <span className="text-xs text-emerald-700 font-semibold">✅ Bukti Transfer Terunggah</span>
                                                <a href={buktiBayarUrl} target="_blank" rel="noreferrer" className="text-xs text-[#06315b] font-semibold underline">
                                                    Lihat Bukti Transfer
                                                </a>
                                            </div>
                                        ) : (
                                            <p className="text-xs text-slate-400 mt-0.5">Unggah struk / tangkapan layar bukti transfer (JPG/PNG/PDF, Maks. 5 MB)</p>
                                        )}
                                    </div>

                                    {!isLocked && (
                                        <label className={`cursor-pointer px-4 py-2 text-xs font-bold rounded-lg shadow-sm transition shrink-0 ${
                                            uploadingDoc === 'bukti_bayar'
                                                ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                                                : buktiBayarUrl
                                                ? 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'
                                                : 'bg-[#06315b] hover:bg-[#042444] text-amber-400'
                                        }`}>
                                            {uploadingDoc === 'bukti_bayar' ? 'Mengunggah...' : buktiBayarUrl ? 'Ganti Bukti Bayar' : 'Upload Bukti Bayar'}
                                            <input
                                                type="file"
                                                accept=".pdf,.jpg,.jpeg,.png"
                                                disabled={uploadingDoc === 'bukti_bayar' || isLocked}
                                                className="hidden"
                                                onChange={(e) => handleFileUpload(e, 'bukti_bayar')}
                                            />
                                        </label>
                                    )}
                                </div>

                                <div className="flex justify-between pt-4 border-t border-slate-100">
                                    <button onClick={() => setWizardStep(3)} className="px-5 py-2.5 border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-semibold rounded-lg transition">
                                        &lt; Kembali ke Berkas
                                    </button>
                                    <button
                                        onClick={() => handleSaveStep(null)}
                                        disabled={loading || isLocked}
                                        className={`px-6 py-2.5 text-sm font-extrabold rounded-lg transition shadow-md ${
                                            isLocked
                                                ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                                                : 'bg-amber-400 hover:bg-amber-300 text-[#06315b]'
                                        }`}
                                    >
                                        {loading
                                            ? 'Memproses...'
                                            : isRejected
                                            ? '🔄 Kirim Ulang Perbaikan Berkas ✓'
                                            : isLocked
                                            ? '🔒 Pendaftaran Telah Dikirim'
                                            : '🚀 Selesai & Kirim Pendaftaran ✓'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* SIDEBAR KARTU PROFIL */}
                    <div className="lg:col-span-1">
                        <div className="bg-white rounded-2xl shadow-md border-t-4 border-[#06315b] p-6 text-center">
                            {uploadedDocs['pasfoto'] ? (
                                <img src={uploadedDocs['pasfoto'].file_path} alt="Foto Profil" className="w-24 h-24 rounded-full object-cover mx-auto mb-3 border-4 border-amber-400 shadow" />
                            ) : (
                                <div className="flex justify-center mb-3">
                                    <KDJLogoSquare size="lg" />
                                </div>
                            )}

                            <div className="text-xs font-extrabold text-[#06315b] mb-1">{progress}% Complete</div>
                            <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden mb-3">
                                <div className="bg-amber-400 h-full transition-all duration-300" style={{ width: `${progress}%` }} />
                            </div>

                            <h3 className="font-extrabold text-[#06315b] text-sm truncate">
                                {formData.nama_lengkap || 'Calon Mahasiswa KDJ'}
                            </h3>
                            <p className="text-xs text-slate-500 mb-5 font-mono">{user.no_wa}</p>

                            <div className="border-t border-slate-100 pt-4 text-left space-y-3 text-xs">
                                <div className="flex justify-between">
                                    <span className="text-slate-400">ID Type</span>
                                    <span className="font-bold text-slate-700">Passport</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-400">No. Paspor</span>
                                    <span className="font-bold text-slate-700">{formData.no_paspor || '-'}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-400">Tgl Lahir</span>
                                    <span className="font-bold text-slate-700">{formData.tanggal_lahir || '-'}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-400">Gender</span>
                                    <span className="font-bold text-slate-700">{formData.jenis_kelamin}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-400">Kampus</span>
                                    <span className="font-bold text-[#06315b] truncate max-w-[130px]">{formData.pilihan_kampus}</span>
                                </div>
                                <div className="flex justify-between items-center pt-1">
                                    <span className="text-slate-400">Status Berkas</span>
                                    <span className={`px-2.5 py-1 rounded font-extrabold uppercase text-[10px] ${
                                        isApproved ? 'bg-emerald-200 text-emerald-900' :
                                        isRejected ? 'bg-red-200 text-red-900' :
                                        'bg-amber-400 text-[#06315b]'
                                    }`}>
                                        {user.status_pendaftaran?.replace('_', ' ') || 'Leads Baru'}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center pt-1">
                                    <span className="text-slate-400">Pembayaran</span>
                                    <span className={`px-2 py-0.5 rounded font-bold uppercase text-[10px] ${
                                        user.status_pembayaran === 'Lunas' ? 'bg-emerald-100 text-emerald-800' :
                                        user.status_pembayaran === 'Menunggu Verifikasi' ? 'bg-amber-100 text-amber-800' :
                                        'bg-slate-100 text-slate-600'
                                    }`}>
                                        {user.status_pembayaran || 'Belum Bayar'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                </div>
            </div>
        );
    }

    // ================= TAMPILAN LOGIN MAHASISWA =================
    return (
        <div className="min-h-screen flex flex-col bg-[#06315b]">
            <OfficialHeader
                rightAction={
                    <a href="/admin" className="text-xs text-amber-400 hover:underline font-semibold">
                        Login Admin &rarr;
                    </a>
                }
            />

            <main className="flex-1 flex flex-col items-center justify-center p-6 relative">
                <div className="text-center max-w-2xl mb-8 text-white">
                    <div className="w-16 h-0.5 bg-amber-400 mx-auto mb-4" />
                    <h1 className="text-xl sm:text-2xl font-extrabold uppercase tracking-wide">
                        SELAMAT DATANG DI PORTAL RESMI KULIAHDIJORDAN
                    </h1>
                    <p className="text-xs sm:text-sm text-slate-200 mt-2 leading-relaxed">
                        Nikmati fasilitas pengurusan perkuliahan di Yordania dengan Mudah, Profesional, dan Sesuai Syariat dengan Jaminan 100% diterima di kampus Yordania.
                    </p>
                </div>

                <div className="w-full max-w-md bg-white text-slate-800 rounded-2xl p-8 shadow-2xl border-t-8 border-amber-400">
                    <div className="flex flex-col items-center text-center mb-6">
                        <KDJLogoSquare size="lg" />
                        <h2 className="text-lg font-extrabold text-[#06315b] mt-3">
                            Login / Pendaftaran Mahasiswa
                        </h2>
                        <p className="text-slate-500 text-xs mt-0.5">
                            Masukkan nomor WhatsApp aktif untuk menerima kode OTP
                        </p>
                    </div>

                    {message && (
                        <div className="mb-4 p-3 rounded-lg text-xs font-semibold bg-slate-100 border border-slate-300 text-[#06315b] text-center">
                            {message}
                        </div>
                    )}

                    {authStep === 1 ? (
                        <form onSubmit={handleRequestOtp} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-[#06315b] mb-1">
                                    Nomor WhatsApp (Format 08xx)
                                </label>
                                <input
                                    type="text"
                                    required
                                    placeholder="Contoh: 085156203449"
                                    value={phone}
                                    onChange={(e) => setPhone(e.target.value)}
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:outline-none focus:border-[#06315b]"
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full py-3 bg-amber-400 hover:bg-amber-300 text-[#06315b] font-extrabold rounded-xl text-sm transition shadow-md"
                            >
                                {loading ? 'Mengirim OTP...' : 'Kirim Kode OTP via WhatsApp'}
                            </button>
                        </form>
                    ) : (
                        <form onSubmit={handleVerifyOtp} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-[#06315b] mb-1 text-center">
                                    Masukkan 6 Digit Kode OTP
                                </label>
                                <input
                                    type="text"
                                    required
                                    maxLength={6}
                                    placeholder="123456"
                                    value={otp}
                                    onChange={(e) => setOtp(e.target.value)}
                                    className="w-full text-center tracking-widest text-2xl font-bold px-4 py-3 bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:border-[#06315b]"
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full py-3 bg-[#06315b] hover:bg-[#042444] text-amber-400 font-extrabold rounded-xl text-sm transition shadow-md"
                            >
                                {loading ? 'Memverifikasi...' : 'Verifikasi & Masuk Portal'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setAuthStep(1)}
                                className="w-full py-1.5 text-xs text-slate-500 hover:text-[#06315b] font-semibold"
                            >
                                &larr; Ganti Nomor WhatsApp
                            </button>
                        </form>
                    )}
                </div>
            </main>

            <div className="h-4 bg-amber-400 w-full" />
        </div>
    );
    const renderStatusBadge = (status) => {
  switch (status) {
    case 'Approved':
      return <span className="px-3 py-1 rounded-full text-xs font-bold bg-green-100 text-green-800">✅ Approved</span>;
    case 'Rejected':
      return <span className="px-3 py-1 rounded-full text-xs font-bold bg-red-100 text-red-800">❌ Perlu Revisi</span>;
    case 'Revisi Diajukan':
      return <span className="px-3 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-800 animate-pulse">🔄 Revisi Masuk</span>;
    case 'Submitted':
      return <span className="px-3 py-1 rounded-full text-xs font-bold bg-yellow-100 text-yellow-800">⏳ Baru Masuk</span>;
    default:
      return <span className="px-3 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-600">📝 Draft</span>;
  }
};
}