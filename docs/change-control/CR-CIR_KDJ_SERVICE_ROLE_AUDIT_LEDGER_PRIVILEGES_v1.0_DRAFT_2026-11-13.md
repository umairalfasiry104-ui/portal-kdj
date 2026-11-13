# DRAFT CR/CIR — Pembatasan Direct Privileges service_role pada Ledger KDJ
Tanggal: 13 November 2026
ID: CR-CIR-KDJ-SERVICE-ROLE-LEDGER-PRIV-001
Versi: 1.0-DRAFT
Status: DRAFT — MENUNGGU PERSETUJUAN OWNER
Environment evidence: Supabase Staging `pgmdurnylyuqkikbwwwy`
Parent baseline: KDJ Master System Specification v1.0 (scope frozen 3 November 2026)

## 1. Ringkasan temuan

Pemeriksaan katalog PostgreSQL Staging setelah migration `20261112132800` dan `20261112132807` memastikan bahwa role `service_role` secara efektif memiliki privilege SELECT, INSERT, UPDATE, DELETE, dan TRUNCATE pada seluruh 11 tabel baru di bawah.

RLS aktif pada 11 tabel. Pemeriksaan sebelumnya memastikan `anon` dan `authenticated` tidak memiliki akses SELECT langsung ke tabel-tabel tersebut dan tidak memiliki EXECUTE terhadap 15 RPC baru. Dengan demikian temuan ini bukan bukti kebocoran data publik. Risiko utamanya adalah integritas dan ketahanan audit: setiap komponen server yang memegang service-role key secara teknis dapat melakukan perubahan langsung atau menghapus ledger tanpa harus melewati prosedur bisnis/RPC yang dirancang.

Default privilege Staging untuk tabel public juga memberi hak luas kepada service_role pada objek baru yang dibuat oleh role migration terkait. Karena itu, perbaikan harus eksplisit per objek dan masuk ke checklist setiap migration baru.

## 2. Objek yang termasuk scope

- `kdj_registration_events`
- `kdj_registration_payment_events`
- `kdj_registration_payment_proofs`
- `kdj_registration_payments`
- `kdj_registration_reporting_config`
- `kdj_student_progress`
- `kdj_student_progress_documents`
- `kdj_student_progress_events`
- `kdj_admin_daily_report_runs`
- `kdj_admin_daily_report_deliveries`
- `kdj_admin_daily_report_delivery_events`

Tidak termasuk tabel lama, Storage, key rotation, perubahan role bisnis, atau desain ulang RPC.

## 3. Usulan kontrol privilege

Target least-privilege untuk 11 objek di atas:

1. Pertahankan SELECT langsung untuk `service_role` hanya sejauh diperlukan oleh Portal/Bot read path yang telah ditinjau.
2. Revoke seluruh direct table privileges lain dari `service_role` (INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN jika didukung/terdaftar pada versi PostgreSQL yang digunakan).
3. Perubahan data wajib melalui RPC `SECURITY DEFINER` yang telah ditinjau, dengan schema-qualified object references dan `search_path = ''`.
4. Pertahankan EXECUTE pada RPC hanya untuk `service_role`; jangan memberi EXECUTE atau table privileges kepada `anon` / `authenticated`.
5. Semua empat event ledgers dan daily report snapshot diperlakukan append-only/immutable. Tidak boleh ada jalur aplikasi yang mengubah atau menghapus bukti historis.
6. Jangan mengubah default privileges global untuk seluruh schema public pada CR ini. Setiap migration mendatang yang menambah tabel harus menyertakan grant/revoke khusus objek dan pemeriksaan ACL pasca-deploy.

Proposed SQL shape (DRAFT — jangan jalankan sebelum Owner menyetujui dan seluruh direct access path selesai diverifikasi):

```sql
REVOKE ALL PRIVILEGES ON TABLE
  public.kdj_registration_events,
  public.kdj_registration_payment_events,
  public.kdj_registration_payment_proofs,
  public.kdj_registration_payments,
  public.kdj_registration_reporting_config,
  public.kdj_student_progress,
  public.kdj_student_progress_documents,
  public.kdj_student_progress_events,
  public.kdj_admin_daily_report_runs,
  public.kdj_admin_daily_report_deliveries,
  public.kdj_admin_daily_report_delivery_events
FROM service_role;

GRANT SELECT ON TABLE
  public.kdj_registration_events,
  public.kdj_registration_payment_events,
  public.kdj_registration_payment_proofs,
  public.kdj_registration_payments,
  public.kdj_registration_reporting_config,
  public.kdj_student_progress,
  public.kdj_student_progress_documents,
  public.kdj_student_progress_events,
  public.kdj_admin_daily_report_runs,
  public.kdj_admin_daily_report_deliveries,
  public.kdj_admin_daily_report_delivery_events
TO service_role;
```

