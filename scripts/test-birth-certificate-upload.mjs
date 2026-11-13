import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const portalForm = read('app/page.js');
const uploadRoute = read('app/api/upload-dokumen/route.js');
const submitRoute = read('app/api/pendaftar/route.js');
const adminRoute = read('app/api/admin/pendaftar/route.js');
const adminPage = read('app/admin/page.js');
const knowledgeBase = read('..\\kdj-wa-bot\\prompts\\03_knowledge_base.md');

assert.match(portalForm, /id: 'akta_kelahiran'/, 'Portal must render an Akta Kelahiran upload slot.');
assert.match(portalForm, /uploadedDocs\['akta_kelahiran'\]/, 'Akta must be included in progress tracking.');
assert.match(portalForm, /const requiredDocs = \['pasfoto', 'ijazah', 'transkrip', 'akta_kelahiran'\]/, 'Client final submit must require Akta but allow deferred Passport.');
assert.doesNotMatch(portalForm, /const requiredDocs = \[[^\]]*'paspor'/, 'Passport must not block initial final submission.');
assert.match(portalForm, /Nomor Paspor \(opsional; lengkapi melalui Admin Human setelah pendaftaran, paling lambat H-45\)/, 'Passport number must be labelled as an Admin Human follow-up, not a Portal upload.');
assert.doesNotMatch(portalForm, /\{ id: 'paspor', title: 'Scan Halaman Identitas Paspor Aktif'/, 'Applicant Portal must not render a Passport upload tile.');
const progressBlock = portalForm.slice(portalForm.indexOf('const calculateProgress'), portalForm.indexOf('const handleRequestOtp'));
assert.doesNotMatch(progressBlock, /formData\.no_paspor|uploadedDocs\['paspor'\]/, 'Optional passport data must not block initial progress completion.');

assert.match(uploadRoute, /'akta_kelahiran'/, 'Upload API must allow Akta Kelahiran.');
assert.match(uploadRoute, /const ALLOWED_DOC_TYPES = \['pasfoto', 'ijazah', 'transkrip', 'akta_kelahiran', 'bukti_bayar'\]/, 'Applicant upload API must not accept Passport files.');
assert.match(uploadRoute, /const isAkademik = \['pasfoto', 'paspor', 'ijazah', 'transkrip', 'akta_kelahiran'\]/, 'Existing Admin/legacy Passport documents must remain retrievable.');
assert.match(submitRoute, /const requiredDocs = \['pasfoto', 'ijazah', 'transkrip', 'akta_kelahiran'\]/, 'Server final submit must enforce Akta but not Passport.');
assert.doesNotMatch(submitRoute, /const requiredDocs = \[[^\]]*'paspor'/, 'Server must not require Passport at initial submit.');
const finalSubmitBlock = submitRoute.slice(submitRoute.indexOf('if (is_final_submit === true) {'));
assert.doesNotMatch(finalSubmitBlock, /!cleanPaspor/, 'Passport number must not block the initial final submit.');
assert.match(uploadRoute, /const isAkademik = \['pasfoto', 'paspor', 'ijazah', 'transkrip', 'akta_kelahiran'\]/, 'Admin retrieval must continue to sign legacy Passport and Akta documents.');

assert.match(adminRoute, /'pasfoto', 'paspor', 'ijazah', 'transkrip', 'akta_kelahiran'/, 'Admin API must include Akta in academic document review.');
assert.match(adminPage, /\['pasfoto', 'ijazah', 'transkrip', 'akta_kelahiran'\]\.includes\(doc\.jenis_dokumen\)\)\.length\} \/ 4/, 'Admin document count must count only the four Portal upload slots.');

assert.match(knowledgeBase, /Akta Kelahiran/i, 'Bot KB must include Akta Kelahiran.');
assert.match(knowledgeBase, /H-45/i, 'Bot KB must preserve the H-45 passport deferral rule.');

console.log('PASS: Akta Kelahiran is visible, uploadable, reviewable, and required at initial final submission.');
console.log('PASS: Passport is not shown as a Portal upload and is not a blocker for initial final submission.');
console.log('PASS: Bot KB documents the Akta Kelahiran requirement and passport H-45 exception.');
