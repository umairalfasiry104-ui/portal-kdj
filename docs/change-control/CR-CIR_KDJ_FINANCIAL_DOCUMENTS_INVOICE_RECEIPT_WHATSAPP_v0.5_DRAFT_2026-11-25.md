# KDJ Change Request & Change-Impact Review — Financial Documents v0.5

## CR-CIR-KDJ-FIN-DOC-2026-11-17-01 · v0.5 DRAFT
### Invoice, Kwitansi, PDFKit, private storage, and WhatsApp delivery

| Control | Value |
|---|---|
| Version / date | 0.5 / 25 November 2026 |
| Status | Production database migration applied 25 Nov 2026 under explicit Owner instruction; Portal release and Bot delivery remain gated |
| Baseline | KDJ Master System Specification v1.0; CR-CIR v0.3 and PDFKit delta v0.4 |
| Portal base commit | Production main `9afab795` |
| Portal branch | `feature/kdj-pdfkit-invoice-receipt-20261119` |
| Bot branch | `feature/kdj-financial-document-outbox-20261125` |
| Database target | Not applied to any hosted Supabase project |
| Explicit exclusions | No production migration, no Production Vercel deployment, no outbox activation, no customer message |

## 1. Owner-confirmed financial rules carried into this candidate

1. Registration fee is billed separately from the departure package.
2. Registration invoice is generated after biodata/registration payment is created.
3. Package invoice is generated after a departure package is selected.
4. A verified payment creates a receipt/kwitansi for that transaction.
5. For an installment, the next invoice amount is the entire remaining balance, not just the next installment amount.
6. A new remaining-balance invoice supersedes the previous active invoice while preserving the historical document.
7. A receipt is issued only after the payment is verified/approved; an uploaded proof alone is not a receipt.
8. H-45 remains a follow-up/monitoring trigger only. This financial-document change does not convert H-45 into a payment deadline and does not block installments after H-45.
9. Invoice and kwitansi use separate number sequences, consistent with the two owner-provided examples.

## 2. Portal implementation candidate

### PDF renderer and assets

- Server-side PDF generation uses the pinned `pdfkit@0.20.2` dependency.
- A4 portrait output follows the owner-provided invoice and kwitansi layouts.
- KDJ square logo is a public brand asset at `public/kdj-logo.png`.
- The issuer signature is not stored in `public/` or Git. Local use reads the sensitive `KDJ_ISSUER_SIGNATURE_BASE64` value from ignored `.env.local`; hosted runtime must configure the same secret only when the feature is approved.
- Immutable issuer snapshot records SHA-256 hashes for the logo and signature. Renderer rejects a missing/mismatched signature or logo rather than producing a different historical document.
- The PDF renderer accepts only validated INVOICE/RECEIPT snapshots and does not decide whether a payment is approved.

### Ledger and numbering

- New financial-document and document-event ledgers store immutable snapshots.
- Separate invoice and receipt counters issue independent document numbers.
- Source-event keys and unique constraints provide idempotency against duplicate triggers/retries.
- Superseding invoices retain the prior document and link to the replacement.
- Event ledger is append-only.
- PDF metadata and checksum are stored separately from the immutable financial snapshot.

### Database event integration

- Registration payment events create registration invoices and verified-payment receipts.
- Departure package selection creates a package invoice.
- Verified installments create a receipt for the confirmed payment and an invoice for the full remaining balance.
- Final verified payment produces a receipt and a zero remaining balance; no zero-value next invoice is created.
- No automatic historical backfill is included. Existing historical payment records must be reviewed and reconciled through a separately approved backfill procedure before historic documents are issued.

### Private storage and APIs

- PDFs are stored in the private `kdj-financial-documents` Supabase Storage bucket.
- Customer listing is scoped to the authenticated applicant identity.
- PDF download re-checks owner/admin authorization and verifies PDF SHA-256 against the ledger.
- Internal Bot render route requires the shared Bot API key, creates a short-lived signed URL, and returns the PDF checksum.
- Signed URLs are not stored in the ledger, exposed in customer list responses, or logged.
- Super Admin can inspect delivery state and explicitly resend FAILED/SENT documents or reconcile UNKNOWN deliveries. UNKNOWN is never automatically resent.

### Customer/Admin UI

- Applicant registration-payment step lists registration invoices and receipts.
- Departure-payment section lists package invoices and installment receipts.
- Super Admin applicant detail shows documents and WhatsApp delivery/reconciliation controls.
- Receipt status describes the verified transaction; it must not imply that the entire package is paid when the package has a remaining balance.

## 3. Bot WhatsApp delivery candidate

