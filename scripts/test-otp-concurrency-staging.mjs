import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import nextEnv from '@next/env';
const { loadEnvConfig } = nextEnv;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnvConfig(root);

function getSessionSecret() {
    const explicitSecret = process.env.SESSION_SECRET;
    if (explicitSecret && explicitSecret.length >= 32) return explicitSecret;

    const fallbackKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!fallbackKey) throw new Error('Required server auth configuration is missing.');

    return crypto
        .createHmac('sha256', 'kdj-portal-session-key-v1')
        .update(fallbackKey)
        .digest('hex');
}

function throttleHash(scope, identifier) {
    return crypto
        .createHmac('sha256', getSessionSecret())
        .update(scope + String.fromCharCode(0) + identifier, 'utf8')
        .digest('hex');
}

function createStagingClient() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !serviceKey) {
        throw new Error('Required Supabase server configuration is missing.');
    }
    if (!url.includes('pgmdurnylyuqkikbwwwy')) {
        throw new Error('Safety stop: configured Supabase target is not the approved Staging project.');
    }

    return createClient(url, serviceKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false
        },
        global: {
            headers: { 'x-client-info': 'kdj-otp-concurrency-staging-test' }
        }
    });
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWorker(payload) {
    const client = createStagingClient();
    const actualHash = throttleHash(payload.scope, payload.identifier);
    const startDelay = Math.max(0, payload.startAt - Date.now());
    await sleep(startDelay);

    let results;
    if (payload.operation === 'rate-limit') {
        results = await Promise.all(Array.from({ length: payload.calls }, async () => {
            const { data, error } = await client.rpc('kdj_auth_rate_limit_consume', {
                p_key_hash: actualHash,
                p_max_requests: payload.maxRequests,
                p_window_seconds: payload.windowSeconds
            });
            if (error) throw new Error('rate-limit RPC failed: ' + (error.code || 'DB_ERROR'));
            return data;
        }));
    } else if (payload.operation === 'otp-request') {
        results = await Promise.all(Array.from({ length: payload.calls }, async () => {
            const otp = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
            const { data, error } = await client.rpc('kdj_otp_request_atomic', {
                p_phone_local: payload.phone,
                p_otp: otp,
                p_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
                p_key_hash: actualHash
            });
            if (error) throw new Error('OTP request RPC failed: ' + (error.code || 'DB_ERROR'));
            return data;
        }));
    } else if (payload.operation === 'auth-failure') {
        results = await Promise.all(Array.from({ length: payload.calls }, async () => {
            const { data, error } = await client.rpc('kdj_auth_lock_record_failure', {
                p_key_hash: actualHash,
                p_max_failures: payload.maxFailures,
                p_window_seconds: payload.windowSeconds
            });
            if (error) throw new Error('auth lock RPC failed: ' + (error.code || 'DB_ERROR'));
            return data;
        }));
    } else {
        throw new Error('Unknown concurrency test operation.');
    }

    return { hash: actualHash, results };
}

function runChild(payload) {
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const scriptPath = fileURLToPath(import.meta.url);

    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [scriptPath, '--worker', encoded], {
            cwd: root,
            env: process.env,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('error', reject);
        child.on('close', (code) => {
            const line = stdout.split(/\r?\n/).find((item) => item.startsWith('__KDJ_RESULT__'));
            if (code !== 0 || !line) {
                reject(new Error('Concurrency worker failed (exit ' + code + '). ' + stderr.slice(-1200)));
                return;
            }
            try {
                resolve(JSON.parse(line.slice('__KDJ_RESULT__'.length)));
            } catch {
                reject(new Error('Concurrency worker returned an unreadable result.'));
            }
        });
    });
}

async function runTwoProcesses(operation, commonPayload) {
    const startAt = Date.now() + 3000;
    const payload = { ...commonPayload, operation, startAt };
    const [workerA, workerB] = await Promise.all([
        runChild({ ...payload, workerId: 'A' }),
        runChild({ ...payload, workerId: 'B' })
    ]);

    assert.equal(workerA.hash, workerB.hash, 'Separate processes derived different HMAC throttle keys.');
    assert.equal(workerA.hash, throttleHash(payload.scope, payload.identifier), 'Worker HMAC did not match this Portal process.');

    return [...workerA.results, ...workerB.results];
}

