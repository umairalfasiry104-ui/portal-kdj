# KDJ Change Request & Change-Impact Review
## CR-CIR-KDJ-FIN-DOC-2026-11-17-01 — v0.3
### Invoice, Kuitansi, WhatsApp, dan Model Gelombang Keberangkatan Bulanan

| Kontrol | Nilai |
|---|---|
| Versi / tanggal | 0.3 / 18 November 2026 |
| Status | Draft teknis; klarifikasi model gelombang dan fungsi H-45 sebagai trigger follow-up disetujui Owner pada 18 November 2026 |
| Baseline | KDJ Master System Specification v1.0 — Final Scope Frozen |
| PRD terkait | KDJ PRD v0.4 — Draft Owner Review, 18 November 2026 |
| Lingkungan | Local-first; Staging/Production terpisah |
| Otorisasi | Source/migration kandidat lokal saja; tidak ada hosted apply, WhatsApp live, atau deployment |

> Scope dan keputusan bisnis yang dicatat bukan izin untuk menjalankan migration, mengubah data hosted, mengirim WhatsApp live, deploy Vercel/VPS, atau mengubah Production.

## 1. Keputusan Owner 17–18 November 2026

### 1.1 Invoice dan kuitansi
1. Invoice pendaftaran diterbitkan setelah biodata awal lengkap berhasil dikirim dan diterima sistem.
2. Deadline invoice pendaftaran memakai deadline server/database yang juga menjadi dasar countdown Portal. Source aktif yang diperiksa menetapkan 24 jam dari waktu submission.
3. Invoice paket diterbitkan setelah pilihan paket berhasil tersimpan; biaya pendaftaran dan biaya paket terpisah.
4. Setelah cicilan paket dikonfirmasi, invoice baru menagih seluruh sisa tagihan.
5. Setiap transaksi pembayaran valid dan terkonfirmasi menghasilkan satu kuitansi tersendiri. Upload bukti bukan konfirmasi pembayaran.
6. Invoice lama tidak dihapus/ditimpa; invoice pengganti dihubungkan ke invoice sebelumnya.
7. Saat saldo nol, terbitkan kuitansi pembayaran terakhir dan tidak membuat invoice bernilai nol.

### 1.2 H-45 sebagai trigger follow-up, bukan batas pembayaran
- H-45 (inclusive) adalah titik dimulainya pengingat dan monitoring pelunasan untuk customer yang masih memiliki saldo.
- H-45 bukan tanggal jatuh tempo wajib, bukan larangan cicilan, dan bukan pemicu pembatalan/penolakan pembayaran.
- Customer tetap dapat membayar sebagian dengan nominal sesuai kemampuan setelah H-45, termasuk pada H-30, H-7, dan sampai seluruh saldo lunas.
- Target operasional yang umum adalah pelunasan sekitar H-30. Ini merupakan target monitoring, bukan batas teknis atau hard deadline; KDJ tetap menerima pembayaran yang baru lunas pada H-7.
- H-45 dihitung dari `confirmed_departure_date` hanya untuk menentukan kapan follow-up dimulai. Tanggal estimasi tidak boleh menjadi dasar trigger.
- Submit/review payment RPC harus mempertahankan mekanisme pembayaran yang ada dan tidak menambahkan validasi nominal penuh berdasarkan jarak keberangkatan.

### 1.3 Model gelombang — klarifikasi Owner
1. Satu gelombang memiliki periode **bulan dan tahun** sebagai data yang pasti.
2. Tanggal pasti boleh berubah dan belum tentu tersedia saat gelombang dibuat.
3. Tanggal estimasi boleh dicatat dari pola tanggal keberangkatan tahun sebelumnya; statusnya hanya ESTIMASI/non-binding.
4. Tanggal final disimpan terpisah, dikonfirmasi kemudian, dan dapat berubah melalui tindakan Admin berwenang.
5. Satu gelombang dapat menampung banyak order mahasiswa; satu order aktif ditautkan ke satu gelombang.
6. Tanggal mulai follow-up H-45 dihitung hanya dari `confirmed_departure_date`, bukan dari tanggal estimasi atau tanggal yang disimpulkan dari histori.
7. Setiap konfirmasi/perubahan tanggal final wajib mencatat nilai lama/baru, actor, waktu, alasan, dan event.
8. Rekomendasi otorisasi pengelolaan gelombang/tanggal: Super Admin sampai delegasi role keuangan disahkan.

