# CR/CIR — Registration Payment Gate & Student Progress Lifecycle

- **CR ID:** CR-CIR-KDJ-REG-PAY-PROGRESS-001
- **Version:** 1.0
- **Date:** 12 November 2026
- **Decision authority:** Owner Admin
- **Parent baseline:** KDJ Master System Specification v1.0 (scope frozen 3 November 2026)
- **Status:** OWNER-APPROVED; local implementation prepared; SQL validation, Staging migration, UAT, and release gates remain open
- **Environment boundary:** Local only in this execution. Staging migration/UAT and Production deployment require separate authorization.

## 1. Purpose and scope

This CR formalizes the Owner's requested change to the applicant registration order and adds a downstream student-progress lifecycle. It does not authorize a broad redesign of authentication, Scheduling V2, Bot lead qualification, existing Storage security, or other stable modules.

## 2. Applicant registration flow

The intended customer flow is:

1. OTP login to the Applicant Portal.
2. Complete the existing personal-data form (no field redesign in this CR).
3. Complete origin school, graduation year, target campus, and major.
4. Submit the initial registration data.
5. Portal creates the registration fee invoice of **Rp1,500,000** and starts a **24-hour** payment countdown.
6. Applicant transfers manually and uploads transfer proof through the Portal.
7. An authorized Admin verifies the proof against the actual incoming bank transaction.
8. Payment approval changes the payment state to PAID/LUNAS and unlocks academic-document upload.
9. Rejected proof enters a revision-required state; applicant must upload corrected proof.
10. Academic documents are submitted and enter the existing verification/revision/approval process.

The 24-hour clock starts only after the server accepts the complete initial submission (personal data plus school/year/campus/major). Login time, page open time, and browser clock are not valid anchors.

## 3. Payment lifecycle and controls

Proposed payment states:
- PENDING_PAYMENT — invoice exists and deadline is running.
- PROOF_SUBMITTED — proof was received and awaits authorized verification.
- REVISION_REQUIRED — proof was rejected with a mandatory reason; applicant may submit a replacement proof.
- PAID — verified against funds actually received by the beneficiary account.
- EXPIRED — deadline passed without a proof submission.
- REOPENED — an authorized Admin reopened an expired/revision window; a reason and new deadline are mandatory.

Rules:
- Deadline calculation is server-side: initial_submission_at + interval '24 hours', persisted as timestamptz; Portal renders it in Asia/Jakarta.
- An upload received before the deadline remains eligible for review even when an Admin checks it after the deadline.
- A screenshot or uploaded file is evidence for review, not proof of settlement. The authoritative paid transition requires an Admin verification decision against the actual bank credit.
- Every proof submission and Admin decision must be retained as an append-only payment event. Replacements must not erase old evidence or its decision.
- Amount is IDR 1,500,000 for this first manual-payment implementation. No installment or gateway processing is included.
- Payment Gateway support is deliberately deferred. Data contracts should not hard-code the manual upload mechanism into the authoritative payment record.

**Owner decision still required before enforcing expiry edge cases:** the safe proposed default is to mark a record EXPIRED when 24 hours pass without any proof, retain all applicant data, and allow Super Admin to reopen it with a reason. If proof was submitted on time, it remains reviewable after expiry. The exact new deadline after a rejected proof is also an open rule; do not silently invent a second 24-hour window.

## 4. Payment verification authority

The current canonical role model is Super Admin, Admin Verifikator, and Admin Konsultan. The current Portal permission matrix assigns finance/payment-proof access and payment-state write authority to **Super Admin only**. This CR preserves that least-privilege boundary.

No finance authority is implicitly granted to Admin Verifikator or Admin Konsultan. A different verifier requires a separate explicit role/permission decision and RBAC review.

## 5. Upload gate

- Payment-proof upload is allowed while payment is awaiting payment or revision, subject to the approved deadline/reopen policy.
- Academic-document upload is denied server-side until payment is PAID/LUNAS.
- Hiding or disabling the upload tab in the browser is not an authorization control.
- Server must load the applicant by authenticated session.sub, then check authoritative payment state before creating a Storage object or document row.
- On a failed database write, clean up the newly uploaded orphan object without deleting a previous valid proof.
- Existing academic documents and records must not be deleted or retroactively blocked during migration. Legacy applicants are grandfathered unless the Owner explicitly approves a backfill policy.

## 6. Post-approval student progress

