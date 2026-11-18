import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20261028000000_kdj_foundation_tables.sql', import.meta.url),
  'utf8'
);
const route = fs.readFileSync(
  new URL('../app/api/upload-dokumen/route.js', import.meta.url),
  'utf8'
);

const documentTable = migration.match(
  /CREATE TABLE public\.dokumen_pendaftar\s*\(([\s\S]*?)\n\);/i
)?.[1];

assert.ok(documentTable, 'dokumen_pendaftar table definition must exist in the foundation migration.');

for (const column of ['pendaftar_id', 'jenis_dokumen', 'file_path', 'status_dokumen']) {
  assert.match(
    documentTable,
    new RegExp('^\\s*' + column + '\\s+', 'm'),
    'dokumen_pendaftar must define ' + column
  );
}

assert.doesNotMatch(
  documentTable,
  /^\s*no_wa\s+/m,
  'dokumen_pendaftar ownership must use pendaftar_id, not a duplicated no_wa column.'
);
assert.match(
  documentTable,
  /UNIQUE\s*\(\s*pendaftar_id\s*,\s*jenis_dokumen\s*,\s*file_path\s*\)/i,
  'Document version uniqueness must include file_path.'
);

const insertStart = route.indexOf(".from('dokumen_pendaftar')", route.indexOf('// dokumen_pendaftar stores ownership'));
const insertEnd = route.indexOf("if (docError)", insertStart);
assert.ok(insertStart >= 0 && insertEnd > insertStart, 'Document insert block must exist.');
const insertBlock = route.slice(insertStart, insertEnd);

assert.match(insertBlock, /\.insert\s*\(/, 'Document uploads must INSERT a new version.');
assert.doesNotMatch(insertBlock, /\.upsert\s*\(/, 'Do not upsert against a non-existent two-column conflict target.');
assert.match(insertBlock, /pendaftar_id:\s*pendaftar\.id/, 'Document record must link to the authenticated applicant id.');
assert.match(insertBlock, /jenis_dokumen\s*,/, 'Document record must include its type.');
assert.match(insertBlock, /file_path:\s*safeObjectPath/, 'Document record must include the uploaded object path.');
assert.doesNotMatch(insertBlock, /no_wa\s*:/, 'Do not send no_wa to dokumen_pendaftar.');

assert.match(
  route,
  /\.eq\('pendaftar_id',\s*pendaftar\.id\)[\s\S]{0,180}\.order\('created_at',\s*\{\s*ascending:\s*true\s*\}\)/,
  'GET document list must be ordered oldest-to-newest so the newest version is applied last by the client.'
);

assert.match(
  route,
  /no_wa_orang_tua_wali,\s*nominal_tagihan/,
  'Customer GET selection must include nominal_tagihan used by the legacy payment fallback.'
);

console.log('PASS: document upload payload matches the database schema, preserves versioned uploads, and returns latest document last.');