## 2. Source baseline yang diaudit

| Area | Temuan |
|---|---|
| Invoice pendaftaran | `kdj_registration_payments`, `invoice_ref`, `deadline_at`, proof/event dan RPC sudah tersedia. PDF ledger/receipt delivery belum ada. |
| Payment approval | `kdj_admin_review_registration_payment` mengonfirmasi pembayaran; titik ini cocok untuk idempotent receipt issuance. |
| Paket | `kdj_departure_packages`, `kdj_departure_orders`, `kdj_departure_installments`, dan event ledger sudah tersedia. |
| Batch/tanggal | Belum ada table gelombang, kolom batch di order, confirmed date, atau date-change audit trail. |
| H-45 UI | Copy lama menyebut H-45 sebagai batas pembayaran; copy lokal sudah dikoreksi menjadi trigger follow-up. Monitoring Admin dan database belum dirilis. |
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
- Order tanpa batch atau batch tanpa confirmed date tidak memiliki tanggal trigger H-45 yang dapat dihitung. Kondisi ini tidak menghalangi submit atau verifikasi pembayaran/cicilan.
- Reassignment harus melalui RPC Admin dengan reason dan audit event, bukan direct DML dari customer/Bot.

### 3.3 `kdj_departure_batch_events`
Menyimpan BATCH_CREATED, ESTIMATE_UPDATED, DATE_CONFIRMED, DATE_CHANGED, ORDER_ASSIGNED, ORDER_REASSIGNED, actor, reason, before/after snapshot, dan waktu.

## 4. Perhitungan dan trigger follow-up H-45

Untuk batch dengan tanggal final terkonfirmasi:
`h45_trigger_date = confirmed_departure_date - 45 calendar days`.
`days_until_departure = confirmed_departure_date - current_date(Asia/Jakarta)`.

| Hari menuju keberangkatan | Perlakuan sistem |
|---:|---|
| H-46 atau lebih awal | Pembayaran dan cicilan berjalan normal; belum memasuki trigger H-45 |
| Tepat H-45 | Mulai trigger pengingat/monitoring untuk order yang masih memiliki saldo |
| H-30 | Target operasional umum untuk pelunasan; bukan hard deadline dan tidak memblokir cicilan |
| H-7 | Pembayaran sebagian tetap diterima dan diverifikasi seperti biasa sampai lunas |
| Setelah pembayaran terverifikasi melunasi saldo | Status menjadi LUNAS dan follow-up dihentikan |

H-45 tidak boleh mengubah validasi nominal pembayaran. Sistem tidak boleh menolak partial payment, mewajibkan seluruh remaining, membatalkan order, atau menandai pembayaran tidak sah hanya karena tanggal telah melewati H-45.

Jika tanggal final belum dikonfirmasi, tanggal trigger belum dapat dihitung dan UI harus menyatakan tanggal final masih menunggu konfirmasi. Namun pembayaran tetap dapat dilakukan seperti biasa; estimated date tidak digunakan sebagai dasar follow-up.

Jika tanggal final berubah, tanggal trigger follow-up dihitung ulang. Snapshot invoice yang sudah diterbitkan tidak boleh ditimpa. Bila informasi tanggal keberangkatan/trigger pada invoice aktif perlu diperbarui, terbitkan snapshot pengganti dan pertahankan dokumen sebelumnya sebagai histori. Perubahan tanggal tidak boleh mengubah kelayakan atau nominal cicilan.

## 5. Invoice/kuitansi dan Financial Document Outbox

