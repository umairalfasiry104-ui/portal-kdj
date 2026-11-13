import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const migration = read('docs/database/migration-source-archive/2026-11-12/20261108_kdj_monitoring_followup_foundation.sql');
const systemApi = read('app/api/admin/system/route.js');
const followupApi = read('app/api/admin/followups/route.js');
const consentApi = read('app/api/followups/consent/route.js');
const bot = fs.readFileSync(path.resolve(root, '../kdj-wa-bot/index.js'), 'utf8');
const botMessageHandler = fs.readFileSync(path.resolve(root, '../kdj-wa-bot/lib/whatsapp/message-handler.js'), 'utf8');
const systemOps = fs.readFileSync(path.resolve(root, '../kdj-wa-bot/lib/system-ops.js'), 'utf8');
const adminPage = read('app/admin/page.js');
const followupPanel = read('app/admin/components/AdminFollowupsPanel.jsx');
const monitoringPanel = read('app/admin/components/AdminSystemPanel.jsx');
const publicPage = read('app/page.js');

assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.kdj_system_heartbeats/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.kdj_system_incidents/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.kdj_followup_jobs/);
assert.match(migration, /delivery_enabled boolean NOT NULL DEFAULT false/);
assert.match(migration, /compliance_status text NOT NULL DEFAULT 'BLOCKED'/);
assert.match(migration, /'HELD_COMPLIANCE'/);
assert.match(migration, /trg_kdj_cancel_fu_on_human_handover/);
assert.match(migration, /trg_kdj_cancel_fu_on_active_booking/);
assert.match(migration, /ALTER TABLE public\.kdj_followup_control_events ENABLE ROW LEVEL SECURITY/);
assert.match(migration, /delivery_enabled = false OR/);
assert.match(migration, /kdj_admin_stop_followup/);
assert.match(migration, /kdj_record_followup_inbound/);
assert.match(migration, /REVOKE ALL ON FUNCTION public\.kdj_record_followup_inbound[^;]+FROM PUBLIC, anon, authenticated/);

assert.match(systemApi, /auth\.admin\.role !== 'Super Admin'/);
assert.match(systemApi, /kdj_record_system_heartbeat/);
assert.match(systemApi, /kdj_update_system_incident/);
assert.match(followupApi, /auth\.admin\.role !== 'Super Admin'/);
assert.match(followupApi, /kdj_admin_stop_followup/);
assert.match(consentApi, /getUserSession/);
assert.match(consentApi, /kdj_set_followup_consent/);
assert.match(bot, /recordFollowupInbound/);
assert.match(bot, /startBotSystemHeartbeats/);
assert.match(botMessageHandler, /'gemini'/);
assert.match(systemOps, /kdj_record_followup_inbound/);
assert.match(systemOps, /kdj_set_followup_consent/);
assert.match(adminPage, /AdminSystemPanel/);
assert.match(adminPage, /AdminFollowupsPanel/);
assert.match(followupPanel, /Stop FU/);
assert.match(monitoringPanel, /Incident Operasional/);
assert.match(publicPage, /Saya bersedia menerima pesan tindak lanjut/);
assert.match(publicPage, /Tidak dicentang secara default/);

console.log('PASS: monitoring/FU schema, role gates, lifecycle cancellation, consent, and UI integration contracts.');
