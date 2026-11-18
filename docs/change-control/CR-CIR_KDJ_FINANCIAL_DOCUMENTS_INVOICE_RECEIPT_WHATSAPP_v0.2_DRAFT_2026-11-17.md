# KDJ Change Request & Change-Impact Review
## CR-CIR-KDJ-FIN-DOC-2026-11-17-01 — v0.2
### Invoice, Kuitansi, WhatsApp, dan Model Gelombang Keberangkatan Bulanan

| Kontrol | Nilai |
|---|---|
| Versi / tanggal | 0.2 / 17 November 2026 |
| Status | Draft teknis; klarifikasi model gelombang disetujui Owner |
| Baseline | KDJ Master System Specification v1.0 — Final Scope Frozen |
| PRD terkait | KDJ PRD v0.3 — Draft Owner Review, 17 November 2026 |
| Lingkungan | Local-first; Staging/Production terpisah |
| Otorisasi | Source/migration kandidat lokal saja; tidak ada hosted apply, WhatsApp live, atau deployment |

> Scope dan keputusan bisnis yang dicatat bukan izin untuk menjalankan migration, mengubah data hosted, mengirim WhatsApp live, deploy Vercel/VPS, atau mengubah Production.

## 1. Keputusan Owner 17 November 2026

### 1.1 Invoice dan kuitansi
1. Invoice pendaftaran diterbitkan setelah biodata awal lengkap berhasil dikirim dan diterima sistem.
2. Deadline invoice pendaftaran memakai deadline server/database yang juga menjadi dasar countdown Portal. Source aktif yang diperiksa menetapkan 24 jam dari waktu submission.
3. Invoice paket diterbitkan setelah pilihan paket berhasil tersimpan; biaya pendaftaran dan biaya paket terpisah.
4. Setelah cicilan paket dikonfirmasi, invoice baru menagih seluruh sisa tagihan.
5. Setiap transaksi pembayaran valid dan terkonfirmasi menghasilkan satu kuitansi tersendiri. Upload bukti bukan konfirmasi pembayaran.
6. Invoice lama tidak dihapus/ditimpa; invoice pengganti dihubungkan ke invoice sebelumnya.
7. Saat saldo nol, terbitkan kuitansi pembayaran terakhir dan tidak membuat invoice bernilai nol.

### 1.2 H-45 inclusive
- H-46 atau lebih awal: cicilan parsial boleh sesuai sisa tagihan.
- Tepat H-45 dan seterusnya: wajib melunasi seluruh sisa tagihan; cicilan parsial ditolak.
- Perhitungan menggunakan tanggal kalender Asia/Jakarta.
- Tanggal estimasi tidak boleh dipakai sebagai dasar H-45.

### 1.3 Model gelombang — klarifikasi Owner
1. Satu gelombang memiliki periode **bulan dan tahun** sebagai data yang pasti.
2. Tanggal pasti boleh berubah dan belum tentu tersedia saat gelombang dibuat.
3. Tanggal estimasi boleh dicatat dari pola tanggal keberangkatan tahun sebelumnya; statusnya hanya ESTIMASI/non-binding.
4. Tanggal final disimpan terpisah, dikonfirmasi kemudian, dan dapat berubah melalui tindakan Admin berwenang.
5. Satu gelombang dapat menampung banyak order mahasiswa; satu order aktif ditautkan ke satu gelombang.
6. H-45 dihitung hanya dari `confirmed_departure_date`, bukan dari tanggal estimasi atau tanggal yang disimpulkan dari histori.
7. Setiap konfirmasi/perubahan tanggal final wajib mencatat nilai lama/baru, actor, waktu, alasan, dan event.
8. Rekomendasi otorisasi pengelolaan gelombang/tanggal: Super Admin sampai delegasi role keuangan disahkan.

## 2. Source baseline yang diaudit

| Area | Temuan |
|---|---|
| Invoice pendaftaran | `kdj_registration_payments`, `invoice_ref`, `deadline_at`, proof/event dan RPC sudah tersedia. PDF ledger/receipt delivery belum ada. |
| Payment approval | `kdj_admin_review_registration_payment` mengonfirmasi pembayaran; titik ini cocok untuk idempotent receipt issuance. |
| Paket | `kdj_departure_packages`, `kdj_departure_orders`, `kdj_departure_installments`, dan event ledger sudah tersedia. |
| Batch/tanggal | Belum ada table gelombang, kolom batch di order, confirmed date, atau date-change audit trail. |
| H-45 UI | H-45 masih berupa teks statis; backend belum menegakkan cutoff. |
| Bot | Booking Outbox existing khusus pesan booking. Financial-document Outbox dan media delivery harus terpisah. |
| PDF | Tidak ditemukan dependency PDF renderer eksplisit di Portal. |

