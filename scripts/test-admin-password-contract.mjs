import assert from 'node:assert/strict';
import {
  hashAdminPassword,
  verifyAdminPassword,
  isValidAdminPassword
} from '../lib/admin-password.mjs';

const password = 'KDJ-Test-Password-2026-Strong!';
const otherPassword = 'KDJ-Another-Password-2026-Strong!';

assert.equal(isValidAdminPassword(password), true);
assert.equal(isValidAdminPassword('short'), false);
assert.equal(isValidAdminPassword('x'.repeat(129)), false);

const hash = await hashAdminPassword(password);
assert.match(hash, /^kdj\$scrypt\$131072\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
assert.equal(await verifyAdminPassword(password, hash), true);
assert.equal(await verifyAdminPassword(otherPassword, hash), false);
assert.equal(await verifyAdminPassword(password, null), false);
assert.equal(await verifyAdminPassword('', hash), false);

const secondHash = await hashAdminPassword(password);
assert.notEqual(secondHash, hash, 'Each password hash must use a unique salt');
assert.equal(await verifyAdminPassword(password, secondHash), true);

console.log('PASS: Admin password policy, scrypt hashing, verification, wrong-password rejection, and unique salts.');
