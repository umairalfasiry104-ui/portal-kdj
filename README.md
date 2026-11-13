# KDJ Applicant & Admin Portal

Next.js App Router application for applicant registration, OTP authentication, document upload/review, Admin operations, consultation scheduling and manual Daily Report generation.

## Runtime
- Node.js: `>=22.0.0` (see `package.json`).
- Next.js 16.4.3, React 19.3.0.
- Supabase JS server/client integration.
- Local repository: `C:\Users\umair\KDJ stagging\kdj-portal`.
- Approved Staging project: `pgmdurnylyuqkikbwwwy`.
- Production is separate and is not configured by this README.

## Local setup
1. Use the approved local `.env.local` supplied by the project owner. Never commit it or paste values into logs/chat.
2. Install exactly from lockfile:
   ```powershell
   npm ci
   ```
3. Start local development:
   ```powershell
   npm run dev
   ```
4. Open `http://localhost:3000`.

## Environment variable contract
Required server/client variables (values are never documented here):
- `NEXT_PUBLIC_SUPABASE_URL`: Staging project URL for local Staging.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: publishable key (or legacy anon key where explicitly retained); safe for browser use.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only Supabase secret key. Never prefix with `NEXT_PUBLIC_`.
- `SESSION_SECRET`: server-only HMAC/session derivation secret. Every deployed Portal instance must use the same value.
- `KDJ_ADMIN_BOOKING_HMAC_KEY`, `KDJ_ADMIN_BOOKING_KEY_ID`: server-only Admin booking attestation credentials matching the Staging key registry.
- `WA_BOT_API_URL`, `WA_BOT_API_KEY`: server-only Portal-to-Bot internal API configuration. The Bot endpoint must be reachable over an approved protected network/HTTPS route; localhost is only for local processes on the same machine.

Never expose Supabase secret/service keys, session secrets, HMAC keys or Bot API keys in browser code, public environment variables, screenshots, logs, or Git.

## Main capabilities
- Applicant OTP registration/login with durable shared throttling.
- Applicant biodata and optional guardian contact fields.
- Private document upload/review; Akta Kelahiran is mandatory at initial submission.
- Passport file is not uploaded to Portal or Bot; Admin Human gives their personal WhatsApp receiving number directly after registration, with H-45 deadline.
- Admin applicant verification and role-based access.
- Admin-attested booking lane and Scheduling V2/Outbox.
- Manual, copy-only Daily Bot-to-Human Report. No automated WhatsApp/email report delivery is authorized.

## Verification commands
```powershell
npm run test:qualification
npm run test:daily-report
npm run test:otp
npm run test:payment-account
node scripts/test-birth-certificate-upload.mjs
npm run lint
npm run build
```
Focused scripts are in `scripts/test-*.mjs`. Run only tests relevant to the change, per KDJ Audit Protocol v2, unless an impacted dependency/environment change requires broader regression.

## Security and release rules
- All Admin authorization is server-side and must use the verified session/DB role, not browser claims.
- Applicant document objects remain private; use approved signed URL flow.
- Portal Admin booking must use the attested RPC; do not reintroduce direct DML or legacy booking RPC calls.
- Do not add RLS policies or grants without reviewing the exact access model.
- Do not use `git add .`; exclude `.env*`, logs, backups, caches, sessions and build output.
- No Production environment changes or deployments without explicit owner approval.
- Scope is frozen by Master System Specification v1.0; changes outside it require CR/CIR.
