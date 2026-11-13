# Applicant UAT Report — 11 November 2026

Environment: Supabase Staging `pgmdurnylyuqkikbwwwy`; local Portal branch `feature/kdj-portal-work-20261109`.
Scope: applicant Portal, OTP, biodata, Akta Kelahiran, payment proof, final submit. Production untouched.

## Disposition

**PARTIAL — live applicant journey BLOCKED by missing customer-controlled test handset/OTP.** Do not mark UAT-01–06 complete from source-contract tests alone.

| UAT | Area | Result | Evidence / limitation |
|---|---|---|---|
| APP-00 | Applicant landing page | PASS | Browser opened Portal root with HTTP 200; applicant heading, WhatsApp phone input, Send OTP button and Admin link rendered; zero browser page errors. |
| OTP-01 | Request OTP and WhatsApp delivery | NOT RUN | Requires a dedicated non-Admin Staging applicant number controlled by the tester and actual WhatsApp delivery. No phone supplied; no OTP requested. |
| OTP-02 | Verify, cooldown, replay and lockout | CONTRACT PASS / LIVE NOT RUN | Durable OTP source/SQL contract suite passes (atomic DB RPC, HMAC-derived throttle keys, 60-second cooldown, quota, lockout and one-time consumption/replay protection). No live OTP was consumed. |
| APP-01 | Applicant session ownership | NEGATIVE PASS / POSITIVE NOT RUN | Unauthenticated `POST /api/pendaftar` returned 401. Positive session creation and correct owner binding require successful OTP. |
| APP-02 | Biodata save/reload | NOT RUN | No authenticated applicant session was created; no existing applicant record was used as test data. |
| DOC-01 | Akta Kelahiran | CONTRACT PASS / LIVE NOT RUN | Contract verifies Portal slot, upload API allowlist, Admin review and final-submit requirement. Unauthenticated upload returned 401. No document was uploaded. |
| PAY-01 | Payment proof | NOT RUN | No authenticated session or dedicated test applicant; no payment file or proof was uploaded. |
| SUB-01 | Final submit | CONTRACT PASS / LIVE NOT RUN | Server-side contract requires completed identity/school data, pasfoto, ijazah, transkrip, Akta and payment proof; Passport remains deferred and is not an initial-submit blocker. No final submit or Bot notification was triggered. |

## Test evidence

- `npm run test:otp`: PASS — durable OTP and shared throttle contract.
- `node scripts/test-birth-certificate-upload.mjs`: PASS — Akta required; Passport is not a Portal upload and is deferred to Admin Human.
- `node scripts/test-session-identity.mjs`: PASS.
- `node scripts/test-admin-rbac.mjs`: PASS — payment verification remains Super Admin-only; Verifikator/Konsultan permission boundaries are preserved.
- Browser smoke: landing PASS; unauthenticated `POST /api/pendaftar`, `POST /api/upload-dokumen`, and Daily Report GET each returned 401; zero page errors.

## Staging data safety snapshot

After this test window:
- Applicants: 2 existing records, both `draft_berkas`.
- Applicant documents: 0.
- Payment proof references: 0.
- Objects in private applicant Storage bucket: 0.
- Unused unexpired OTP rows: 0.
- No applicant, payment, document or OTP test fixture was created; existing applicants were not modified.

## Required to close

Provide a dedicated Staging applicant WhatsApp number that the tester controls (not the Admin handset and not another customer's number). Request OTP from the Portal, read the six-digit code on that handset, then complete OTP verification → biodata save/reload → Akta upload/retrieval → payment-proof upload → missing-document negative test → final submit → Bot notification correlation. Capture a fresh evidence ledger and verify test applicant/file cleanup afterward.

**Stop condition:** until the dedicated applicant-controlled number and real OTP are available, APP/OTP/DOC/PAY/SUB live UAT remains OPEN. No Production activity, deployment, commit or push.


## Retest and final disposition — 11 Nov 2026, 03:15 WIB

- Applicant landing and route smoke remain PASS; unauthenticated `POST /api/pendaftar` returns HTTP 401.
- Portal durable OTP contract and two-process Staging concurrency test PASS. Two independent processes produced: 12 shared rate-limit calls = 4 allowed / 8 denied; 10 concurrent OTP requests = 1 issued / 9 cooldown; 10 concurrent auth failures = persistent shared lockout.
- Synthetic OTP test cleanup verified: the test-created `otp_auth` row and exactly three HMAC throttle rows were deleted. Staging now has 0 `otp_auth` rows and 0 `kdj_auth_throttle_state` rows.
- Current data integrity snapshot: 2 applicants, both `draft_berkas`; 0 applicant document rows; 0 payment-proof references; 0 objects in private `berkas_kdj` Storage bucket. Existing applicant rows were not updated.

**Final status unchanged: BLOCKED / NOT RUN for real applicant UAT.** The concurrency test uses a synthetic phone and does not establish delivery to a customer-controlled WhatsApp handset. No actual applicant OTP was requested/verified; biodata save/reload, Akta upload/retrieval, payment proof, missing-document live negative, final submit, and Bot notification correlation were not performed. A dedicated Staging applicant number controlled by the UAT operator is required to continue. Do not use an existing customer's contact or the Admin handset as a substitute.