After existing academic-document verification reaches Approved, the next primary progress status is:

- TRANSLATION_AND_CAMPUS_REGISTRATION — translation and submission/registration process to the target campus.
- WAITING_DEPARTURE — administrative preparation completed and waiting for departure.
- DEPARTED — actual departure confirmed by an authorized Admin.

The four downstream documents are **independent artifacts**, not an ordered status machine:
- Suketmah
- LOA
- Visa
- Ticket

Admin may upload any of these documents as soon as it is issued. Uploading one must not require the previous document to exist and must not change the order of the others. Each artifact must:
- be linked to the immutable pendaftar.id (never matched by name alone);
- record document type, object path, uploaded actor/time, version, and optional note;
- preserve replacement history; and
- be downloadable by the matching applicant through a short-lived signed URL after owner check.

Suggested progress display: one primary lifecycle status plus a four-item document checklist with Available / Not yet available state. A document appearing must not automatically advance the primary lifecycle status.

**Open business rule:** whether all four documents are mandatory before moving to WAITING_DEPARTURE has not yet been explicitly confirmed. Proposed safe default is to require the designated required set plus an explicit Admin transition; do not infer that set from document upload order.

## 7. Transition ownership

Until the Owner assigns operational responsibilities, keep post-approval progress changes and downstream document publication under Super Admin authority. Academic document verification before Approved remains under the existing Admin Verifikator permission. Do not silently broaden either role.

Every progress transition must have an allowlisted prior-state → next-state rule, actor, timestamp, and reason. No generic free-form status update.

## 8. Database and API impact

Expected additive domain objects:
- payment invoice/current-state record keyed to pendaftar.id;
- append-only payment proof/decision events;
- registration lifecycle history (initial submission, data completeness, document submit, approval, revision);
- student progress current-state record and append-only transition history;
- separate downstream document metadata/version records, or a carefully constrained additive extension if source/schema review proves it is safer.

The existing pendaftar.status_pembayaran, bukti_bayar_url, and nominal_tagihan fields are legacy compatibility fields and must remain intact during rollout. Do not mutate or reinterpret historical migrations. New writes should be transactional and preserve a clear source of truth; any temporary mirror to legacy fields must be explicitly documented and tested.

## 9. Migration and rollout safeguards

- Use append-only migrations created through the Supabase CLI.
- Test against a fresh local restore of the current Staging schema before requesting a Staging migration window.
- No direct writes, DDL, migration replay, ACL/RLS change, or test fixture insertion on hosted Staging in this execution.
- Do not edit old migration files.
- Backfill no deadlines for existing applicants without Owner-approved policy. Preserve current payment proof and academic documents.
- Additive rollback/recovery must preserve all submitted proofs, payment decisions, student documents, and audit events. Prefer forward repair over dropping tables with records.

## 10. Acceptance tests

Required local and later Staging tests include:
- 24-hour deadline starts only on successful complete initial submission; repeated request is idempotent.
- Browser time manipulation does not alter deadline.
- Proof before deadline remains reviewable after deadline.
- Expired record remains stored and cannot upload academic documents until reopened and PAID.
- Rejected proof can be replaced without destroying old proof/decision history.
- Only Super Admin can access/decide payment; Verifikator and Konsultan are denied.
- Applicant cannot upload academic docs before PAID, including by direct API call.
- Payment PAID unlocks academic upload; unpaid/rejected/expired states do not.
- Existing legacy applicants and documents remain readable.
- Four downstream documents can be uploaded in any order, replaced with history, and downloaded only by the owner.
- Same-name applicants cannot receive each other's documents.
- Invalid progress transitions and unauthorized roles are rejected.
- Approved → translation/campus registration → waiting departure → departed transitions are auditable.

## 11. Owner decisions retained as open

1. Final expiry behavior and the deadline granted after a proof revision.
2. Whether reopening an expired invoice is Super Admin-only and the required reason format.
3. Which roles may update translation/visa/departure progress and upload Suketmah/LOA/Visa/Ticket.
4. Exact document prerequisites for WAITING_DEPARTURE.
5. Whether actual departure may be recorded only by Super Admin or by a delegated role.

## 12. Authorization boundary

Owner approval in this conversation authorizes the direction and local-only source/design preparation. It does **not** authorize applying any migration to Staging, deploying to Vercel/Production, sending applicant notifications, or performing real payments. Each such operation remains separately gated.


## 13. Local execution evidence — 12 November 2026

