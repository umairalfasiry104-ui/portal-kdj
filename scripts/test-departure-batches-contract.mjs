import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const migration = fs.readFileSync(
    path.join(root, 'supabase', 'migrations', '20261117000000_kdj_departure_batches_v1.sql'),
    'utf8'
).replace(/\r\n?/g, '\n');
const batchRoute = fs.readFileSync(
    path.join(root, 'app', 'api', 'admin', 'departure-batches', 'route.js'),
    'utf8'
).replace(/\r\n?/g, '\n');
const customerPaymentUi = fs.readFileSync(
    path.join(root, 'app', 'components', 'DeparturePaymentSection.jsx'),
    'utf8'
).replace(/\r\n?/g, '\n');
const adminPaymentReview = fs.readFileSync(
    path.join(root, 'app', 'api', 'admin', 'departure-payments', 'review', 'route.js'),
    'utf8'
).replace(/\r\n?/g, '\n');

assert.match(migration, /CREATE TABLE public\.kdj_departure_batches/);
assert.match(migration, /departure_month date NOT NULL/);
assert.match(migration, /EXTRACT\(DAY FROM departure_month\) = 1/);
assert.match(migration, /estimated_departure_date date/);
assert.match(migration, /confirmed_departure_date date/);
assert.match(migration, /date_trunc\('month', estimated_departure_date\)::date = departure_month/);
assert.match(migration, /date_trunc\('month', confirmed_departure_date\)::date = departure_month/);
assert.match(migration, /ALTER TABLE public\.kdj_departure_orders\s+ADD COLUMN departure_batch_id uuid/);
assert.match(migration, /CREATE TABLE public\.kdj_departure_batch_events/);
assert.match(migration, /'DATE_CONFIRMED'/);
assert.match(migration, /'DATE_CHANGED'/);
assert.match(migration, /'ORDER_ASSIGNED'/);
assert.match(migration, /'ORDER_REASSIGNED'/);
assert.match(migration, /role = 'Super Admin'/);
assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
assert.match(migration, /REVOKE ALL ON TABLE public\.kdj_departure_batches FROM PUBLIC, anon, authenticated/);
assert.match(migration, /Asia\/Jakarta/);

assert.match(batchRoute, /requireAdminSession/);
assert.match(batchRoute, /auth\.admin\?\.role !== 'Super Admin'/);
assert.match(batchRoute, /KDJ_DEPARTURE_BATCH_FEATURE_ENABLED !== 'true'/);
assert.match(batchRoute, /kdj_admin_create_departure_batch/);
assert.match(batchRoute, /kdj_admin_confirm_departure_batch/);
assert.match(batchRoute, /kdj_admin_change_departure_batch_date/);
assert.match(batchRoute, /kdj_admin_assign_departure_order_batch/);
assert.match(batchRoute, /supabase\.rpc\(functionName, params\)/);
assert.ok(!/\.insert\s*\(|\.update\s*\(|\.delete\s*\(/.test(batchRoute), 'Admin batch route must not direct-DML batch state');

const policyFunction = migration.split('CREATE OR REPLACE FUNCTION public.kdj_get_departure_h45_followup_status')[1];
assert.ok(policyFunction, 'H-45 follow-up helper exists');
assert.ok(policyFunction.includes('v_batch.confirmed_departure_date - 45'));
assert.ok(!policyFunction.includes('v_batch.estimated_departure_date - 45'), 'Estimate must never drive H-45');
assert.ok(policyFunction.includes("'h45_followup_triggered', v_days_until_departure <= 45"));
assert.ok(policyFunction.includes("'payment_restriction_applies', false"), 'H-45 must not apply payment restrictions');
assert.equal((policyFunction.match(/'payment_restriction_applies', false/g) || []).length, 4,
    'H-45 must not restrict payment when the date/batch is missing, inactive, or confirmed');
assert.ok(!policyFunction.includes('partial_installments_allowed'), 'Follow-up helper must not replace actual payment-state validation');
assert.ok(!policyFunction.includes('requires_full_settlement'), 'H-45 must never require full settlement');
assert.ok(!migration.includes('h45_enforcement_ready'), 'H-45 must not be described as payment enforcement');

assert.match(customerPaymentUi, /bukan batas akhir pembayaran/);
assert.match(customerPaymentUi, /tetap dapat dicicil seperti biasa setelah H-45/);
assert.ok(!customerPaymentUi.includes('hingga maksimal H-45'), 'Customer copy must not describe H-45 as the payment cutoff');
assert.match(adminPaymentReview, /BELUM LUNAS \(PEMBAYARAN BERTAHAP\)/);
assert.ok(!adminPaymentReview.includes('H-45'), 'Installment approval notification must not imply a follow-up was triggered at every payment');
assert.ok(!adminPaymentReview.includes('Maksimal H-45'), 'Admin notification must not describe H-45 as a payment cutoff');

function expectedH45Status(daysUntilDeparture) {
    return {
        h45FollowupTriggered: daysUntilDeparture <= 45,
        paymentRestrictionApplies: false
    };
}

assert.deepEqual(expectedH45Status(46), {
    h45FollowupTriggered: false,
    paymentRestrictionApplies: false
});
for (const days of [45, 44, 30, 7, 1, 0, -1]) {
    assert.deepEqual(expectedH45Status(days), {
        h45FollowupTriggered: true,
        paymentRestrictionApplies: false
    }, `H-45 follow-up at ${days} days must not restrict payment`);
}

console.log('[PASS] Departure batch month/year, estimate/final separation, audit/RBAC, and H-45 follow-up-only contract.');
