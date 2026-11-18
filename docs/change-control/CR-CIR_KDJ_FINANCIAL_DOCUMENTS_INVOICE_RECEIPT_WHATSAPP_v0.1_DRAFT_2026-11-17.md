# KDJ Change Request & Change-Impact Review
## CR-CIR-KDJ-FIN-DOC-2026-11-17-01
### Invoice Penagihan, Kuitansi Pembayaran, dan Pengiriman Dokumen WhatsApp

| Kontrol | Nilai |
|---|---|
| Versi / tanggal | 0.1 / 17 November 2026 |
| Status | Draft teknis; keputusan bisnis Owner dicatat dan dikunci pada 17 November 2026 |
| Baseline | KDJ Master System Specification v1.0 — Final Scope Frozen |
| PRD terkait | KDJ PRD v0.2 — Draft Owner Review, 17 November 2026 |
| Lingkungan | Local-first; Staging memerlukan preflight/review dan Production approval terpisah |
| Klasifikasi | Penambahan kemampuan keuangan lintas Portal, Supabase, Storage, dan WhatsApp Bot |

> **Batas otorisasi.** Dokumen ini merekam keputusan bisnis Owner dan desain perubahan yang dibutuhkan. Pekerjaan lokal boleh disiapkan secara terisolasi. Dokumen ini tidak mengizinkan penerapan migration ke Supabase, perubahan data hosted, pengiriman WhatsApp customer live, deployment Vercel/VPS, atau perubahan Production. Production memerlukan persetujuan eksplisit terpisah.

## 1. Tujuan Perubahan

Menerbitkan Invoice Penagihan dan Kuitansi Pembayaran sebagai dokumen PDF resmi, menyimpannya secara privat, menampilkannya pada Portal/Admin, dan mengirimkannya secara otomatis ke WhatsApp customer setelah dokumen siap.

## 2. Keputusan Bisnis Owner — DIKUNCI 17 NOVEMBER 2026

### 2.1 Invoice
1. Invoice Penagihan Pendaftaran diterbitkan setelah biodata awal lengkap berhasil dikirim dan diterima sistem.
2. Jatuh tempo invoice pendaftaran mengikuti countdown yang sudah berlaku di Portal. Implementasi harus menggunakan deadline server/database, bukan jam browser. Pada source yang diaudit, RPC pendaftaran menetapkan deadline 24 jam dari waktu submission; nilai aktif harus dikonfirmasi terhadap konfigurasi/record yang berlaku saat release.
3. Invoice Penagihan Paket Keberangkatan diterbitkan setelah pilihan paket berhasil tersimpan.
4. Biaya pendaftaran terpisah sepenuhnya dari harga paket. Pembayaran pendaftaran tidak mengurangi saldo paket dan sebaliknya.
5. Setelah cicilan paket terkonfirmasi, invoice baru menagih **seluruh sisa tagihan** paket, bukan hanya angsuran berikutnya.
6. Invoice terdahulu tidak dihapus/ditimpa. Tandai sebagai superseded/replaced dan simpan sebagai histori.
7. Saat saldo paket menjadi nol, terbitkan kuitansi pelunasan dan jangan menerbitkan invoice baru bernilai nol.

### 2.2 Kuitansi
1. Setiap transaksi pembayaran yang valid dan terkonfirmasi menerbitkan satu Kuitansi Pembayaran tersendiri.
2. Berlaku untuk pembayaran pendaftaran, cicilan paket, pelunasan paket, dan pembayaran langsung lunas.
3. Upload bukti transfer bukan bukti pembayaran terkonfirmasi. Kuitansi hanya boleh diterbitkan setelah verifikasi/settlement berhasil pada jalur backend yang berwenang.
4. Nilai kuitansi adalah nominal transaksi yang diterima, bukan total invoice.
5. Satu source payment event hanya boleh menghasilkan satu kuitansi; retry/replay tidak boleh membuat kuitansi baru.

