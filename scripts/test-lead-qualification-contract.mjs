import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getQualificationSnapshot, groupQualificationEvents } from '../lib/lead-qualification-summary.mjs';
const migration=fs.readFileSync(new URL('../supabase/migrations/20261109133525_kdj_lead_qualification_fu_final_20261109.sql',import.meta.url),'utf8');
const route=fs.readFileSync(new URL('../app/api/admin/lead-qualification/route.js',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('../app/admin/components/AdminLeadQualificationPanel.jsx',import.meta.url),'utf8');
assert.match(migration,/sequence_status='AWAITING_IDLE'/);
assert.match(migration,/interval '30 minutes'/);
assert.match(migration,/confirmed_category<>'DINGIN'/);
assert.match(migration,/,'HELD_COMPLIANCE','WHATSAPP_COMPLIANCE_GATE'/);
assert.match(migration,/delivery_enabled=false/);
assert.match(migration,/kdj_record_followup_inbound/);
assert.match(migration,/kdj_evaluate_followup_eligibility/);
assert.match(route,/Super Admin', 'Admin Konsultan'/);
assert.match(route,/kdj_admin_set_lead_qualification/);
assert.match(ui,/Simpan Keputusan Admin/);
assert.match(ui,/DINGIN/);
console.log('PASS: Lead qualification + FU schema/API/UI safety contract.');

assert.match(migration, /INVALIDATED_BY_INBOUND/);
assert.match(migration, /LEAD_QUALIFICATION_STALE_INBOUND/);
assert.match(route, /p_expected_sequence_id/);
assert.match(migration, /p_expected_sequence_id uuid/);

const adminSnapshot = getQualificationSnapshot({
  qualification_status: 'CONFIRMED',
  confirmed_category: 'PROSPEK',
  confirmed_operational_status: 'NORMAL',
  confirmed_at: '2026-11-18T08:00:00.000Z',
  recommendation_category: 'DINGIN',
  recommendation_operational_status: 'MASIH_BERTANYA',
  recommended_at: '2026-11-18T09:00:00.000Z',
});
assert.equal(adminSnapshot.actor_type, 'ADMIN');
assert.equal(adminSnapshot.category, 'PROSPEK');

const botSnapshot = getQualificationSnapshot({
  qualification_status: 'PENDING_REVIEW',
  recommendation_category: 'BIMBANG',
  recommendation_operational_status: 'MASIH_BERTANYA',
  recommended_at: '2026-11-18T10:00:00.000Z',
});
assert.equal(botSnapshot.actor_type, 'BOT');
assert.equal(botSnapshot.category, 'BIMBANG');
assert.match(botSnapshot.status_note, /belum menjadi keputusan final Admin/i);

const invalidatedSnapshot = getQualificationSnapshot({
  qualification_status: 'PENDING_REVIEW',
  recommendation_category: 'UNCLASSIFIED',
  recommended_at: null,
  confirmed_category: null,
  updated_at: '2026-11-18T11:00:00.000Z',
});
assert.equal(invalidatedSnapshot.actor_type, null);
assert.equal(invalidatedSnapshot.category, 'UNCLASSIFIED');
assert.equal(invalidatedSnapshot.status_at, '2026-11-18T11:00:00.000Z');

const groupedEvents = groupQualificationEvents([
  { id: 'e2', qualification_id: 'q1', created_at: '2026-11-18T10:00:00.000Z' },
  { id: 'e3', qualification_id: 'q2', created_at: '2026-11-18T12:00:00.000Z' },
  { id: 'e1', qualification_id: 'q1', created_at: '2026-11-18T09:00:00.000Z' },
  { id: 'ignored', created_at: '2026-11-18T13:00:00.000Z' },
]);
assert.equal(groupedEvents.size, 2);
assert.deepEqual(groupedEvents.get('q1').map((event) => event.id), ['e2', 'e1']);
console.log('PASS: One current status per account, Admin/Bot precedence, inbound invalidation and grouped activity history.');
