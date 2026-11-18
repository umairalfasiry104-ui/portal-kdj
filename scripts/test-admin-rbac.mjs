import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const security = read('lib/security.js');
const mapStart = security.indexOf('const ROLE_PERMISSION_MAP = Object.freeze(');
const mapEnd = security.indexOf('\n});', mapStart);
assert.ok(mapStart >= 0 && mapEnd > mapStart, 'ROLE_PERMISSION_MAP tidak ditemukan.');
const mapSource = security.slice(mapStart, mapEnd + 4);
const verifierBlock = mapSource.match(/'Admin Verifikator': Object\.freeze\(\[([\s\S]*?)\]\)/)?.[1] || '';
const consultantBlock = mapSource.match(/'Admin Konsultan': Object\.freeze\(\[([\s\S]*?)\]\)/)?.[1] || '';
assert.ok(verifierBlock, 'Permission Admin Verifikator tidak ditemukan.');
assert.doesNotMatch(verifierBlock, /finance|payment_proof|booking\./i, 'Verifikator tidak boleh mendapat izin finance/payment/booking.');
assert.match(verifierBlock, /pendaftar\.verification\.read/);
assert.match(verifierBlock, /dokumen\.academic\.review/);
assert.doesNotMatch(consultantBlock, /finance|payment_proof|pendaftar\.verification/i);
assert.match(consultantBlock, /booking\.manage/);
assert.match(consultantBlock, /booking\.outbox\.retry_failed/);
assert.doesNotMatch(consultantBlock, /booking\.outbox\.resolve_unknown/);

const pendaftarRoute = read('app/api/admin/pendaftar/route.js');
assert.match(pendaftarRoute, /hasAdminPermission\(role, 'pendaftar\.finance\.write'\)/);
assert.match(pendaftarRoute, /Verifikasi dan perubahan pembayaran hanya dapat dilakukan oleh Super Admin/);
assert.doesNotMatch(pendaftarRoute, /finalCatatanPembayaran/);
assert.match(pendaftarRoute, /p_doc_updates: docUpdates/);

const uploadRoute = read('app/api/upload-dokumen/route.js');
assert.match(uploadRoute, /hasAdminPermission\(adminRole, 'dokumen\.academic\.read'\)/);
assert.match(uploadRoute, /hasAdminPermission\(adminRole, 'dokumen\.payment_proof\.read'\)/);
assert.doesNotMatch(uploadRoute, /\['Super Admin', 'Admin Verifikator'\]\.includes\(adminRole\)/);

const scheduleRoute = read('app/api/admin/jadwal/route.js');
assert.match(scheduleRoute, /requireAdminPermission\(req, 'booking\.read'\)/);
assert.match(scheduleRoute, /requireAdminPermission\(req, requiredPermission\)/);
assert.match(scheduleRoute, /supabase\.rpc\(\s*'kdj_admin_create_booking_attested'/);
assert.doesNotMatch(scheduleRoute, /supabase\.rpc\('kdj_create_booking'/);
assert.match(scheduleRoute, /createAdminBookingAttestation\(/);
assert.doesNotMatch(scheduleRoute, /\.from\(['"]jadwal_konsultasi['"]\)[\s\S]{0,300}\.insert\(/);

const retryRoute = read('app/api/admin/jadwal/notifications/retry/route.js');
assert.match(retryRoute, /confirmUnknown\s*\?\s*'booking\.outbox\.resolve_unknown'/);
assert.match(retryRoute, /'booking\.outbox\.retry_failed'/);

const adminPage = read('app/admin/page.js');
const passwordManager = read('app/admin/components/AdminPasswordManager.jsx');
assert.match(passwordManager, /createPortal\([\s\S]*document\.body/, 'Password modal must render in document.body outside sticky header stacking contexts.');
assert.match(passwordManager, /portalReady/, 'Password modal portal must wait for client mount to avoid SSR document access.');
assert.match(passwordManager, /document\.body\.style\.overflow = 'hidden'/, 'Password modal must lock background page scrolling.');
assert.match(passwordManager, /max-h-\[calc\(100dvh-2rem\)\]/, 'Password modal must fit short viewports and keep content scrollable.');
assert.match(adminPage, /adminUser\?\.role === 'Super Admin' && \(/, 'Panel pembayaran harus Super Admin-only.');
assert.match(adminPage, /if \(role === 'Super Admin' && paymentReview === null\) \{\s*\/\/ Legacy records without the new payment ledger keep the old compatibility path\.\s*payload\.status_pembayaran = statusPembayaranBaru;/, 'Payload status pembayaran generik hanya boleh dipakai Super Admin untuk record legacy tanpa payment ledger.');
assert.match(adminPage, /x-idempotency-key/, 'CREATE jadwal manual wajib mengirim idempotency key.');
assert.match(adminPage, /manualBookingRequest\?\.fingerprint === requestFingerprint/, 'Retry payload identik harus memakai idempotency key yang sama.');

assert.match(adminPage, /const sidebarNavGroups = \[/, 'Sidebar harus memakai konfigurasi menu terkelompok.');
assert.match(adminPage, /canAccessPendaftarTab\(adminUser\?\.role\)/, 'Menu pendaftar harus mempertahankan pemeriksaan akses role.');
assert.match(adminPage, /canAccessJadwalTab\(adminUser\?\.role\)/, 'Menu jadwal harus mempertahankan pemeriksaan akses role.');
assert.match(adminPage, /canAccessLeadQualificationTab\(adminUser\?\.role\)/, 'Menu kualifikasi harus mempertahankan pemeriksaan akses role.');
assert.match(adminPage, /canViewDeparturePayments\(adminUser\?\.role\)/, 'Menu pelunasan harus mempertahankan pemeriksaan akses role.');
assert.match(adminPage, /canAccessAdminsTab\(adminUser\?\.role\)/, 'Direktori Admin harus tetap dibatasi oleh helper akses.');
assert.match(adminPage, /isSidebarOpen \? 'translate-x-0' : '-translate-x-full'/, 'Drawer mobile harus dapat dibuka dan ditutup.');
assert.match(adminPage, /lg:pl-\[280px\]/, 'Konten desktop harus memberi ruang untuk sidebar.');
assert.match(adminPage, /onClick=\{\(\) => handleNavigateTab\(item\.id\)\}/, 'Navigasi sidebar harus mengubah tab aktif.');

console.log('[PASS] Three-role RBAC: payment authority is Super Admin-only.');
console.log('[PASS] Verifikator is limited to academic verification.');
console.log('[PASS] Konsultan has booking control but cannot resolve UNKNOWN Outbox.');
console.log('[PASS] Manual Admin booking uses the HMAC-attested transactional database wrapper.');
console.log('[PASS] Portal UI and API enforce the same permission boundaries.');
