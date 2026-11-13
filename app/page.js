'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

// Komponen Logo Header Navbar (Auto-crop ruang kosong putih agar tampil besar & proporsional)
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
    const [countdownNow, setCountdownNow] = useState(0);
    const [uploadedDocs, setUploadedDocs] = useState({});
    const [buktiBayarUrl, setBuktiBayarUrl] = useState('');
    const [isUnlockedManually, setIsUnlockedManually] = useState(false);
    const [followupConsent, setFollowupConsent] = useState(false);
    const [savingFollowupConsent, setSavingFollowupConsent] = useState(false);
    const [followupConsentMessage, setFollowupConsentMessage] = useState('');

    const [formData, setFormData] = useState({
        nama_lengkap: '',
        nama_orang_tua_wali: '',
        no_wa_orang_tua_wali: '',
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

    const fetchUploadedDocs = async (userPhone) => {
    try {
      const res = await fetch(`/api/upload-dokumen?no_wa=${encodeURIComponent(userPhone)}`);
      if (res.status === 401 || res.status === 403) {
        localStorage.removeItem('kdj_user');
        setUser(null);
        setFollowupConsent(false);
        setFollowupConsentMessage('');
        setAuthStep(1);
        return;
      }

      // Amankan pembacaan JSON dengan .catch() agar tidak crash jika server error 500
      const data = await res.json().catch(() => null);
      if (!data) {
        console.error('Server mengembalikan respons kosong atau error.');
        return;
      }

      if (data.success) {
        if (data.documents) {
          const mapDocs = {};
          data.documents.forEach((d) => {
            mapDocs[d.jenis_dokumen] = d;
          });
          setUploadedDocs(mapDocs);
        }
        // ... sisa kode selanjutnya ...
                // Sinkronkan status terbaru pendaftar dari database
                if (data.pendaftar) {
                    setBuktiBayarUrl(data.pendaftar.bukti_bayar_url || '');
                    setUser((prev) => {
                        const updatedUser = {
                            ...prev,
                            ...data.pendaftar,
                            registration_payment: data.registration_payment || null,
                            payment_server_now: data.server_now || null,
                            student_progress: data.student_progress || null,
                            student_progress_documents: data.student_progress_documents || []
                        };
                        localStorage.setItem('kdj_user', JSON.stringify(updatedUser));
                        return updatedUser;
                    });

                    // Isi formData jika sebelumnya masih kosong tetapi di DB sudah ada
                    setFormData((prev) => ({
                        nama_lengkap: prev.nama_lengkap || data.pendaftar.nama_lengkap || '',
                        nama_orang_tua_wali: prev.nama_orang_tua_wali || data.pendaftar.nama_orang_tua_wali || '',
                        no_wa_orang_tua_wali: prev.no_wa_orang_tua_wali || data.pendaftar.no_wa_orang_tua_wali || '',
                        tempat_lahir: prev.tempat_lahir || data.pendaftar.tempat_lahir || '',
                        tanggal_lahir: prev.tanggal_lahir || data.pendaftar.tanggal_lahir || '',
                        jenis_kelamin: prev.jenis_kelamin || data.pendaftar.jenis_kelamin || 'Laki-laki',
                        no_paspor: prev.no_paspor || data.pendaftar.no_paspor || '',
                        alamat_lengkap: prev.alamat_lengkap || data.pendaftar.alamat_lengkap || '',
                        asal_sekolah: prev.asal_sekolah || data.pendaftar.asal_sekolah || '',
                        tahun_lulus: prev.tahun_lulus || data.pendaftar.tahun_lulus || '',
                        pilihan_kampus: prev.pilihan_kampus || data.pendaftar.pilihan_kampus || 'University of Jordan',
                        pilihan_jurusan: prev.pilihan_jurusan || data.pendaftar.pilihan_jurusan || 'Syariah / Ushuluddin'
                    }));

                    const st = (data.pendaftar.status_pendaftaran || '').toLowerCase();
                    if (st === 'rejected') {
                        setWizardStep(4);
                    }
                }
            }
        } catch (err) {
            console.error('Gagal memuat dokumen:', err);
        }
    };

    useEffect(() => {
    const savedUser = localStorage.getItem('kdj_user');
    if (!savedUser) return;

    let parsed;

    try {
        parsed = JSON.parse(savedUser);
    } catch (error) {
        console.error('Gagal membaca sesi user:', error);
        localStorage.removeItem('kdj_user');
        return;
    }

    let cancelled = false;

    queueMicrotask(() => {
        if (cancelled) return;

        setUser(parsed);
        setBuktiBayarUrl(parsed.bukti_bayar_url || '');

        setFormData({
            nama_lengkap: parsed.nama_lengkap || '',
            nama_orang_tua_wali: parsed.nama_orang_tua_wali || '',
            no_wa_orang_tua_wali: parsed.no_wa_orang_tua_wali || '',
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

        if (parsed.no_wa) {
            void fetchUploadedDocs(parsed.no_wa);
        }
    });

    return () => {
        cancelled = true;
    };
}, []);

    useEffect(() => {
        if (!user?.registration_payment?.deadline_at) return undefined;

        const timer = window.setInterval(() => setCountdownNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [user?.registration_payment?.deadline_at]);

    useEffect(() => {
        if (!user?.no_wa) return;

        let active = true;
        fetch('/api/followups/consent', { cache: 'no-store' })
            .then((response) => response.json().catch(() => null))
            .then((result) => {
                if (active && result?.success) setFollowupConsent(result.consented === true);
            })
            .catch(() => {});

        return () => { active = false; };
    }, [user?.no_wa]);

    const handleFollowupConsentChange = async (nextValue) => {
        setSavingFollowupConsent(true);
        setFollowupConsentMessage('');
        try {
            const response = await fetch('/api/followups/consent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ consented: nextValue })
            });
            const result = await response.json().catch(() => null);
            if (!response.ok || !result?.success) {
                throw new Error(result?.message || 'Persetujuan belum dapat disimpan.');
            }
            setFollowupConsent(nextValue);
            setFollowupConsentMessage(result.message || 'Pengaturan persetujuan tersimpan.');
        } catch (error) {
            setFollowupConsentMessage(error.message || 'Persetujuan belum dapat disimpan.');
        } finally {
            setSavingFollowupConsent(false);
        }
    };

    const calculateProgress = () => {
        const fields = [
            formData.nama_lengkap, formData.tempat_lahir, formData.tanggal_lahir,
            formData.alamat_lengkap, formData.asal_sekolah,
            formData.tahun_lulus, formData.pilihan_kampus, formData.pilihan_jurusan,
            uploadedDocs['pasfoto'], uploadedDocs['ijazah'], uploadedDocs['transkrip'],
            uploadedDocs['akta_kelahiran'], buktiBayarUrl
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
                    nama_orang_tua_wali: data.user.nama_orang_tua_wali || '',
                    no_wa_orang_tua_wali: data.user.no_wa_orang_tua_wali || '',
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
        const hasPaidRegistration = user?.registration_payment?.status === 'PAID'
            || user?.status_pembayaran === 'Lunas';
        const hasLegacyPaymentWorkflow = Boolean(user?.bukti_bayar_url)
            || ['Menunggu Verifikasi', 'Ditolak'].includes(user?.status_pembayaran);
        const isInitialSubmit = nextStep === 3
            && !user?.registration_payment?.id
            && !hasPaidRegistration
            && !hasLegacyPaymentWorkflow;

        if (isInitialSubmit) {
            const requiredInitialFields = [
                'nama_lengkap', 'tempat_lahir', 'tanggal_lahir', 'jenis_kelamin',
                'alamat_lengkap', 'asal_sekolah', 'tahun_lulus',
                'pilihan_kampus', 'pilihan_jurusan'
            ];
            const missingInitialFields = requiredInitialFields.filter((field) => (
                formData[field] === null
                || formData[field] === undefined
                || String(formData[field]).trim() === ''
            ));
            if (missingInitialFields.length > 0) {
                alert('Lengkapi data diri, asal sekolah, tahun lulus, kampus, dan jurusan sebelum membuat tagihan.');
                setWizardStep(1);
                return;
            }
        }

        // Final submit hanya untuk berkas akademik setelah pembayaran PAID.
        if (isFinalSubmit) {
            if (!hasPaidRegistration) {
                alert('Pembayaran harus dikonfirmasi Lunas oleh Admin sebelum upload dan submit berkas.');
                setWizardStep(3);
                return;
            }
            const requiredDocs = ['pasfoto', 'ijazah', 'transkrip', 'akta_kelahiran'];
            const missingDocs = requiredDocs.filter((doc) => !uploadedDocs[doc]);
            if (missingDocs.length > 0) {
                alert(`Mohon lengkapi dokumen wajib di Step 4 terlebih dahulu: ${missingDocs.join(', ').toUpperCase()}`);
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
                    is_initial_submit: isInitialSubmit,
                    is_final_submit: isFinalSubmit,
                    is_revision: isRevision
                })
            });

            const data = await res.json();
            if (data.success) {
                // Jangan kunci status pendaftaran jika baru simpan per-step (belum Final Submit)
                const safeStatus = isFinalSubmit
                    ? (isRevision ? 'Revisi Diajukan' : (data.user?.status_pendaftaran || 'Submitted'))
                    : isInitialSubmit
                        ? (data.user?.status_pendaftaran || 'draft_berkas')
                        : (isRevision ? 'Rejected' : 'Draft');

                const updatedUser = {
                    ...user,
                    ...formData,
                    ...(data.user || {}),
                    ...(data.payment ? { registration_payment: data.payment } : {}),
                    status_pendaftaran: safeStatus
                };

                setUser(updatedUser);
                localStorage.setItem('kdj_user', JSON.stringify(updatedUser));


if (nextStep) {
    setWizardStep(nextStep);
} else {
    setIsUnlockedManually(false);

    const notifInfo = data.wa_notified
        ? 'Notifikasi konfirmasi telah dikirim ke WhatsApp Anda.'
        : 'Data Anda telah tercatat di sistem (notifikasi WhatsApp sedang dalam antrean).';

    alert(
        isRevision
            ? `Perbaikan berkas berhasil dikirim ulang! ${notifInfo}`
            : `Pendaftaran & Bukti Pembayaran selesai dikirim! ${notifInfo}`
    );
}

            } else {
                alert('❌ Gagal menyimpan: ' + data.message);
            }
        } catch {
            alert('❌ Terjadi kesalahan saat menyimpan data.');
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
                        status_pembayaran: 'Menunggu Verifikasi',
                        registration_payment: user.registration_payment
                            ? { ...user.registration_payment, status: 'PROOF_SUBMITTED' }
                            : user.registration_payment
                    };
                    setUser(updatedUser);
                    localStorage.setItem('kdj_user', JSON.stringify(updatedUser));
                    await fetchUploadedDocs(user.no_wa);
                    alert('✅ Bukti transfer pembayaran berhasil diunggah dan menunggu pemeriksaan Admin!');
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

    const handleLogout = async () => {
        try {
            await fetch('/api/auth/verify-otp', { method: 'DELETE' });
        } catch {}
        localStorage.removeItem('kdj_user');
        setUser(null);
        setFollowupConsent(false);
        setFollowupConsentMessage('');
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
        const isWaitingVerification =
            ['submitted', 'menunggu verifikasi', 'revisi diajukan', 'final_submit'].includes(normStatus) &&
            Boolean(buktiBayarUrl);

        // Form hanya dikunci jika sudah Approved, atau sedang Menunggu Verifikasi (dan tidak dibuka manual oleh user)
        const isLocked = isApproved || (isWaitingVerification && !isUnlockedManually);

        const persistedPaymentStatus = user?.registration_payment?.status
            || (user?.status_pembayaran === 'Lunas' ? 'PAID'
                : user?.status_pembayaran === 'Menunggu Verifikasi' ? 'PROOF_SUBMITTED'
                    : user?.status_pembayaran === 'Ditolak' ? 'REVISION_REQUIRED'
                        : 'PENDING_PAYMENT');
        const deadlineMs = Date.parse(user?.registration_payment?.deadline_at || '');
        const deadlineExpired = Number.isFinite(deadlineMs)
            && countdownNow > 0
            && deadlineMs <= countdownNow;
        const paymentStatus = deadlineExpired
            && ['PENDING_PAYMENT', 'REOPENED', 'REVISION_REQUIRED'].includes(persistedPaymentStatus)
                ? 'EXPIRED'
                : persistedPaymentStatus;
        const paymentRemainingMs = Number.isFinite(deadlineMs) && countdownNow > 0
            ? Math.max(0, deadlineMs - countdownNow)
            : null;
        const paymentCountdown = paymentRemainingMs === null
            ? null
            : [
                Math.floor(paymentRemainingMs / 3600000),
                Math.floor((paymentRemainingMs % 3600000) / 60000),
                Math.floor((paymentRemainingMs % 60000) / 1000)
            ].map((value) => String(value).padStart(2, '0')).join(':');
        const paymentStatusLabel = ({
            PENDING_PAYMENT: 'Menunggu Pembayaran',
            PROOF_SUBMITTED: 'Menunggu Verifikasi Admin',
            REVISION_REQUIRED: 'Bukti Pembayaran Perlu Revisi',
            PAID: 'Lunas',
            EXPIRED: 'Kedaluwarsa',
            REOPENED: 'Tagihan Dibuka Kembali'
        })[paymentStatus] || 'Belum Ada Tagihan';
        const hasPaidRegistration = paymentStatus === 'PAID';

        const inputClass =
            'w-full px-3.5 py-2.5 bg-white text-slate-900 placeholder:text-slate-400 disabled:bg-slate-100 disabled:text-slate-500 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-[#06315b] focus:ring-1 focus:ring-[#06315b]';

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
                            <div className="mb-8 p-5 bg-amber-50 border-l-4 border-amber-400 rounded-r-xl shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                <div>
                                    <h3 className="text-[#06315b] font-extrabold text-base flex items-center gap-2">
                                        ⏳ Pendaftaran Sedang Diverifikasi Tim Admin
                                    </h3>
                                    <p className="text-slate-600 mt-1 text-xs leading-relaxed">
                                        {isUnlockedManually
                                            ? 'Mode edit aktif. Jangan lupa klik simpan setelah memperbarui data Anda.'
                                            : 'Formulir dan dokumen Anda saat ini dikunci sementara karena sedang dalam antrean pemeriksaan.'}
                                    </p>
                                </div>
                                {!isUnlockedManually && (
                                    <button
                                        type="button"
                                        onClick={() => setIsUnlockedManually(true)}
                                        className="px-3.5 py-2 bg-white hover:bg-slate-100 text-[#06315b] border border-amber-400 rounded-lg text-xs font-bold shrink-0 shadow-sm transition"
                                    >
                                        ✏️ Edit Data / Berkas
                                    </button>
                                )}
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
                                { num: 3, label: 'Pembayaran' },
                                { num: 4, label: 'Upload Berkas' }
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

                        {user.status_pendaftaran === 'Approved' && (
                            <section className="mb-8 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 sm:p-5 space-y-4">
                                <div>
                                    <h2 className="text-base font-extrabold text-[#06315b]">Perkembangan Pendaftaran & Keberangkatan</h2>
                                    <p className="mt-1 text-xs text-slate-600">Pantau proses setelah berkas akademik disetujui. Dokumen perjalanan akan tersedia satu per satu sesuai penerbitannya.</p>
                                </div>

                                <div className="rounded-lg border border-emerald-200 bg-white p-3">
                                    <p className="text-[11px] uppercase font-bold text-slate-500">Tahap utama saat ini</p>
                                    <p className="mt-1 text-sm font-extrabold text-emerald-800">
                                        {({
                                            TRANSLATION_AND_CAMPUS_REGISTRATION: 'Proses Penerjemahan & Pendaftaran ke Kampus Tujuan',
                                            WAITING_DEPARTURE: 'Menunggu Keberangkatan',
                                            DEPARTED: 'Sudah Berangkat'
                                        })[user.student_progress?.progress_status] || 'Proses Penerjemahan & Pendaftaran ke Kampus Tujuan'}
                                    </p>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {[
                                        { type: 'SUKETMAH', label: 'Suketmah' },
                                        { type: 'LOA', label: 'Letter of Acceptance (LOA)' },
                                        { type: 'VISA', label: 'Visa' },
                                        { type: 'TICKET', label: 'Tiket Keberangkatan' }
                                    ].map((item) => {
                                        const document = (user.student_progress_documents || []).find((entry) => entry.document_type === item.type);
                                        return (
                                            <div key={item.type} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3">
                                                <div className="min-w-0">
                                                    <p className="text-xs font-bold text-slate-800">{item.label}</p>
                                                    <p className="mt-1 text-[11px] text-slate-500">
                                                        {document ? `Tersedia · versi ${document.version_no}` : 'Belum tersedia'}
                                                    </p>
                                                </div>
                                                {document?.download_url ? (
                                                    <a
                                                        href={document.download_url}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="shrink-0 rounded-md bg-[#06315b] px-3 py-2 text-[11px] font-bold text-white"
                                                    >
                                                        Download
                                                    </a>
                                                ) : (
                                                    <span className="shrink-0 text-[11px] font-semibold text-slate-400">Menunggu</span>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                                {user.student_progress?.updated_at && (
                                    <p className="text-[10px] text-slate-500">
                                        Pembaruan terakhir: {new Date(user.student_progress.updated_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB
                                    </p>
                                )}
                            </section>
                        )}

                        {/* STEP 1: DATA DIRI */}
                        {wizardStep === 1 && (
                            <div className="space-y-6">
                                <div className="border-l-4 border-[#06315b] pl-3">
                                    <h2 className="text-base font-bold text-[#06315b]">
                                        1. Personal Data (Data Diri Calon Mahasiswa)
                                    </h2>
                                    <p className="text-xs text-slate-500">Isi identitas diri sesuai dengan Paspor atau KTP resmi.</p>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">Nama Lengkap (Sesuai Paspor) <span className="text-red-500">*</span></label>
                                        <input
                                            type="text"
                                            disabled={isLocked}
                                            value={formData.nama_lengkap}
                                            onChange={(e) => setFormData({ ...formData, nama_lengkap: e.target.value })}
                                            placeholder="Masukkan nama lengkap"
                                            className={inputClass}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">Jenis Kelamin <span className="text-red-500">*</span></label>
                                        <select
                                            disabled={isLocked}
                                            value={formData.jenis_kelamin}
                                            onChange={(e) => setFormData({ ...formData, jenis_kelamin: e.target.value })}
                                            className={inputClass}
                                        >
                                            <option value="Laki-laki">Laki-laki (Male)</option>
                                            <option value="Perempuan">Perempuan (Female)</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">Tempat Lahir <span className="text-red-500">*</span></label>
                                        <input
                                            type="text"
                                            disabled={isLocked}
                                            value={formData.tempat_lahir}
                                            onChange={(e) => setFormData({ ...formData, tempat_lahir: e.target.value })}
                                            placeholder="Contoh: Semarang"
                                            className={inputClass}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">Tanggal Lahir <span className="text-red-500">*</span></label>
                                        <input
                                            type="date"
                                            disabled={isLocked}
                                            value={formData.tanggal_lahir}
                                            onChange={(e) => setFormData({ ...formData, tanggal_lahir: e.target.value })}
                                            className={inputClass}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">Nomor Paspor (opsional; lengkapi melalui Admin Human setelah pendaftaran, paling lambat H-45)</label>
                                        <input
                                            type="text"
                                            disabled={isLocked}
                                            value={formData.no_paspor}
                                            onChange={(e) => setFormData({ ...formData, no_paspor: e.target.value })}
                                            placeholder="Contoh: X1234567"
                                            className={inputClass}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">Nomor WhatsApp Terdaftar</label>
                                        <input
                                            type="text"
                                            disabled
                                            value={user.no_wa || ''}
                                            className="w-full px-3.5 py-2.5 bg-slate-100 border border-slate-200 rounded-lg text-sm text-slate-500 font-mono"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">Nama Orang Tua/Wali (Opsional)</label>
                                        <input
                                            type="text"
                                            maxLength={150}
                                            disabled={isLocked}
                                            value={formData.nama_orang_tua_wali}
                                            onChange={(e) => setFormData({ ...formData, nama_orang_tua_wali: e.target.value })}
                                            placeholder="Masukkan nama orang tua/wali"
                                            className={inputClass}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">Nomor WhatsApp Orang Tua/Wali (Opsional)</label>
                                        <input
                                            type="tel"
                                            inputMode="tel"
                                            autoComplete="tel"
                                            maxLength={20}
                                            disabled={isLocked}
                                            value={formData.no_wa_orang_tua_wali}
                                            onChange={(e) => setFormData({ ...formData, no_wa_orang_tua_wali: e.target.value })}
                                            placeholder="08xxxxxxxxxx atau +62xxxxxxxxxx"
                                            className={inputClass}
                                        />
                                        <p className="text-[10px] text-slate-500 mt-1">Nomor akan disimpan dalam format 08xxxxxxxxxx.</p>
                                    </div>
                                    <div className="md:col-span-2">
                                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">Alamat Lengkap Domisili <span className="text-red-500">*</span></label>
                                        <textarea
                                            rows={2}
                                            disabled={isLocked}
                                            value={formData.alamat_lengkap}
                                            onChange={(e) => setFormData({ ...formData, alamat_lengkap: e.target.value })}
                                            placeholder="Nama jalan, kecamatan, kabupaten/kota, provinsi..."
                                            className={inputClass}
                                        />
                                    </div>
                                </div>

                                <div className="flex justify-end pt-4 border-t border-slate-100">
                                    {isLocked ? (
                                        <button type="button" onClick={() => setWizardStep(2)} className="px-6 py-2.5 bg-[#06315b] text-amber-400 text-sm font-bold rounded-lg transition shadow">
                                            Lanjut ke Step 2 &rarr;
                                        </button>
                                    ) : (
                                        <button type="button" onClick={() => handleSaveStep(2)} disabled={loading} className="px-6 py-2.5 bg-[#06315b] hover:bg-[#042444] text-amber-400 text-sm font-bold rounded-lg transition shadow">
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
                                        <input
                                            type="text"
                                            disabled={isLocked}
                                            value={formData.asal_sekolah}
                                            onChange={(e) => setFormData({ ...formData, asal_sekolah: e.target.value })}
                                            placeholder="Contoh: MA Al-Irsyad / SMA Negeri 1"
                                            className={inputClass}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">Tahun Kelulusan <span className="text-red-500">*</span></label>
                                        <input
                                            type="number"
                                            disabled={isLocked}
                                            value={formData.tahun_lulus}
                                            onChange={(e) => setFormData({ ...formData, tahun_lulus: e.target.value })}
                                            placeholder="Contoh: 2026"
                                            className={inputClass}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">Pilihan Universitas di Yordania <span className="text-red-500">*</span></label>
                                        <select
                                            disabled={isLocked}
                                            value={formData.pilihan_kampus}
                                            onChange={(e) => setFormData({ ...formData, pilihan_kampus: e.target.value })}
                                            className={inputClass}
                                        >
                                            <option value="University of Jordan">University of Jordan (Amman)</option>
                                            <option value="Yarmouk University">Yarmouk University (Irbid)</option>
                                            <option value="Mutah University">Mu&apos;tah University (Karak)</option>
                                            <option value="WISE">WISE</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">Pilihan Jurusan <span className="text-red-500">*</span></label>
                                        <select
                                            disabled={isLocked}
                                            value={formData.pilihan_jurusan}
                                            onChange={(e) => setFormData({ ...formData, pilihan_jurusan: e.target.value })}
                                            className={inputClass}
                                        >
                                            <option value="Syariah / Ushuluddin">Syariah / Ushuluddin</option>
                                            <option value="Ekonomi Syariah">Ekonomi Syariah</option>
                                            <option value="Bahasa & Sastra Arab">Bahasa & Sastra Arab</option>
                                            <option value="Fiqh wa Ushuluhu">Fiqh wa Ushuluhu</option>
                                            <option value="Syariah">Syariah</option>
                                            <option value="Aqidah">Aqidah</option>
                                        </select>
                                    </div>
                                </div>

                                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                                    <label className="flex items-start gap-3 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={followupConsent}
                                            disabled={savingFollowupConsent}
                                            onChange={(event) => void handleFollowupConsentChange(event.target.checked)}
                                            className="mt-0.5 h-4 w-4 accent-[#06315b]"
                                        />
                                        <span className="text-xs leading-relaxed text-slate-700">
                                            Saya bersedia menerima pesan tindak lanjut terkait pertanyaan, konsultasi, atau proses pendaftaran KDJ melalui WhatsApp. Saya dapat menarik persetujuan kapan saja.
                                            <span className="block text-[10px] text-slate-500 mt-1">Opsional. Tidak dicentang secara default dan tidak memengaruhi proses pendaftaran.</span>
                                        </span>
                                    </label>
                                    {savingFollowupConsent && <p className="text-[10px] text-slate-500">Menyimpan persetujuan...</p>}
                                    {followupConsentMessage && <p role="status" className="text-[10px] text-slate-600">{followupConsentMessage}</p>}
                                </div>

                                <div className="flex justify-between pt-4 border-t border-slate-100">
                                    <button type="button" onClick={() => setWizardStep(1)} className="px-5 py-2.5 border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-semibold rounded-lg transition">
                                        &lt; Kembali
                                    </button>
                                    {isLocked ? (
                                        <button type="button" onClick={() => setWizardStep(3)} className="px-6 py-2.5 bg-[#06315b] text-amber-400 text-sm font-bold rounded-lg transition shadow">
                                            Lanjut ke Step 3 &rarr;
                                        </button>
                                    ) : (
                                        <button type="button" onClick={() => handleSaveStep(3)} disabled={loading} className="px-6 py-2.5 bg-[#06315b] hover:bg-[#042444] text-amber-400 text-sm font-bold rounded-lg transition shadow">
                                            {loading ? 'Menyimpan...' : 'Simpan & Lanjut (Next) >'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* STEP 4: UPLOAD BERKAS (AFTER PAYMENT CONFIRMED) */}
                        {wizardStep === 4 && (
                            <div className="space-y-6">
                                <div className="border-l-4 border-[#06315b] pl-3">
                                    <h2 className="text-base font-bold text-[#06315b]">4. Unggah Dokumen Persyaratan (Attachments)</h2>
                                    <p className="text-xs text-slate-500">Unggah berkas awal dalam format PDF, JPG, atau PNG (maks. 5 MB). Akta Kelahiran wajib diunggah saat pendaftaran awal. Dokumen paspor tidak diunggah melalui Portal dan tidak boleh dikirim ke WhatsApp Bot. Setelah pendaftaran, kirim langsung ke WhatsApp pribadi Admin Human menggunakan nomor yang diberikan langsung oleh Admin Human, paling lambat H-45 sebelum keberangkatan.</p>
                                </div>

                                <div className="space-y-4">
                                    {[
                                        { id: 'pasfoto', title: 'Pasfoto Resmi (4x6 Latar Putih)', req: 'Wajib' },
                                        { id: 'ijazah', title: 'Ijazah SMA / MA / Pesantren Sederajat', req: 'Wajib' },
                                        { id: 'transkrip', title: 'Transkrip Nilai / SKHUN', req: 'Wajib' },
                                        { id: 'akta_kelahiran', title: 'Scan Akta Kelahiran', req: 'Wajib saat pendaftaran' }
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
                                                            <Link href={uploaded.file_path} target="_blank" rel="noreferrer" className="text-xs text-[#06315b] font-semibold underline">
                                                                Lihat File
                                                            </Link>
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
                                    <button type="button" onClick={() => setWizardStep(3)} className="px-5 py-2.5 border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-semibold rounded-lg transition">
                                        &lt; Kembali ke Pembayaran
                                    </button>
                                    <button type="button" onClick={() => handleSaveStep(null)} disabled={loading || !((user?.registration_payment?.status === 'PAID') || user?.status_pembayaran === 'Lunas')} className="px-6 py-2.5 bg-[#06315b] hover:bg-[#042444] disabled:bg-slate-200 disabled:text-slate-500 text-amber-400 text-sm font-bold rounded-lg transition shadow">
                                        {loading ? 'Mengirim...' : 'Submit Berkas ke Admin'}
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* STEP 3: PEMBAYARAN ADMINISTRASI */}
                        {wizardStep === 3 && (
                            <div className="space-y-6">
                                <div className="border-l-4 border-[#06315b] pl-3">
                                    <h2 className="text-base font-bold text-[#06315b]">3. Pembayaran Biaya Pendaftaran & Administrasi</h2>
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
                                            hasPaidRegistration
                                                ? 'bg-emerald-200 text-emerald-900'
                                                : paymentStatus === 'REVISION_REQUIRED' || paymentStatus === 'EXPIRED'
                                                    ? 'bg-red-200 text-red-900'
                                                    : paymentStatus === 'PROOF_SUBMITTED'
                                                        ? 'bg-amber-200 text-amber-900'
                                                        : 'bg-slate-200 text-slate-700'
                                        }`}>
                                            {paymentStatusLabel}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center pt-1">
                                        <span className="text-sm font-bold text-slate-800">Total Nominal Tagihan</span>
                                        <span className="text-xl sm:text-2xl font-extrabold text-[#06315b]">
                                            Rp {Number(user.nominal_tagihan || 1500000).toLocaleString('id-ID')}
                                        </span>
                                    </div>
                                </div>

                                {user?.registration_payment?.deadline_at && ['PENDING_PAYMENT', 'REOPENED'].includes(paymentStatus) && (
                                    <div className={`p-4 border rounded-xl ${paymentRemainingMs === 0 ? 'border-red-300 bg-red-50' : 'border-amber-300 bg-amber-50'}`}>
                                        <div className="text-xs font-bold text-[#06315b]">Batas Pembayaran 24 Jam</div>
                                        <div className="text-2xl font-extrabold font-mono mt-1 text-[#06315b]">
                                            {paymentCountdown || 'Menghitung...'}
                                        </div>
                                        <p className="text-[11px] text-slate-600 mt-1">
                                            {paymentRemainingMs === 0
                                                ? 'Waktu pembayaran telah habis. Hubungi Admin jika ingin meminta pembukaan kembali tagihan.'
                                                : `Batas akhir: ${new Date(user.registration_payment.deadline_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB`}
                                        </p>
                                    </div>
                                )}

                                {paymentStatus === 'PROOF_SUBMITTED' && (
                                    <div className="p-4 border border-amber-200 bg-amber-50 rounded-xl text-xs text-amber-900">
                                        Bukti pembayaran telah diterima dan sedang menunggu pemeriksaan Admin. Jika dikirim sebelum batas waktu, bukti tetap dapat diperiksa meskipun proses verifikasi melewati 24 jam.
                                    </div>
                                )}

                                {paymentStatus === 'REVISION_REQUIRED' && (
                                    <div className="p-4 border border-red-200 bg-red-50 rounded-xl text-xs text-red-900">
                                        Bukti pembayaran perlu diperbaiki. Unggah ulang bukti pembayaran yang benar. Alasan revisi: {user.catatan_pembayaran || 'Silakan hubungi Admin.'}
                                    </div>
                                )}

                                {paymentStatus === 'EXPIRED' && (
                                    <div className="p-4 border border-red-200 bg-red-50 rounded-xl text-xs text-red-900">
                                        Batas pembayaran telah berakhir. Data pendaftaran Anda tetap tersimpan; hubungi Admin untuk meminta pembukaan kembali.
                                    </div>
                                )}

                                {hasPaidRegistration && (
                                    <div className="p-4 border border-emerald-200 bg-emerald-50 rounded-xl text-xs text-emerald-900">
                                        Pembayaran sudah dikonfirmasi Lunas. Akses upload berkas akademik telah dibuka.
                                    </div>
                                )}

                                {/* Rekening Tujuan */}
                                <div className="p-4 bg-amber-50/70 border border-amber-300 rounded-xl">
                                    <h4 className="text-xs font-extrabold uppercase tracking-wider text-[#06315b] mb-2">
                                        💳 Rekening Resmi Pembayaran KDJ
                                    </h4>
                                    <div className="space-y-1 text-xs sm:text-sm text-slate-700">
                                        <p>Bank Tujuan: <strong className="text-[#06315b]">Bank Syariah Indonesia (BSI)</strong></p>
                                        <p>Nomor Rekening: <strong className="font-mono text-base text-[#06315b] bg-white px-2 py-0.5 rounded border border-amber-200">7169735128</strong></p>
                                        <p>Atas Nama: <strong className="text-[#06315b]">Yayasan Generasi Cerdas Akhlakul Karimah</strong></p>
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
                                                <Link href={buktiBayarUrl} target="_blank" rel="noreferrer" className="text-xs text-[#06315b] font-semibold underline">
                                                    Lihat Bukti Transfer
                                                </Link>
                                            </div>
                                        ) : (
                                            <p className="text-xs text-slate-400 mt-0.5">Unggah struk / tangkapan layar bukti transfer (JPG/PNG/PDF, Maks. 5 MB)</p>
                                        )}
                                    </div>

                                    {!isLocked && !hasPaidRegistration && !['PROOF_SUBMITTED', 'EXPIRED'].includes(paymentStatus) && (
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
                                    <button type="button" onClick={() => setWizardStep(2)} className="px-5 py-2.5 border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-semibold rounded-lg transition">
                                        &lt; Kembali ke Data Kampus
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if ((user?.registration_payment?.status === 'PAID') || user?.status_pembayaran === 'Lunas') {
                                                setWizardStep(4);
                                            } else {
                                                alert('Upload berkas baru akan terbuka setelah Admin mengonfirmasi pembayaran Lunas.');
                                            }
                                        }}
                                        disabled={loading}
                                        className="px-6 py-2.5 text-sm font-extrabold rounded-lg transition shadow-md bg-amber-400 hover:bg-amber-300 text-[#06315b]"
                                    >
                                        {(user?.registration_payment?.status === 'PAID') || user?.status_pembayaran === 'Lunas'
                                            ? 'Lanjut ke Upload Berkas (Step 4)'
                                            : 'Menunggu Konfirmasi Pembayaran'}
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
                    <Link href="/admin" className="text-xs text-amber-400 hover:underline font-semibold">
                        Login Admin &rarr;
                    </Link>
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
                                    placeholder="Contoh: 0851xxxxxxxx"
                                    value={phone}
                                    onChange={(e) => setPhone(e.target.value)}
                                    className="w-full px-4 py-3 bg-slate-50 text-slate-900 placeholder:text-slate-400 border border-slate-300 rounded-xl text-sm focus:outline-none focus:border-[#06315b]"
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
                                    className="w-full text-center tracking-widest text-2xl font-bold px-4 py-3 bg-slate-50 text-slate-900 placeholder:text-slate-300 border border-slate-300 rounded-xl focus:outline-none focus:border-[#06315b]"
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
}