Catatan: SQL di atas hanya proposal. Harus dikonfirmasi melalui source access-path audit, lalu diuji di clone/restore sebelum migration ACL dibuat.

## 4. Dampak dan kompatibilitas

- Portal read endpoints menggunakan service-role client untuk membaca payment, proof, student progress, document metadata dan report recovery queue. SELECT perlu dipertahankan.
- State transitions, proof recording/review, document versioning, progress transition, report generation/claim/finish/reconciliation/retry menggunakan RPC. Perlu dibuktikan seluruh fungsi yang menulis adalah SECURITY DEFINER dan owned oleh role yang memang mempunyai hak tabel yang diperlukan.
- Jika masih ada jalur aplikasi yang melakukan direct INSERT/UPDATE/DELETE terhadap 11 tabel, jalur itu harus diubah menjadi RPC atau diotorisasi sebagai pengecualian terdokumentasi sebelum ACL diterapkan. Jangan mengasumsikan tanpa source scan.
- Bot Admin Daily Report delivery flag tetap OFF. CR ini tidak mengaktifkan pengiriman WhatsApp dan tidak menjadwalkan ulang Cron.
- Tidak ada perubahan pada data bisnis, tabel lama, atau role Admin.

## 5. Risiko implementasi

Risiko utama adalah memutus operasi jika ada direct DML yang belum ditemukan atau jika fungsi RPC bukan SECURITY DEFINER/owner yang tepat. Mitigasi: source scan, role/ACL matrix di local clone, seluruh contract/regression tests terkait, dan post-deploy runtime smoke.

Rollback tidak cukup dilakukan dengan sekadar membatalkan migration jika transaksi sudah committed. Recovery plan harus berupa forward-fix ACL yang sempit atau restore backup Staging sesuai hasil uji. Production tetap dilarang sampai CR/CIR disetujui, Staging UAT lulus, dan release gate ditandatangani.

## 6. Acceptance criteria

- Direct service_role SELECT berfungsi hanya pada objek yang disetujui.
- Direct service_role INSERT/UPDATE/DELETE/TRUNCATE ditolak pada seluruh objek immutable/audit dan tidak tersedia sebagai bypass bagi ledger lain.
- Seluruh RPC resmi tetap dapat menulis dan mengubah state sesuai business rules.
- `anon` dan `authenticated` tetap ditolak pada direct table access dan EXECUTE.
- Portal Super Admin/Admin Konsultan/Admin Verifikator role matrix tidak mengalami regresi.
- Payment proof revision history, payment review, progress transitions, document version history, immutable report snapshots, delivery claim/reconcile/retry seluruhnya lulus pengujian.
- Security Advisor dan direct `has_table_privilege` query direkam sebelum/sesudah dengan hasil yang dijelaskan.
- Tidak ada WhatsApp send, Bot restart, Cron alteration, atau Production change sebagai bagian otomatis dari CR ini.

## 7. Change impact review

| Area | Dampak | Pemeriksaan wajib |
|---|---|---|
| Architecture | Tidak ada perubahan arsitektur | Pastikan RPC tetap menjadi write boundary |
| Database / ACL | Perubahan privilege 11 tabel | ACL before/after, role matrix, RLS tetap aktif |
| API / RPC | Diharapkan tidak ada kontrak API berubah | Jalankan contract tests dan setiap RPC write-path |
| Security / privacy | Mengurangi blast radius service-role key | Uji deny direct DML dan pastikan key tidak terpapar |
| WhatsApp | Tidak ada perubahan | Delivery flag tetap OFF, jangan kirim pesan |
| Cron | Tidak ada perubahan | Pastikan 3 job aktif tetap identik |
| Docs / runbook | Perlu update privilege matrix | Catat operator actions, recovery, evidence |

## 8. Evidence baseline Staging — 13 November 2026

- Staging migration versions 20261112132800 dan 20261112132807 tercatat.
- 11/11 tabel ada dan RLS aktif.
- 15/15 RPC baru tersedia; sebelumnya terverifikasi SECURITY DEFINER dengan search_path kosong dan EXECUTE hanya untuk service_role.
- Effective service_role privileges pada 11/11 tabel adalah SELECT, INSERT, UPDATE, DELETE, TRUNCATE.
- Tidak ada direct SELECT untuk anon/authenticated pada 11 tabel baru.
- Semua tabel bisnis baru masih kosong selain singleton konfigurasi reporting.
- Tidak ada perubahan ACL yang dilakukan saat menyusun CR ini.

## 9. Keputusan Owner

- [ ] APPROVE untuk lanjut source access-path audit + local clone ACL prototype.
- [ ] REVISE scope/exception.
- [ ] REJECT.

Persetujuan CR ini tidak otomatis mengizinkan penerapan ACL ke Staging atau Production. Deployment memerlukan Change-Impact Review final, backup Staging terverifikasi, dan persetujuan eksekusi terpisah.
