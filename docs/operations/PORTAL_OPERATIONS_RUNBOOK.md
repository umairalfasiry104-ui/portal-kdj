# KDJ Portal Operations Runbook — Local/Staging

## Purpose
Operate the applicant/Admin Portal in Local or approved Supabase Staging. This runbook is not Production authorization.

## Start local Portal
```powershell
Set-Location 'C:\Users\umair\KDJ stagging\kdj-portal'
npm ci
npm run dev
```
Default local URL: `http://localhost:3000`. Do not start a second dev server on the same port without identifying the existing process.

## Required environment
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Staging project and publishable key.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only Staging secret.
- `SESSION_SECRET`: identical across all Portal instances for shared HMAC throttling.
- `KDJ_ADMIN_BOOKING_HMAC_KEY` and `KDJ_ADMIN_BOOKING_KEY_ID`: Staging Admin booking attestation.
- `WA_BOT_API_URL` and `WA_BOT_API_KEY`: protected internal Bot API. Remote Vercel Preview requires a dedicated reachable HTTPS Staging endpoint; local loopback is not remotely reachable.

Never expose secret keys through `NEXT_PUBLIC_`, browser code, logs, screenshots, Git or support messages.

## Core operational checks
- OTP routes use durable shared database RPCs. On DB/RPC error, access must fail closed; do not reintroduce process-local Map fallbacks.
- Applicant documents use private Storage and signed URL access. Akta is mandatory at initial submission.
- Passport file is handed directly to Admin Human's personal WhatsApp number after registration and no later than H-45; Portal/Bot must not receive it.
- Admin access is enforced server-side from verified session and database role.
- Admin booking uses the HMAC-attested transactional RPC and durable Outbox.
- Admin Daily Report v2 follows the owner-approved CR/CIR v2.0: immutable role-specific snapshots and optional one-to-one WhatsApp delivery by the Bot worker. The existing Portal manual preview/copy remains the fallback. Delivery is OFF by default and requires a separately approved supervised Staging UAT; do not activate the feature flag or send reports before recipient/queue preflight and explicit approval.

## Regression and build
```powershell
npm run test:qualification
npm run test:daily-report
npm run test:otp
node scripts/test-birth-certificate-upload.mjs
npm run lint
npm run build
``
Run impacted tests first; use the full Portal test inventory after dependency, session, schema or cross-cutting changes.

## Data and incident safety
- Do not use real applicants or real parent contacts for test data.
- Do not directly delete applicant documents or storage objects outside an approved cleanup procedure.
- Preserve Admin lifecycle audit and immutable evidence.
- For OTP concurrency tests, use synthetic identities and verify synthetic OTP/throttle rows are cleaned after test.
- Do not broaden RLS, table grants or RPC EXECUTE without reviewing the exact access model.
- No direct DML for booking; use approved RPC contracts.

## Release safety
- Staging and Production Supabase projects must remain separate.
- Production URL/keys are owner-controlled and were not changed in this work.
- No deploy, alias promotion, commit or push is authorized by this runbook.
- All changes outside Master System Specification v1.0 require CR/CIR.