## 3. Model data gelombang

### 3.1 `kdj_departure_batches`
- `id`, `batch_code` unik, `name`.
- `departure_month`: tanggal kanonis hari pertama pada bulan/tahun gelombang.
- `estimated_departure_date`: nullable, harus berada dalam bulan yang sama; hanya referensi historis/operasional.
- `confirmed_departure_date`: nullable sampai tanggal final dikonfirmasi; harus berada dalam bulan yang sama.
- `status`: PLANNED / CONFIRMED / CLOSED / CANCELLED.
- created/updated actor dan timestamps.
- Multiple batch pada bulan yang sama tidak dilarang; masing-masing dibedakan lewat batch_code.

### 3.2 Hubungan order
- Tambahkan nullable `kdj_departure_orders.departure_batch_id` agar migrasi additive dan order lama tidak dipaksa masuk batch yang ditebak.
- Order tanpa batch atau batch tanpa confirmed date mempunyai policy result `DEPARTURE_BATCH_NOT_ASSIGNED` / `DEPARTURE_DATE_NOT_CONFIRMED`.
- Reassignment harus melalui RPC Admin dengan reason dan audit event, bukan direct DML dari customer/Bot.

### 3.3 `kdj_departure_batch_events`
Menyimpan BATCH_CREATED, ESTIMATE_UPDATED, DATE_CONFIRMED, DATE_CHANGED, ORDER_ASSIGNED, ORDER_REASSIGNED, actor, reason, before/after snapshot, dan waktu.

## 4. Perhitungan H-45

Untuk batch dengan tanggal final terkonfirmasi:
`h45_cutoff_date = confirmed_departure_date - 45 calendar days`.
`days_until_departure = confirmed_departure_date - current_date(Asia/Jakarta)`.

| Hari menuju keberangkatan | Policy |
|---:|---|
| 46 hari atau lebih | Cicilan parsial diizinkan |
| Tepat 45 hari | Wajib lunas seluruh remaining |
| 44 hari atau kurang | Wajib lunas seluruh remaining |

Jika tanggal final belum dikonfirmasi, API harus mengembalikan policy tidak dapat ditentukan, bukan membandingkan dengan estimated date. UI dapat menampilkan bulan gelombang dan catatan bahwa tanggal final/jatuh tempo menunggu konfirmasi KDJ.

Jika tanggal final berubah, H-45 dihitung ulang dan setiap invoice aktif yang due date-nya berubah digantikan oleh snapshot invoice baru. Invoice lama tetap immutable dan tersimpan di histori. Perubahan yang membuat hari menuju keberangkatan menjadi <=45 segera mengharuskan settlement seluruh remaining untuk pengajuan baru.

**Open policy sebelum mengubah RPC pembayaran:** bagaimana memperlakukan proof parsial yang disubmit sebelum tanggal final berubah, tetapi menunggu review saat tanggal baru masuk H-45. Rekomendasi untuk dipertimbangkan: gunakan server-side `submitted_at` sebagai cut-off proof, simpan bank transaction date sebagai evidence; finalisasi keputusan diperlukan sebelum integrasi review RPC.

## 5. Invoice/kuitansi dan Financial Document Outbox

1. Ledger `kdj_financial_documents` immutable; simpan document number, type, source transaction/event, amount, due date, issuer snapshot, student snapshot, object path, status, supersedes relation.
2. Ledger event terpisah untuk ISSUE/RENDER/SUPERSEDE/VOID/DELIVERY/RESEND/RECONCILE.
3. Unique source key untuk mencegah invoice/kuitansi ganda saat retry/concurrency.
4. Snapshot invoice/kuitansi diambil dari data resmi saat penerbitan; koreksi menghasilkan dokumen baru.
5. Private Storage; signed URL pendek; owner check Customer; RBAC Admin.
6. Financial-document Outbox terpisah dari booking notification Outbox; status PENDING/PROCESSING/SENT/FAILED/UNKNOWN.
7. UNKNOWN tidak auto-resend; Admin reconcile provider outcome dahulu. Resend memakai PDF dan nomor dokumen yang sama.
8. WhatsApp gagal tidak mengubah status PAID/VERIFIED atau menghapus dokumen.

## 6. Impact review

