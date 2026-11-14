import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n?/g, '\n');

const page = read('app', 'page.js');
const saveApi = read('app', 'api', 'pendaftar', 'route.js');
const otpApi = read('app', 'api', 'auth', 'verify-otp', 'route.js');
const uploadApi = read('app', 'api', 'upload-dokumen', 'route.js');
const adminApi = read('app', 'api', 'admin', 'pendaftar', 'route.js');
const adminPage = read('app', 'admin', 'page.js');
const security = read('lib', 'security.js');
const migration = read('supabase', 'migrations', '20261111032449_add_parent_guardian_contact_fields.sql');
const cr = read('docs', 'change-control', 'CR-CIR_KDJ_PARENT_GUARDIAN_CONTACT_v1.0.md');

const start = security.indexOf('export function normalizePhoneLocal(');
assert.ok(start >= 0, 'normalizePhoneLocal helper must exist');
const end = security.indexOf('/**\n * Menghasilkan kandidat nomor lokal', start);
assert.ok(end > start, 'normalizePhoneLocal end marker must exist');
const normalizeSource = security.slice(start, end).trim().replace(/^export\s+/gm, '');
const normalizePhoneLocal = new Function(normalizeSource + '\nreturn normalizePhoneLocal;')();

assert.equal(normalizePhoneLocal('081234567890'), '081234567890');
assert.equal(normalizePhoneLocal('+62 812-3456-7890'), '081234567890');
assert.equal(normalizePhoneLocal('62 81234567890'), '081234567890');
assert.equal(normalizePhoneLocal('12345'), null);
assert.equal(normalizePhoneLocal('+1 415 555 0100'), null);
console.log('[PASS] Guardian WhatsApp normalization.');

assert.ok(page.includes("nama_orang_tua_wali: ''"));
assert.ok(page.includes("no_wa_orang_tua_wali: ''"));
assert.ok(page.includes('Nama Orang Tua/Wali <span className="text-red-500">*</span>'));
assert.ok(page.includes('Nomor WhatsApp Orang Tua/Wali <span className="text-red-500">*</span>'));
assert.ok(page.includes('value={formData.nama_orang_tua_wali}'));
assert.ok(page.includes('value={formData.no_wa_orang_tua_wali}'));
for (const key of ['nama_orang_tua_wali', 'no_wa_orang_tua_wali']) {
  assert.ok(page.includes('parsed.' + key + " || ''"), key + ' saved-session hydration');
  assert.ok(page.includes('data.user.' + key + " || ''"), key + ' OTP hydration');
  assert.ok(page.includes('data.pendaftar.' + key + " || ''"), key + ' DB refresh hydration');
}
const progressStart = page.indexOf('const calculateProgress =');
const progressEnd = page.indexOf('const handleRequestOtp', progressStart);
const progressBlock = page.slice(progressStart, progressEnd);
assert.ok(progressBlock.includes('formData.nama_orang_tua_wali'));
assert.ok(progressBlock.includes('formData.no_wa_orang_tua_wali'));
console.log('[PASS] Applicant UI, state hydration and mandatory progress behavior.');

const requiredStart = saveApi.indexOf('const requiredFields = [');
const requiredEnd = saveApi.indexOf('];', requiredStart);
assert.ok(requiredStart >= 0 && requiredEnd > requiredStart);
const requiredFields = saveApi.slice(requiredStart, requiredEnd);
assert.ok(requiredFields.includes('nama_orang_tua_wali'));
assert.ok(requiredFields.includes('no_wa_orang_tua_wali'));
assert.ok(saveApi.includes("const hasParentName = Object.prototype.hasOwnProperty.call(body, 'nama_orang_tua_wali')"));
assert.ok(saveApi.includes("const hasParentPhone = Object.prototype.hasOwnProperty.call(body, 'no_wa_orang_tua_wali')"));
assert.ok(saveApi.includes('normalizePhoneLocal(rawParentPhone)'));
assert.ok(saveApi.includes('nama_orang_tua_wali: cleanParentName'));
assert.ok(saveApi.includes('no_wa_orang_tua_wali: cleanParentPhone'));
assert.ok(saveApi.includes("'nama_orang_tua_wali',\n    'no_wa_orang_tua_wali'"));
const botNotifyStart = saveApi.lastIndexOf('callWaBotApi(');
const botNotifyBlock = saveApi.slice(botNotifyStart);
assert.ok(!botNotifyBlock.includes('nama_orang_tua_wali'));
assert.ok(!botNotifyBlock.includes('no_wa_orang_tua_wali'));
console.log('[PASS] Applicant save API, mandatory enforcement and Bot data minimization.');

for (const key of ['nama_orang_tua_wali', 'no_wa_orang_tua_wali']) {
  assert.ok(otpApi.includes("'" + key + "'"), 'OTP customer DTO selects ' + key);
  assert.ok(otpApi.includes(key + ': record.' + key + ' ?? null'), 'OTP customer DTO returns ' + key);
  assert.ok(uploadApi.includes(key), 'Applicant refresh API includes ' + key);
}
assert.ok(uploadApi.includes('const pendaftarColumns = userSession'));
console.log('[PASS] OTP and applicant-only refresh DTOs.');

const adminDtoStart = adminApi.indexOf('function toAdminPendaftarDto');
const adminDtoEnd = adminApi.indexOf('export async function GET', adminDtoStart);
const adminDto = adminApi.slice(adminDtoStart, adminDtoEnd);
const verificationStart = adminDto.indexOf('if (canReadVerification)');
const financeStart = adminDto.indexOf('if (canReadFinance)', verificationStart);
const verificationDto = adminDto.slice(verificationStart, financeStart);
assert.ok(verificationDto.includes('nama_orang_tua_wali'));
assert.ok(verificationDto.includes('no_wa_orang_tua_wali'));
assert.ok(!adminDto.slice(0, verificationStart).includes('no_wa_orang_tua_wali'));
assert.ok(adminApi.includes('nama_orang_tua_wali, no_wa_orang_tua_wali'));
assert.ok(adminPage.includes('Nama Orang Tua/Wali'));
assert.ok(adminPage.includes('Nomor WhatsApp Orang Tua/Wali'));
console.log('[PASS] Admin API RBAC boundary and Admin detail display.');

assert.ok(migration.includes('ADD COLUMN nama_orang_tua_wali varchar(150)'));
assert.ok(migration.includes('ADD COLUMN no_wa_orang_tua_wali varchar(20)'));
assert.ok(migration.includes('pendaftar_parent_guardian_wa_local_check'));
assert.ok(cr.includes('Production deployment is not authorized'));
assert.ok(cr.includes('Do not include these fields in the Bot notification payload'));
console.log('[PASS] Migration and CR/CIR documentation.');

console.log('Parent/guardian contact field contract test: PASS');