### 2.3 H-45 — INCLUSIVE
- Jika masih **lebih dari 45 hari** sebelum tanggal keberangkatan (H-46 atau lebih awal), cicilan paket diperbolehkan.
- Mulai **tepat H-45**, termasuk H-45, dan seterusnya, pendaftar wajib melunasi seluruh tagihan pendaftaran dan seluruh saldo paket; tidak ada cicilan parsial.
- Customer yang telah mencicil sebelum H-45 tetapi masih memiliki sisa saldo ketika memasuki H-45 wajib melunasi seluruh sisa tagihan.
- Invoice paket mencantumkan due date H-45 dari tanggal keberangkatan resmi.

### 2.4 Pengiriman WhatsApp
1. Invoice dan kuitansi dikirim otomatis dalam bentuk PDF ke nomor WhatsApp customer yang terdaftar/terverifikasi setelah dokumen selesai dibuat dan disimpan.
2. Kegagalan WhatsApp tidak mengubah status pembayaran atau menghapus dokumen.
3. Pengiriman ulang harus menggunakan dokumen dan nomor dokumen yang sama, tanpa penerbitan baru.
4. Hasil pengiriman yang tidak pasti (UNKNOWN) harus direkonsiliasi sebelum retry yang berpotensi mengirim duplikat.

## 3. Kondisi Source yang Ditemukan pada 17 November 2026

| Area | Fakta source |
|---|---|
| Invoice pendaftaran | Sudah ada fondasi `kdj_registration_payments`, `invoice_ref`, `deadline_at`, payment proof/event, dan RPC `kdj_start_registration_payment`. Belum ada ledger dokumen PDF/kuitansi terpadu dan pengiriman file PDF. |
| Pembayaran pendaftaran | Approval melalui `kdj_admin_review_registration_payment`; ini adalah titik transaksi yang harus membuat kuitansi secara atomik setelah approval. |
| Paket keberangkatan | Sudah ada `kdj_departure_packages`, `kdj_departure_orders`, `kdj_departure_installments`, payment events, dan RPC pemilihan paket/submit proof/review. |
| Invoice paket | Belum ada penerbitan invoice paket setelah pemilihan paket atau penggantian invoice saldo setelah cicilan. |
| Kuitansi | Belum ada penerbitan kuitansi per transaksi terkonfirmasi. |
| H-45 | Komponen Portal hanya menampilkan copy H-45. Schema `kdj_departure_packages` dan `kdj_departure_orders` belum menyimpan tanggal keberangkatan; backend belum menegakkan H-45. |
| PDF | Portal belum memiliki library PDF eksplisit pada dependency/source yang diperiksa. Format dan metode renderer perlu dipilih serta diuji. |
| WhatsApp Outbox | Booking Outbox yang ada khusus notifikasi booking teks; jangan memakai ulang tabel/kontrak booking untuk file keuangan. |

## 4. Gap / Open Design yang Menghalangi Enforcement

### 4.1 Sumber tanggal keberangkatan resmi — BLOCKER H-45
Belum ada tanggal keberangkatan otoritatif di schema saat ini. Harus diputuskan dan didesain:
- Apakah tanggal berada pada batch/gelombang keberangkatan atau per pesanan.
- Role yang berhak menetapkan/mengubah tanggal.
- Riwayat old/new date, actor, waktu, dan reason.
- Cara menghitung H-45 pada timezone operasional (tanggal kalender Asia/Jakarta).
- Dampak perubahan tanggal pada due date, invoice aktif, customer yang sudah membayar, dan invoice lama.

**Default fail-closed:** jangan mengaktifkan enforcement cicilan H-45 sampai tanggal keberangkatan resmi tersedia, ditetapkan oleh actor berwenang, dan tercatat dalam audit. Jangan menebak dari deskripsi paket atau copy UI.

### 4.2 Identitas penerbit pada dokumen
Nama legal penerbit, alamat resmi, dan identitas pajak bila digunakan harus diambil dari data organisasi KDJ yang telah diverifikasi. Jangan mengarang NPWP, alamat, atau informasi legal yang belum tersedia. Logo dapat memakai asset resmi yang telah disetujui.

### 4.3 Batas waktu proof di sekitar H-45
Technical design perlu menetapkan apakah kelayakan cicilan ditentukan dari waktu transaksi bank atau waktu proof masuk ke Portal. Rekomendasi aman: gunakan timestamp server pada submission proof yang masuk sebelum batas untuk menjaga review admin yang tertunda, simpan waktu transaksi yang tercantum pada bukti sebagai evidence, dan audit keputusan. Aturan ini perlu disahkan sebelum enforcement.

