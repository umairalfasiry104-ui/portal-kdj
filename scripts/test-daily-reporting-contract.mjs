import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const migration = read('supabase/migrations/20261110083515_kdj_bot_daily_reporting_20261109.sql');
assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.kdj_bot_activity_events/);
assert.match(migration, /event_key text NOT NULL UNIQUE/);
assert.match(migration, /event_key ~ '\^\[0-9a-f\]\{64\}\$'/);
assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
assert.match(migration, /FROM PUBLIC, anon, authenticated/);
assert.match(migration, /SECURITY DEFINER[\s\S]*SET search_path = ''/);
assert.match(migration, /kdj_get_bot_daily_report_stats/);
assert.match(migration, /UPDATE public\.kdj_bot_reporting_config[\s\S]*ledger_enabled_at = v_occurred_at/);
assert.match(migration, /FROM public\.pendaftar[\s\S]*chat_handler::text = 'HUMAN'/);
assert.doesNotMatch(migration, /phone_local|recipient_phone|message_body|message_text|raw_message/i);

const route = read('app/api/admin/reports/daily/route.js');
assert.match(route, /requireAdminSession/);
assert.match(route, /\['Super Admin', 'Admin Konsultan'/);
assert.match(route, /kdj_get_bot_daily_report_stats/);
assert.match(route, /Asia\/Jakarta/);
assert.match(route, /DAILY_REPORT_NOT_READY/);
assert.match(route, /data historis/);
assert.doesNotMatch(route, /fetch\(['"]\/notify|sendMessage|callWaBotApi/);

const panel = read('app/admin/components/AdminDailyReportPanel.jsx');
assert.match(panel, /Generate \/ Refresh Report/);
assert.match(panel, /Salin untuk Human/);
assert.match(panel, /navigator\.clipboard\.writeText/);
assert.match(panel, /useRef\(null\)/, 'The report date input must use an uncontrolled ref.');
assert.match(panel, /reportDateRef\.current\.value = todayInJakarta\(\)/, 'The WIB date must initialize after mount without render-time Date access.');
assert.match(panel, /encodeURIComponent\(selectedDate\)/, 'The API must use the date read from the input ref.');
assert.match(panel, /Tidak ada auto-send/);
assert.doesNotMatch(panel, /\/api\/.*notify|sendMessage|callWaBotApi/);

const adminPage = read('app/admin/page.js');
assert.match(adminPage, /AdminDailyReportPanel/);
assert.match(adminPage, /daily-report/);
console.log('PASS: Daily report uses a restricted, metadata-only event ledger and manual Portal generation.');