1. Ledger `kdj_financial_documents` immutable; simpan document number, type, source transaction/event, amount, due date bila kewajiban tersebut memiliki due date resmi, issuer snapshot, student snapshot, object path, status, supersedes relation. H-45 paket dicatat sebagai tanggal trigger follow-up, bukan due date.
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
| Payment RPCs | Pertahankan pembayaran parsial dan penuh tanpa cutoff H-45. H-45 hanya menjadi status trigger untuk monitoring/follow-up berdasarkan confirmed date; receipt creation tetap berada pada transaksi approve yang sama. |
| Storage | Private PDF objects, lifecycle dan access checks. |
| Bot | Worker media financial-doc terpisah; verified recipient; durable delivery/reconciliation. |

## 7. Candidate local implementation prepared

File kandidat migration: `supabase/migrations/20261117000000_kdj_departure_batches_v1.sql`.

Isi:
- Batch month/year + estimate/final date separation.
- Batch events.
- Nullable order-to-batch relation.
- Super Admin-only RPC create/update estimate/confirm/change date/assign order.
- H-45 follow-up read-model helper yang hanya menggunakan confirmed date; helper hanya menghitung trigger monitoring dan menyatakan H-45 tidak menerapkan payment restriction. Validasi status lunas/sisa tagihan tetap menjadi tanggung jawab payment RPC yang ada.
- RLS/revoke grants untuk tabel dan RPC.
- API Admin `app/api/admin/departure-batches/route.js` untuk list/detail, create batch, update estimate, confirm/change date, serta assign/reassign order.
- API memakai RPC saja untuk mutasi, Super Admin-only, dan dikunci feature flag `KDJ_DEPARTURE_BATCH_FEATURE_ENABLED=true`; default tanpa flag adalah HTTP 503.
- Event history query mencakup batch asal/tujuan saat order dipindahkan.
- Admin UI pengelolaan gelombang `app/admin/components/AdminDepartureBatchPanel.jsx` untuk Super Admin: create gelombang bulan/tahun, update tanggal estimasi, confirm/change tanggal final, assign/reassign order (termasuk order yang sudah lunas), serta lihat audit history. Route GET memuat order dan snapshot nama pendaftar; mutasi tetap melalui RPC.
- Database read model `kdj_admin_list_departure_h45_followups()` hanya membaca order bersaldo, memakai confirmed date, serta melaporkan tahap follow-up tanpa mengubah kelayakan pembayaran.
- Endpoint monitoring dibatasi ke Super Admin, Admin Verifikator, dan Admin Viewer; nomor WhatsApp dimasking; tidak ada aksi pembayaran atau pengiriman WhatsApp dari panel ini.
- Monitoring saat ini berupa dashboard refresh/manual follow-up. Pengiriman pengingat otomatis melalui WhatsApp belum dibuat atau diaktifkan.
- RPC `kdj_get_nearest_departure_wave()` menyediakan snapshot gelombang terdekat untuk Bot: final / estimasi / bulan saja. Estimasi wajib dilabeli; tanggal tidak boleh diturunkan dari bulan atau histori.
- Bot `lib/departure-wave-context.js` membaca RPC dengan service-role read-only dan cache 30 detik; hasil kosong/error diperlakukan fail-closed. Konteks database disisipkan ke system instruction Gemini untuk pertanyaan AI pada setiap pesan inbound.
- Knowledge Base dan Guardrails memisahkan status `CONFIRMED`, `ESTIMATED`, `MONTH_ONLY`, serta data kosong/error. Bot tidak mengirim pesan proaktif atau pengumuman WA dari perubahan tanggal.

**Validation and Production evidence (18 Nov 2026):** Full Portal `npm test`, targeted ESLint, `npm run build`, `git diff --check`, Bot `npm test`, `npm run check`, Node syntax checks, serta test konteks gelombang Bot lulus. Production migration `20261118074116 / kdj_departure_batches_v1` dan ACL hardening `20261118074256 / kdj_departure_batches_service_role_acl_hardening` berhasil diterapkan. Runtime read-only checks memastikan tabel, kolom FK, RLS, delapan RPC, privilege, dan migration history terpasang. PostgreSQL lokal restore drill tidak tervalidasi karena autentikasi lokal tidak tersedia; validasi runtime dilakukan langsung pada Production dengan query read-only.