async function main() {
    const client = createStagingClient();
    const testId = crypto.randomUUID();
    const phone = '08' + crypto.randomInt(1000000000, 2000000000).toString();

    const rateScope = 'p1-otp-concurrency-rate';
    const rateIdentifier = 'staging-test:' + testId;
    const otpScope = 'customer-otp';
    const lockScope = 'p1-otp-concurrency-lock';
    const lockIdentifier = 'staging-test:' + testId;

    const cleanup = {
        phone,
        keyHashes: [
            throttleHash(rateScope, rateIdentifier),
            throttleHash(otpScope, phone),
            throttleHash(lockScope, lockIdentifier)
        ]
    };

    // Safe cleanup selectors are printed before the first write so they remain available on test failure.
    console.log('[CLEANUP] synthetic_phone=' + cleanup.phone);
    console.log('[CLEANUP] throttle_key_hashes=' + cleanup.keyHashes.join(','));
    console.log('[TARGET] Supabase Staging ref confirmed: pgmdurnylyuqkikbwwwy');
    console.log('[METHOD] Two independent Node.js worker processes; each process fires concurrent Supabase RPC requests.');

    const rateResults = await runTwoProcesses('rate-limit', {
        scope: rateScope,
        identifier: rateIdentifier,
        calls: 6,
        maxRequests: 4,
        windowSeconds: 600
    });
    const rateAllowed = rateResults.filter((item) => item?.allowed === true).length;
    const rateBlocked = rateResults.filter((item) => item?.allowed === false).length;
    assert.equal(rateResults.length, 12);
    assert.equal(rateAllowed, 4, 'Expected exactly 4 shared rate-limit successes; received ' + rateAllowed + '.');
    assert.equal(rateBlocked, 8, 'Expected exactly 8 shared rate-limit denials; received ' + rateBlocked + '.');
    console.log('[PASS] Shared rate limiter across two processes: 12 simultaneous calls -> 4 allowed, 8 denied.');

    const otpResults = await runTwoProcesses('otp-request', {
        scope: otpScope,
        identifier: phone,
        phone,
        calls: 5
    });
    const otpAllowed = otpResults.filter((item) => item?.allowed === true).length;
    const otpCooldown = otpResults.filter((item) => item?.reason === 'COOLDOWN').length;
    assert.equal(otpResults.length, 10);
    assert.equal(otpAllowed, 1, 'Expected exactly one OTP issue; received ' + otpAllowed + '.');
    assert.equal(otpCooldown, 9, 'Expected nine cooldown denials; received ' + otpCooldown + '.');
    console.log('[PASS] OTP per-phone cooldown across two processes: 10 simultaneous calls -> 1 issued, 9 COOLDOWN.');

    const lockResults = await runTwoProcesses('auth-failure', {
        scope: lockScope,
        identifier: lockIdentifier,
        calls: 5,
        maxFailures: 5,
        windowSeconds: 600
    });
    assert.equal(lockResults.length, 10);
    const { data: lockCheck, error: lockError } = await client.rpc('kdj_auth_lock_check', {
        p_key_hash: cleanup.keyHashes[2]
    });
    if (lockError) throw new Error('auth lock check failed: ' + (lockError.code || 'DB_ERROR'));
    assert.equal(lockCheck?.locked, true, 'Concurrent authentication failures did not persist the shared lockout.');
    console.log('[PASS] Shared account failure counter across two processes: 10 simultaneous failures -> durable lockout confirmed.');

    console.log('[RESULT] All staging concurrency/multi-process assertions passed.');
    console.log('[CLEANUP_REQUIRED] Delete otp_auth rows for the synthetic phone and throttle rows for the three printed hashes.');
}

async function workerMain(encodedPayload) {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    const result = await runWorker(payload);
    process.stdout.write('__KDJ_RESULT__' + JSON.stringify(result) + '\n');
}

if (process.argv[2] === '--worker') {
    workerMain(process.argv[3]).catch((error) => {
        process.stderr.write(error.message + '\n');
        process.exitCode = 1;
    });
} else {
    main().catch((error) => {
        console.error('[FAIL] ' + error.message);
        process.exitCode = 1;
    });
}