## 5. Target Alur Transaksi

### 5.1 Pendaftaran
Biodata lengkap diterima → backend membuat/memastikan invoice pendaftaran idempotent → dokumen PDF dibuat dari snapshot immutable → disimpan di private storage → Financial Document Outbox mengirim PDF ke WhatsApp.

Pembayaran pendaftaran diunggah → Admin melakukan verifikasi → RPC mengonfirmasi pembayaran → kuitansi dibuat dalam transaksi database yang sama → render/store/send via Outbox. Upload proof yang ditolak atau masih menunggu verifikasi tidak menghasilkan kuitansi.

### 5.2 Paket
Customer memilih paket → RPC menyimpan order → invoice awal paket dibuat senilai total paket. Setiap cicilan di-submit menjadi bukti menunggu verifikasi. Setelah approve:
- update paid amount dan remaining amount secara atomik;
- buat kuitansi senilai pembayaran yang disetujui;
- bila remaining > 0, tandai invoice aktif lama sebagai superseded dan buat invoice baru sebesar seluruh remaining;
- bila remaining = 0, status invoice menjadi settled/paid dan tidak membuat invoice saldo baru.

### 5.3 H-45
Pada H-46 atau lebih awal, proof partial dapat diproses sesuai remaining. Mulai H-45, RPC harus menolak pembayaran parsial dan hanya menerima pembayaran sebesar seluruh remaining. Untuk order yang masih memiliki pending proof sebelum H-45, perlakuannya harus mengikuti keputusan pada §4.3.

## 6. Impact Review

| Lapisan | Perubahan yang dibutuhkan | Kontrol wajib |
|---|---|---|
| Portal Customer | Daftar invoice/kuitansi, status, preview/download dan informasi jatuh tempo | Customer hanya dapat membaca dokumen miliknya; signed URL singkat |
| Portal Admin | Daftar seluruh dokumen per pendaftar, detail transaksi, unduh, kirim ulang, rekonsiliasi | RBAC server-side; Finance/Admin sesuai role map yang sah; audit tiap tindakan |
| Supabase | Immutable financial document ledger; unique document/source key; numbering; document events; financial document Outbox; RPC claim/finish/resend | RLS; revoke default grants; service-role only; transactional issuance; uniqueness/idempotency |
| Existing payment RPCs | Integrasikan event penerbitan invoice/kuitansi dengan titik sukses pembayaran/pemilihan paket | Satu transaksi DB; tidak menerbitkan kuitansi dari proof submission |
| Supabase Storage | Private PDF object storage | No public bucket; owner/admin authorization; signed URL; no path disclosure |
| WhatsApp Bot | Worker terpisah untuk mengambil financial-document Outbox dan mengirim PDF/media | Internal auth; recipient identity validated; status SENT/FAILED/UNKNOWN; no direct DML payment |
| Audit & recovery | Ledger status dokumen, render, delivery, resend/void/replacement | Append-only event history; UNKNOWN reconciliation; no auto-resend uncertain sends |

## 7. Desain Data Konseptual

Tabel/entitas yang direkomendasikan:
1. `kdj_financial_documents`: invoice/receipt, nomor unik, document type, source type/id/key, pendaftar, immutable JSON snapshot, amount, currency, due date, status, supersedes relation, storage path, timestamps.
2. `kdj_financial_document_events`: issued, rendered, superseded, paid, voided, resend requested, delivery state changes, actor, reason, correlation.
3. `kdj_financial_document_outbox`: source document id, recipient snapshot, media object path, status PENDING/PROCESSING/SENT/FAILED/UNKNOWN, attempts, lease/claim token, provider message id, failure metadata.
4. Sequence/numbering strategy terpisah untuk invoice dan kuitansi, aman terhadap concurrency dan reset tahun.

Ledger invoice/kuitansi menjadi arsip dokumen; ledger pembayaran yang sudah ada tetap menjadi sumber nilai uang. Jangan menggandakan saldo sebagai sumber kebenaran kedua.

## 8. Idempotency dan Konsistensi