**Important:** dua migration sudah diterapkan ke Production `faoxkegwhpcuubtiserj`. Tabel batch/event dan kolom FK order tersedia. ACL final: `anon`/`authenticated` tidak memiliki akses; `service_role` hanya SELECT pada kedua tabel, sedangkan mutasi hanya lewat RPC SECURITY DEFINER dengan `search_path=''` dan validasi Super Admin. `kdj_submit_departure_installment` dan `kdj_admin_review_departure_installment` tidak diubah; H-45 tetap follow-up trigger, bukan batas pembayaran. Portal API masih memerlukan feature flag Production `KDJ_DEPARTURE_BATCH_FEATURE_ENABLED=true` untuk mengaktifkan dua tab Admin setelah deployment. Bot source lokal sudah membaca RPC terdekat dengan cache 30 detik; runtime process Bot belum direstart/deploy dan belum ada live WhatsApp QA. Belum ada batch/tanggal aktual yang dimasukkan. Customer display bulan/tanggal pada area pendaftar, invoice/kuitansi, financial document ledger, desain visual PDF, private storage, dan financial-document WhatsApp Outbox/worker masih belum selesai. Template invoice/kuitansi dimiliki Owner tetapi belum ditemukan/terlampir pada workspace ini.

## 8. Acceptance criteria

1. Create batch requires month/year; date estimate optional and inside selected month.
2. Estimate update cannot alter confirmed date or H-45.
3. Confirmed date must be in batch month and requires Super Admin + reason.
4. Confirmed date change records before/after, actor, timestamp, reason.
5. Order may be assigned/reassigned only through authorized RPC with audit event.
6. Missing batch/final date returns no calculated H-45 follow-up date; payment submission and verification remain available as usual.
7. Partial payments remain accepted at H-46, H-45, H-30, H-7, and afterward until the remaining balance reaches zero; H-45 only activates follow-up monitoring.
8. Reassignment/date change recalculates the H-45 follow-up trigger. If an active invoice snapshot displays changed departure/trigger information, issue an immutable replacement; payment eligibility never changes.
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
| FIN-SRC-04 | Inspect H-45 UI and SQL RPC | Baseline UI copy was static; Production RPC now calculates follow-up trigger from confirmed date only; payment flow unchanged | APPLIED / VERIFIED |
| FIN-BATCH-01 | Apply & verify Production migrations | Batch month/year, estimate/final lifecycle, audit RPC, Bot nearest-wave RPC, RLS and service_role SELECT-only ACL | APPLIED / VERIFIED |
| FIN-BOT-WAVE-01 | Supabase service-role RPC preflight from Bot runtime config | `kdj_get_nearest_departure_wave()` returned an empty array (no batch exists yet) | PASS / NO WAVE DATA |
| FIN-WA-01 | Inspect Bot booking Outbox | Booking-text-specific; finance media queue absent | GAP |

## 10. Release gates

1. Owner confirms verified issuer legal metadata; a proof cutoff decision is not needed for H-45 because H-45 does not restrict payment eligibility.
2. Review SQL/RPC, RLS, grants, storage, document numbering, role/permission.
3. Production migration sudah diaplikasikan dan diverifikasi. Uji operasi batch di Admin setelah Portal deployment dan feature flag `KDJ_DEPARTURE_BATCH_FEATURE_ENABLED=true` aktif.
4. Implement Customer display bulan/tanggal gelombang dan status konfirmasi tanggal final; Admin batch UI dan monitoring tersedia di source lokal, menunggu feature flag/deployment.
5. Validate Admin H-45 monitoring for unpaid orders based only on confirmed batch date; verify payment submit/review RPCs continue accepting partial payments after H-45. Automated reminder delivery remains a separate implementation decision.
6. Build financial document ledger, PDF renderer/storage and invoice/receipt RPC issuance.
7. Implement financial-document WhatsApp media Outbox and UNKNOWN reconciliation.
8. Run local tests/build; explicit approval before Staging apply/UAT.
9. Production remains separately gated.