The Owner subsequently confirmed the 24-hour manual-payment approach and authorized local-only implementation. The source currently contains:

- Applicant wizard order: Data Diri → Kampus/Jurusan → Pembayaran → Upload Berkas.
- Initial invoice is created only after the complete initial form is accepted; invoice amount is IDR 1,500,000 and the deadline is anchored in PostgreSQL at +24 hours.
- Applicant payment proof is stored as a versioned evidence record. Proof received before the deadline remains reviewable after expiry.
- New payment review/approval and invoice reopening are Super Admin-only. A rejected proof requires a reason. Reopening requires a Super Admin-provided future deadline and reason; the database rejects an attempt to reopen an unexpired invoice.
- A legacy compatibility path is preserved for existing applicants whose payment proof was rejected before the new payment ledger existed. It does not create a fabricated invoice.
- Both applicant final submit and the legacy Admin status endpoint enforce the PAID gate. A generic Admin status update cannot mark a new-ledger payment as LUNAS or bypass PAID before Submitted/Approved.
- After academic approval, student progress starts at translation/campus registration. Suketmah, LOA, Visa, and Ticket are independent versioned PDF artifacts. Applicant downloads are bound to the authenticated owner; upload and primary lifecycle transitions remain Super Admin-only.
- The WAITING_DEPARTURE transition deliberately does not impose an all-four-documents prerequisite. The Owner has not confirmed that business rule; the Admin UI states it remains open rather than silently enforcing an assumption.

Candidate migration: `supabase/migrations/20261112132800_kdj_registration_payment_progress_v1.sql`.

Validation completed locally:
- Portal Next.js build: PASS, 22/22 pages/routes generated.
- Portal lint: PASS, 0 errors and 5 existing `@next/next/no-img-element` warnings.
- New payment/progress contract script: 7/7 assertions PASS.
- Existing payment-account and qualification/report contract checks were run during the local verification sequence; no production dependency was added for the new feature.

Outstanding validation:
- SQL has not yet been executed against the local restore database. The local PostgreSQL listener on 127.0.0.1:55432 requires a password for role `postgres`; no local credential was available to this execution. Do not infer SQL runtime validity from the Portal build or static assertions.
- Migration has not been applied to Staging. No applicant or Admin UAT has been run.
- No Storage object was uploaded and no real payment was made.

The 24-hour expiry behavior implemented in source is: EXPIRED is a durable state, applicant data is retained, and only Super Admin can reopen with a reason and selected deadline. There is no automatic second 24-hour window after proof rejection; the next deadline is explicit and Admin-selected. This should be confirmed in Staging UAT before Production.

## 14. Controlled local implementation addendum — payment expiry

The Owner authorized local correction of the outstanding expiry lifecycle gap. This addendum does not modify the frozen Master System Specification and does not authorize Staging/Production execution.

- Added `kdj_expire_registration_payments(p_limit)` as a bounded, service-role-only database worker.
- The worker claims due `PENDING_PAYMENT`, `REOPENED`, and `REVISION_REQUIRED` invoices using `FOR UPDATE SKIP LOCKED`, writes the durable `EXPIRED` state, and appends one `PAYMENT_EXPIRED` event in the same transaction.
- `PROOF_SUBMITTED` is expressly excluded. Evidence received before the deadline remains eligible for Admin review even if the review occurs later.
- Candidate `pg_cron` schedule: every five minutes (`*/5 * * * *`), only when the existing Cron extension/schema and `cron.schedule(text,text,text)` function are available. The migration does not install or alter the extension.
- The RPC is revoked from `PUBLIC`, `anon`, and `authenticated`; execution is granted only to `service_role`.
- Rejected evidence does not receive an automatic second 24-hour window. After its original deadline, it becomes EXPIRED and requires an explicitly reasoned Super Admin reopen with a selected new deadline.

The former open expiry item in Section 11 is resolved at the source-design level by this implementation. SQL runtime validation on an isolated local restore, migration review, and Staging UAT remain open. No database migration or Cron job was executed in this correction pass.


Clarification closure: the former Section 11 payment-expiry behavior and reopen authority items are resolved in this local implementation addendum: overdue unpaid/revision states become EXPIRED, timely PROOF_SUBMITTED remains reviewable, and only Super Admin may reopen with a mandatory reason and explicitly selected future deadline. Post-approval operational role delegation and WAITING_DEPARTURE document prerequisites remain open.
