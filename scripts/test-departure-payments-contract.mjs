import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n?/g, '\n');

const migration = read('supabase', 'migrations', '20261114000000_kdj_departure_packages_and_installments.sql');
const departureRoute = read('app', 'api', 'departure-payments', 'route.js');
const reviewRoute = read('app', 'api', 'admin', 'departure-payments', 'review', 'route.js');
const progressRoute = read('app', 'api', 'student-progress', 'route.js');
const page = read('app', 'page.js');
const departureSection = read('app', 'components', 'DeparturePaymentSection.jsx');
const adminPage = read('app', 'admin', 'page.js');

// 1. Validasi Migration Database
assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS public.kdj_departure_packages'));
assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS public.kdj_departure_orders'));
assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS public.kdj_departure_installments'));
assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS public.kdj_departure_payment_events'));
assert.ok(migration.includes('SIAP_KULIAH'));
assert.ok(migration.includes('SIAP_KULIAH_PLUS'));
assert.ok(migration.includes('PLATINUM_SYARIAH'));
assert.ok(migration.includes('PLATINUM_EKONOMI'));
assert.ok(migration.includes('kdj_select_departure_package'));
assert.ok(migration.includes('kdj_submit_departure_installment'));
assert.ok(migration.includes('kdj_admin_review_departure_installment'));
assert.ok(migration.includes("'Super Admin', 'Admin Verifikator'"));
console.log('[PASS] Departure package migration schema, ledger & RPCs.');

// 2. Validasi Endpoint Mahasiswa
assert.ok(departureRoute.includes("kdj_select_departure_package"));
assert.ok(departureRoute.includes("kdj_submit_departure_installment"));
assert.ok(departureRoute.includes("hasValidMagicBytes"));
assert.ok(departureRoute.includes("MAX_FILE_SIZE = 5 * 1024 * 1024"));
console.log('[PASS] Applicant departure payment & installment upload route.');

// 3. Validasi Endpoint Admin Review (Dual Role: Super Admin & Admin Verifikator)
assert.ok(reviewRoute.includes("['Super Admin', 'Admin Verifikator']"));
assert.ok(reviewRoute.includes("kdj_admin_review_departure_installment"));
assert.ok(reviewRoute.includes("callWaBotApi"));
assert.ok(reviewRoute.includes("no_wa_orang_tua_wali"));
console.log('[PASS] Admin departure review RBAC and dual WhatsApp notification logic.');

// 4. Validasi Smart Gating pada Dokumen Pasca-Pendaftaran
assert.ok(progressRoute.includes("kdj_departure_orders"));
assert.ok(progressRoute.includes("download_locked"));
assert.ok(progressRoute.includes("departureOrder?.payment_status !== 'PAID'"));
console.log('[PASS] Smart document gating: Suketmah/LOA download lock & Visa/Ticket upload lock until 100% paid.');

// 5. Validasi Komponen UI Portal
assert.ok(page.includes("<DeparturePaymentSection"));
assert.ok(departureSection.includes("Pilihan Paket Keberangkatan & Pembayaran Bertahap"));
assert.ok(departureSection.includes("Sisa Pelunasan"));
assert.ok(departureSection.includes("7169735128"));
assert.ok(adminPage.includes("Status & Verifikasi Cicilan Paket Keberangkatan"));
assert.ok(adminPage.includes("handleReviewDepartureInstallment"));
console.log('[PASS] Student and Admin UI components integration.');

console.log('=== ALL DEPARTURE PAYMENT & INSTALLMENT CONTRACT TESTS PASSED ===');