| Lapisan | Dampak |
|---|---|
| Supabase | Batch table, batch audit events, optional order FK, role-protected RPCs; kemudian document ledger/outbox/RPC invoice-kuitansi. |
| Portal Admin | CRUD/konfirmasi gelombang, estimate vs final clearly labelled, assign order, history date changes, invoice/receipt review. |
| Portal Customer | Bulan gelombang, status tanggal final, invoice/kuitansi history, PDF preview/download. |
| Payment RPCs | H-45 enforcement wajib membaca confirmed date; belum diubah di migration kandidat tahap ini. Receipt creation harus berada pada transaksi approve yang sama. |
| Storage | Private PDF objects, lifecycle dan access checks. |
| Bot | Worker media financial-doc terpisah; verified recipient; durable delivery/reconciliation. |

## 7. Candidate local implementation prepared

File kandidat migration: `supabase/migrations/20261117000000_kdj_departure_batches_v1.sql`.

Isi:
- Batch month/year + estimate/final date separation.
- Batch events.
- Nullable order-to-batch relation.
- Super Admin-only RPC create/update estimate/confirm/change date/assign order.
- H-45 read-model helper yang hanya menggunakan confirmed date.
- RLS/revoke grants untuk tabel dan RPC.
- API Admin `app/api/admin/departure-batches/route.js` untuk list/detail, create batch, update estimate, confirm/change date, serta assign/reassign order.
- API memakai RPC saja untuk mutasi, Super Admin-only, dan dikunci feature flag `KDJ_DEPARTURE_BATCH_FEATURE_ENABLED=true`; default tanpa flag adalah HTTP 503.
- Event history query mencakup batch asal/tujuan saat order dipindahkan.

**Current local validation:** contract test batch, full `npm test`, targeted ESLint dan `npm run build` berhasil. Ini adalah source/static validation, bukan bukti SQL migration berhasil dieksekusi atau integrasi database. `psql` tidak tersedia pada PC saat pemeriksaan, sehingga local PostgreSQL restore validation belum dilakukan.

**Important:** candidate migration ini belum menggantikan `kdj_submit_departure_installment` atau `kdj_admin_review_departure_installment`. Dengan sengaja belum mengaktifkan enforcement cicilan H-45 dan belum menerbitkan invoice/kuitansi. Admin UI untuk mengelola gelombang, Customer display, serta financial document ledger/PDF/WhatsApp belum dibuat. Perlu technical review, local restore/test, lalu persetujuan Staging terpisah.

## 8. Acceptance criteria

1. Create batch requires month/year; date estimate optional and inside selected month.
2. Estimate update cannot alter confirmed date or H-45.
3. Confirmed date must be in batch month and requires Super Admin + reason.
4. Confirmed date change records before/after, actor, timestamp, reason.
5. Order may be assigned/reassigned only through authorized RPC with audit event.
6. Missing batch/final date returns indeterminate payment policy; no date inferred.
7. At H-46 partial allowed; at H-45/H-44 entire remaining required.
8. Reassignment/date change updates due date through a new immutable invoice snapshot, not silent overwrite.
9. Registration fee is independent from package.
10. Each verified payment transaction produces exactly one receipt; no receipt on proof upload alone.
11. New installment invoice amount equals entire outstanding package balance.
12. WA outage/UNKNOWN does not change payment status or create duplicate docs.

## 9. Evidence ledger

| ID | Method | Result | Status |
|---|---|---|---|
| FIN-SRC-01 | Inspect registration migration/RPC | Server deadline and payment ledger already exist | PARTIAL |
| FIN-SRC-02 | Inspect registration Admin review RPC | Confirmed-payment transaction point identified | GAP: receipt issuance |
| FIN-SRC-03 | Inspect departure package migration/API | Order and installment ledger exist; batch date absent | FINDING |
| FIN-SRC-04 | Inspect H-45 UI and SQL RPC | H-45 UI copy only; no backend calculation/enforcement | FINDING |
| FIN-BATCH-01 | Inspect local candidate migration | Month/year estimate/final lifecycle and audit RPC drafted | LOCAL CANDIDATE |
| FIN-WA-01 | Inspect Bot booking Outbox | Booking-text-specific; finance media queue absent | GAP |

## 10. Release gates

1. Owner confirms proof cutoff policy around date change and issuer legal metadata.
2. Review SQL/RPC, RLS, grants, storage, document numbering, role/permission.
3. Restore candidate migration into isolated local PostgreSQL and validate function/table/ACL.
4. Implement Admin batch UI and Customer batch status display.
5. Integrate H-45 check into existing installment submit/review RPCs and test concurrency.
6. Build financial document ledger, PDF renderer/storage and invoice/receipt RPC issuance.
7. Implement financial-document WhatsApp media Outbox and UNKNOWN reconciliation.
8. Run local tests/build; explicit approval before Staging apply/UAT.
9. Production remains separately gated.