- New Bot worker claims one durable financial-document outbox row at a time using a lease.
- It calls the authenticated Portal render endpoint, downloads the private signed PDF URL, validates the Supabase origin/bucket, PDF header, size, and SHA-256, then sends the PDF as a WhatsApp document attachment.
- Worker defaults OFF unless `KDJ_FINANCIAL_DOCUMENT_OUTBOX_ENABLED=true`.
- Worker requires `KDJ_FINANCIAL_DOCUMENT_PORTAL_ORIGIN`, existing `WA_BOT_API_KEY`, and existing Supabase service-role configuration.
- Recipient phone prefixes are limited to Indonesia (+62), Jordan (+962), and Yemen (+967); unsupported prefixes are rejected before send.
- Failure before WhatsApp send begins is persisted as FAILED.
- Error/timeout after send begins is persisted as UNKNOWN; no automatic retry is performed.
- Super Admin must reconcile UNKNOWN with provider evidence before resend.
- Worker does not alter existing consultation, scheduling, or AI conversation state.

## 4. Security and data controls

- Private signature bytes never enter Git, public assets, logs, API responses, or the PDF fixture.
- Test fixtures use dummy student, bank, contact, and signatory data.
- Internal API secret comparisons use constant-time comparison.
- Customer routes derive ownership from the authenticated session, not a customer-supplied applicant ID.
- Super Admin-only actions remain server-authorized.
- PDF downloads are streamed with private/no-store headers and a server-side checksum check.
- Outbox payload stores the recipient phone for delivery; it is not returned unmasked to Admin UI.
- No automated financial report email/WA or unrelated reporting delivery is introduced.

## 5. Verification evidence required on the exact release candidate

The implementation worktree includes test coverage for:
- PDF invoice and receipt rendering from immutable snapshots.
- Logo/signature hash validation and missing-secret rejection.
- Registration invoice/receipt creation.
- Package invoice and verified installment receipt creation.
- Remaining balance invoice and supersedes chain.
- Duplicate event idempotency.
- Append-only document event ledger and immutable document snapshots.
- Private Storage metadata and RLS/ACL contract.
- Internal render/download/customer ownership/Admin role contracts.
- Phone normalization for +62/+962/+967 and rejection of other country codes.
- WhatsApp outbox send, FAILED-before-send, UNKNOWN-after-send, checksum mismatch, and WhatsApp-not-ready behavior.
- Existing Portal and Bot regression suites, lint/check, build, and dependency audit.

PGlite tests are local contract evidence only. They do not prove that a hosted Supabase migration has been applied or that a real WhatsApp message was delivered.

## 6. Release and activation gates

This v0.5 document remains DRAFT until reviewed and approved by the owner.

Before Staging/UAT:
1. Review issuer legal name, mailing address, contact details, bank account holder, bank name/account number, payment warning, and signatory name against the official KDJ source.
2. Approve document numbering, source-event mapping, payment-status language, and invoice superseding behavior.
3. Provide an isolated Supabase Staging project/target or explicitly approve another safe test database.
4. Configure the signature secret only in the approved server environment.
5. Configure a dedicated Bot test recipient and keep the outbox feature flag disabled until test start.
6. Perform end-to-end UAT for registration invoice, package invoice, partial payment/receipt, remaining-balance invoice, final payment/receipt, download ownership, outbox delivery, and UNKNOWN reconciliation.

Production migration, Vercel secret changes, Portal deployment, Bot restart, outbox activation, and real-customer WhatsApp delivery require a separate explicit production-release approval after the gates above pass.

## 7. Known limitation

Arabic/RTL student names and mixed-direction text are not yet validated in the PDFKit renderer. Do not treat RTL layout as supported until a suitable font/shaping/BiDi implementation passes visual PDF review and extraction tests.

## 8. Current decision

DRAFT / NOT APPROVED FOR HOSTED MIGRATION OR PRODUCTION ACTIVATION.

## 9. Production database application record — 25 November 2026

Owner explicitly instructed to apply the financial-document migration to Production and align Vercel Production environment. Migration `kdj_financial_documents_v1` was successfully applied to Supabase Production project `faoxkegwhpcuubtiserj` and appears in migration history as version `20261125064651`.

Post-apply verification:
- Four financial document tables exist: counters, documents, append-only events, and WhatsApp outbox.
- RLS is enabled on all four; no policies are present. All direct table grants are limited to `service_role` and database owner; `anon` and `authenticated` have no table privileges.
- All six public `SECURITY DEFINER` service RPCs have `search_path=''`; execute privilege is denied to `anon` and `authenticated`, granted to `service_role` only.
- Registration-payment and departure-payment event triggers are installed.
- Private Storage bucket `kdj-financial-documents` exists, is non-public, allows PDF only, and has a 10 MiB file limit.
- Existing payment data was not backfilled; post-apply document, document-event, outbox, and counter row counts are all zero.
- No customer WhatsApp delivery has been attempted. Bot worker remains disabled by default and no production Bot endpoint has been configured.

Vercel Production environment: `SUPABASE_URL` has been added. The following sensitive variables remain pending manual insertion via Vercel Dashboard/CLI because automated secret transfer was blocked: `KDJ_ISSUER_SIGNATURE_BASE64` and `WA_BOT_API_KEY`. Existing `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, and Admin booking HMAC variables remain configured. `WA_BOT_API_URL` remains unset until Bot has a hosted HTTPS endpoint.

No production Vercel deployment or Bot worker activation is claimed by this application record. PDF render/download and authenticated Bot handoff must be smoke-tested after the missing Production secrets are added and the exact Portal branch is deployed.