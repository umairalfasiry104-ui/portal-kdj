import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n?/g, '\n');

const migration = read('supabase/migrations/20261117000000_kdj_departure_batches_v1.sql');
const aclMigration = read('supabase/migrations/20261118074256_kdj_departure_batches_service_role_acl_hardening.sql');
const api = read('app/api/admin/departure-followups/route.js');
const panel = read('app/admin/components/AdminDepartureFollowupPanel.jsx');
const batchApi = read('app/api/admin/departure-batches/route.js');
const batchPanel = read('app/admin/components/AdminDepartureBatchPanel.jsx');
const adminPage = read('app/admin/page.js');
const access = read('app/admin/lib/admin-access.js');

assert.match(migration, /CREATE TABLE public\.kdj_departure_batches/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.kdj_get_departure_h45_followup_status/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.kdj_admin_list_departure_h45_followups/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.kdj_get_nearest_departure_wave/);
assert.match(migration, /'CONFIRMED'/);
assert.match(migration, /'ESTIMATED'/);
assert.match(migration, /'MONTH_ONLY'/);
assert.match(migration, /COALESCE\(b\.confirmed_departure_date, b\.estimated_departure_date\)/);
assert.ok(!migration.includes('pg_catalog.coalesce'), 'COALESCE must remain SQL syntax, not a schema-qualified function');
assert.match(migration, /p_departure_month < pg_catalog\.date_trunc\('month', pg_catalog\.now\(\) AT TIME ZONE 'Asia\/Jakarta'\)::date/);
assert.match(migration, /ESTIMATED_DEPARTURE_DATE_IN_PAST/);
assert.match(migration, /CONFIRMED_DEPARTURE_DATE_IN_PAST/);
assert.match(migration, /WHERE o\.remaining_amount_idr > 0/);
assert.match(migration, /o\.payment_status IS DISTINCT FROM 'PAID'/);
assert.match(migration, /p\.no_wa/);
assert.match(migration, /pending_verification_count integer/);
assert.match(migration, /b\.confirmed_departure_date - 45/);
assert.match(migration, /<= 45 THEN 'H45_FOLLOW_UP'/);
assert.match(migration, /<= 30 THEN 'H30_TARGET'/);
assert.match(migration, /<= 7 THEN 'H7_URGENT'/);
assert.match(migration, /payment_restriction_applies', false/);
assert.ok(!migration.includes('requires_full_settlement'), 'H-45 must not require full settlement');
assert.ok(!migration.includes('partial_installments_allowed'), 'H-45 helper must not replace payment amount validation');
assert.match(migration, /REVOKE ALL ON FUNCTION public\.kdj_admin_list_departure_h45_followups\(\) FROM PUBLIC, anon, authenticated/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.kdj_admin_list_departure_h45_followups\(\) TO service_role/);
assert.match(migration, /REVOKE ALL ON FUNCTION public\.kdj_get_nearest_departure_wave\(\) FROM PUBLIC, anon, authenticated/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.kdj_get_nearest_departure_wave\(\) TO service_role/);
assert.match(migration, /GRANT SELECT ON TABLE public\.kdj_departure_batches TO service_role/);
assert.ok(!migration.includes('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.kdj_departure_batches'), 'Service role must use audited mutation RPCs rather than direct table writes');
assert.match(aclMigration, /REVOKE ALL ON TABLE public\.kdj_departure_batches FROM service_role/);
assert.match(aclMigration, /REVOKE ALL ON TABLE public\.kdj_departure_batch_events FROM service_role/);
assert.match(aclMigration, /GRANT SELECT ON TABLE public\.kdj_departure_batches TO service_role/);
assert.match(aclMigration, /GRANT SELECT ON TABLE public\.kdj_departure_batch_events TO service_role/);

assert.match(api, /requireAdminSession/);
assert.match(api, /'Super Admin', 'Admin Verifikator', 'Admin Viewer'/);
assert.match(api, /KDJ_DEPARTURE_BATCH_FEATURE_ENABLED !== 'true'/);
assert.match(api, /supabase\.rpc\('kdj_admin_list_departure_h45_followups'\)/);
assert.match(api, /const \{ whatsapp, \.\.\.safeRow \} = row/);
assert.match(api, /phone_masked: maskPhone\(whatsapp\)/);
assert.ok(!api.includes('callWaBotApi'), 'Monitoring API must not send WhatsApp messages');
assert.ok(!/\.insert\s*\(|\.update\s*\(|\.delete\s*\(/.test(api), 'Monitoring endpoint must be read-only');

assert.match(panel, /hanya memulai pengingat dan monitoring, bukan batas akhir pembayaran/i);
assert.match(panel, /tetap boleh membayar sebagian setelah H-45/i);
assert.match(panel, /H-30 adalah target operasional umum/i);
assert.match(panel, /H-7/i);
assert.match(panel, /AWAITING_DATE_CONFIRMATION/);
assert.match(panel, /BATCH_NOT_ASSIGNED/);
assert.match(panel, /phone_masked/);

assert.match(access, /function canViewDeparturePayments/);
assert.match(adminPage, /setActiveTab\('departure-followups'\)/);
assert.match(adminPage, /activeTab === 'departure-followups' && canViewDeparturePayments\(adminUser\.role\) && <AdminDepartureFollowupPanel \/>/);

assert.match(batchApi, /requireAdminSession/);
assert.match(batchApi, /auth\.admin\?\.role !== 'Super Admin'/);
assert.match(batchApi, /KDJ_DEPARTURE_BATCH_FEATURE_ENABLED !== 'true'/);
for (const action of ['CREATE', 'UPDATE_ESTIMATE', 'CONFIRM_DATE', 'CHANGE_DATE', 'ASSIGN_ORDER']) {
    assert.ok(batchApi.includes(`'${action}'`), `Batch API must support ${action}`);
}
assert.match(batchApi, /kdj_admin_list_departure_h45_followups|kdj_departure_orders/);
assert.match(batchApi, /student_name: student\.nama_lengkap/);
assert.ok(!batchApi.includes(".gt('remaining_amount_idr', 0)"), 'Batch assignment must include fully paid orders too');
assert.ok(!/\.insert\s*\(|\.update\s*\(|\.delete\s*\(/.test(batchApi), 'Batch management API must use audited RPCs, not direct DML');
assert.match(batchPanel, /Buat Gelombang Baru/);
assert.match(batchPanel, /Perkiraan tanggal keberangkatan/);
assert.match(batchPanel, /Konfirmasi tanggal final/);
assert.match(batchPanel, /tanggal final terkonfirmasi/);
assert.match(batchApi, /currentJakartaDate/);
assert.match(batchApi, /currentJakartaMonthStart/);
assert.match(batchPanel, /Penempatan Order/);
assert.match(batchPanel, /Riwayat Gelombang/);
assert.match(adminPage, /setActiveTab\('departure-batches'\)/);
assert.match(adminPage, /activeTab === 'departure-batches' && adminUser\.role === 'Super Admin' && <AdminDepartureBatchPanel \/>/);

console.log('[PASS] H-45 remains follow-up-only; batch/date management and monitoring are RBAC-protected, audited, and payment-read-only.');