- Invoice pendaftaran unik per kewajiban pendaftaran.
- Invoice paket awal unik per order.
- Invoice saldo baru unik per event pembayaran paket yang terkonfirmasi.
- Kuitansi unik per payment transaction yang terkonfirmasi.
- Database uniqueness constraint menjadi pertahanan terakhir; jangan mengandalkan hanya UI/JavaScript.
- Snapshot dokumen tidak dapat diubah setelah diterbitkan. Koreksi dilakukan dengan dokumen pengganti/void yang memiliki relasi.
- Pengiriman WhatsApp bukan transaksi pembayaran. Bila send gagal, status pembayaran tetap PAID/VERIFIED.
- Status UNKNOWN tidak boleh dikirim ulang otomatis sampai rekonsiliasi.
- Retry generation/storage tidak boleh membuat nomor invoice/kuitansi baru.

## 9. Acceptance Criteria

1. Initial complete registration creates exactly one registration invoice with the same server-side deadline as the Portal countdown.
2. Repeating the same initial-submit/request does not create a duplicate invoice.
3. Selecting a package creates exactly one package invoice; registration payment does not affect package balance.
4. For a package value Rp30,000,000, verified payments Rp5,000,000 then Rp5,000,000 create receipts for Rp5,000,000 each and replacement invoices for Rp25,000,000 then Rp20,000,000.
5. A final verified payment creates its own receipt and the package becomes PAID; no zero-value invoice is created.
6. A rejected/pending proof does not create a receipt or reduce balance.
7. Exactly one receipt is produced per confirmed payment across duplicate RPC/API attempts and concurrency.
8. H-46 permits partial package payment; H-45 and H-44 reject partial package payments and require the full outstanding balance.
9. If departure date is missing, H-45 enforcement does not infer a date or claim an eligibility result; the missing source is surfaced to Admin.
10. WA offline / media error / timeout / DB ACK failure does not change payment state or erase the PDF.
11. UNKNOWN is reconciled before resend; manual resend reuses the same document and document number.
12. Cross-customer document reads/downloads and unauthorized Admin actions are denied.
13. Every issue, replacement, void, resend and reconciliation operation is auditable.

## 10. Execution Sequence and Gates

1. Confirm departure date source, owner/role, date-change workflow and proof cutoff rule.
2. Confirm verified issuer metadata and document numbering convention.
3. Finalize Technical Design / ERD / SQL RPC contracts / RLS / ACL / Storage.
4. Build database migration and contract tests locally; no hosted migration apply.
5. Implement Portal issuance hooks and customer/admin document read paths.
6. Implement private PDF rendering/storage and immutable snapshot.
7. Implement Bot financial-document media Outbox worker separately from booking Outbox.
8. Run local unit/contract tests, lint, build, diff review.
9. Apply only to Staging after explicit go-ahead, backup/rollback plan and SQL review; execute end-to-end UAT with controlled test records.
10. Production remains separately gated by explicit Owner approval.

## 11. Evidence Ledger (Initial Source Review)

| Evidence ID | Method | Result | Status |
|---|---|---|---|
| FIN-SRC-01 | Inspect registration payment migration/RPC | Invoice reference and 24-hour server deadline foundation exists | PARTIAL |
| FIN-SRC-02 | Inspect registration Admin review API/RPC caller | Approval RPC identified; receipt generation absent | GAP |
| FIN-SRC-03 | Inspect departure package/installment migration | Package order and installment ledger exist; departure date absent | BLOCKER for H-45 |
| FIN-SRC-04 | Inspect package select/submit/review API | Package selection and proof submission/approval points identified | PARTIAL |
| FIN-SRC-05 | Search Portal dependencies/source for PDF renderer | No explicit PDF generation dependency found | OPEN |
| FIN-SRC-06 | Inspect Bot booking Outbox module | Existing Outbox is booking-text-specific; financial media needs a separate queue/worker | GAP |
| FIN-SRC-07 | Inspect H-45 Portal UI | H-45 phrase is static UI copy, not backend enforcement | FINDING |

**Current disposition:** business decisions have been captured in PRD v0.2. The full feature is not yet implemented. H-45 enforcement is blocked by the absence of a canonical departure date; issuer legal metadata and proof cutoff policy also need confirmation. Local/source work must not be represented as Staging or Production deployment.
