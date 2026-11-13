import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(resolve(root, ...parts), 'utf8');

const recoveryRoute = read('app', 'api', 'admin', 'daily-report', 'recovery', 'route.js');
const reportPanel = read('app', 'admin', 'components', 'AdminDailyReportPanel.jsx');
const adminPage = read('app', 'admin', 'page.js');
const reportMigration = read('supabase', 'migrations', '20261112132807_kdj_daily_admin_reports_v2.sql');

assert.match(recoveryRoute, /requireAdminSession\(req\)/);
assert.match(recoveryRoute, /auth\.admin\?\.role !== 'Super Admin'/);
assert.match(recoveryRoute, /\.in\('status', \['FAILED', 'UNKNOWN'\]\)/);
assert.match(recoveryRoute, /maskPhone\(row\.recipient_phone\)/);
assert.match(recoveryRoute, /replace\(\/\[\^0-9\]\/g/);
assert.match(recoveryRoute, /digits\.slice\(-4\)/);
assert.doesNotMatch(recoveryRoute, /recipient_phone:\s*row\.recipient_phone/);
assert.match(recoveryRoute, /kdj_admin_retry_failed_daily_report_delivery/);
assert.match(recoveryRoute, /kdj_admin_reconcile_daily_report_delivery/);
assert.match(recoveryRoute, /p_actor_admin_id:\s*auth\.admin\.id/);
assert.doesNotMatch(recoveryRoute, /body\.actor_admin_id|body\.admin_id/);
assert.match(recoveryRoute, /body\.confirmed_no_message !== true/);
assert.match(recoveryRoute, /UNKNOWN_REQUIRES_EXPLICIT_CONFIRMATION/);
assert.match(recoveryRoute, /provider_message_id/);
assert.match(recoveryRoute, /resolution === 'SENT'/);

const failedReconcileRpc = recoveryRoute.match(/if \(resolution === 'FAILED'[\s\S]*?rpcArgs = \{([\s\S]*?)\n        \};/)?.[1] || '';
assert.match(failedReconcileRpc, /p_resolution: resolution/);
assert.match(failedReconcileRpc, /p_provider_message_id: resolution === 'SENT' \? providerMessageId : null/);

assert.match(reportMigration, /kdj_admin_retry_failed_daily_report_delivery/);
assert.match(reportMigration, /ONLY_PROVEN_FAILED_REPORT_MAY_BE_RETRIED/);
assert.match(reportMigration, /kdj_admin_reconcile_daily_report_delivery/);
assert.match(reportMigration, /REPORT_DELIVERY_NOT_UNKNOWN/);

assert.match(reportPanel, /isSuperAdmin && \(/);
assert.match(reportPanel, /RECONCILE_UNKNOWN_SENT/);
assert.match(reportPanel, /RECONCILE_UNKNOWN_FAILED/);
assert.match(reportPanel, /window\.confirm\(/);
assert.match(reportPanel, /RETRY_FAILED/);
assert.match(reportPanel, /Delivery kembali ke antrean PENDING/);
assert.match(reportPanel, /bukan pengiriman langsung/);
assert.match(adminPage, /<AdminDailyReportPanel isSuperAdmin=\{adminUser\.role === 'Super Admin'\} \/>/);

console.log('PASS: recovery API is Super Admin-only and derives the actor identity from the authenticated session.');
console.log('PASS: recovery list exposes masked recipient numbers only.');
console.log('PASS: FAILED retry and UNKNOWN reconciliation use separate database RPCs.');
console.log('PASS: UNKNOWN to FAILED requires explicit confirmation; UNKNOWN is never directly retried.');
console.log('PASS: recovery controls are rendered only for Super Admin.');
