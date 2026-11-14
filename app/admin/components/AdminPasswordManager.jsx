'use client';

import { useState } from 'react';

export default function AdminPasswordManager({
  required = false,
  onComplete = () => {}
}) {
  const [isOpen, setIsOpen] = useState(required);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const resetForm = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setMessage('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setMessage('');

    if (newPassword.length < 14) {
      setMessage('Password baru minimal 14 karakter.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage('Konfirmasi password baru tidak sama.');
      return;
    }

    setBusy(true);
    try {
      const response = await fetch('/api/admin/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
          confirm_password: confirmPassword
        })
      });
      const result = await response.json().catch(() => null);

      if (!response.ok || !result?.success) {
        throw new Error(result?.message || 'Gagal mengubah password.');
      }

      resetForm();
      onComplete(result.admin);
      if (!required) setIsOpen(false);
    } catch (error) {
      setMessage(error?.message || 'Terjadi kesalahan jaringan.');
    } finally {
      setBusy(false);
    }
  };

  const form = (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="mb-1 block text-xs font-bold text-[#06315b]">Password saat ini</label>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm focus:border-[#06315b] focus:outline-none"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-bold text-[#06315b]">Password baru</label>
        <input
          type="password"
          required
          minLength={14}
          maxLength={128}
          autoComplete="new-password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm focus:border-[#06315b] focus:outline-none"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-bold text-[#06315b]">Konfirmasi password baru</label>
        <input
          type="password"
          required
          minLength={14}
          maxLength={128}
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm focus:border-[#06315b] focus:outline-none"
        />
      </div>
      <p className="text-[11px] leading-relaxed text-slate-500">
        Gunakan minimal 14 karakter. Sebaiknya buat password unik dan simpan di password manager.
      </p>
      {message && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
          {message}
        </div>
      )}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-xl bg-amber-400 px-4 py-3 text-sm font-extrabold text-[#06315b] transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? 'Menyimpan password...' : 'Simpan Password Baru'}
      </button>
    </form>
  );

  if (required) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#06315b] p-4">
        <section className="w-full max-w-md rounded-2xl border-t-8 border-amber-400 bg-white p-6 text-slate-800 shadow-2xl sm:p-8">
          <p className="mb-2 text-center text-[10px] font-extrabold uppercase tracking-wider text-amber-600">
            KDJ Admin Security
          </p>
          <h1 className="mb-2 text-center text-xl font-extrabold text-[#06315b]">
            Ganti Password Awal
          </h1>
          <p className="mb-6 text-center text-xs leading-relaxed text-slate-500">
            Sebelum masuk ke Dashboard Admin, ganti password sementara dengan password pribadi yang baru.
          </p>
          {form}
        </section>
      </main>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          resetForm();
          setIsOpen(true);
        }}
        className="rounded-lg border border-amber-300 px-4 py-2 text-xs font-bold text-amber-300 transition hover:bg-[#0a3f73]"
      >
        Ganti Password
      </button>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-password-title"
            className="my-auto w-full max-w-md rounded-2xl border-t-8 border-amber-400 bg-white p-6 text-slate-800 shadow-2xl"
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 id="admin-password-title" className="text-lg font-extrabold text-[#06315b]">
                  Ubah Password Admin
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Masukkan password saat ini untuk mengonfirmasi perubahan.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  resetForm();
                  setIsOpen(false);
                }}
                className="rounded-lg px-2 py-1 text-lg font-bold text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Tutup"
              >
                ×
              </button>
            </div>
            {form}
          </section>
        </div>
      )}
    </>
  );
}
