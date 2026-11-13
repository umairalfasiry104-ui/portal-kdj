import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const source = fs.readFileSync(path.join(repoRoot, 'app', 'page.js'), 'utf8');

assert.match(source, /Bank Syariah Indonesia \(BSI\)/);
assert.match(
    source,
    /Nomor Rekening:[\s\S]{0,240}>7169735128<\/strong>/,
    'Portal must display the owner-confirmed BSI account number.'
);
assert.match(
    source,
    /Atas Nama:[\s\S]{0,240}>Yayasan Generasi Cerdas Akhlakul Karimah<\/strong>/,
    'Portal must display the owner-confirmed legal account holder.'
);
assert.doesNotMatch(
    source,
    /7123456789|BSI 7169735128 a\.n\. Kuliah di Jordan Official/,
    'Legacy or unapproved bank details must not return to the Portal payment copy.'
);

console.log('[PASS] Portal payment bank and account-holder details match the owner confirmation.');
