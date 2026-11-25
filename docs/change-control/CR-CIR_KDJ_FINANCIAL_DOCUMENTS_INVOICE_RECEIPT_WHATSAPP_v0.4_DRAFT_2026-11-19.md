# KDJ Change Request & Change-Impact Review — Technical Delta

## CR-CIR-KDJ-FIN-DOC-2026-11-17-01 · v0.4 DRAFT
### PDFKit renderer for Invoice and Kwitansi

| Control | Value |
|---|---|
| Version / date | 0.4 / 19 November 2026 |
| Status | Draft technical extension; local renderer implementation only |
| Baseline | v0.3 DRAFT, KDJ Master System Specification v1.0 |
| Environment | Isolated local Git worktree from Production main commit `9afab795` |
| Authorization | Owner request: add PDFKit for invoice and kwitansi |
| Explicit exclusions | No database migration/apply, document issuance, Storage upload, WhatsApp delivery, or Production deployment |

## 1. Owner request and selected dependency

Owner requested PDFKit for invoice and kwitansi generation.

- Package: `pdfkit`
- Version pinned: `0.20.2`
- License: MIT
- Runtime: Node.js 24.x / Vercel Node runtime
- Module style: ESM named export `PDFDocument`
- PDF output: A4 portrait, streamed into a Node Buffer for subsequent storage/download integration.

PDFKit is selected as the PDF generation engine. The renderer runs server-side only; it is not imported into browser components.

## 2. Visual reference

The renderer follows the two owner-provided one-page PDF examples:

1. Owner-provided invoice PDF sample.
2. Owner-provided kwitansi PDF sample.

Elements represented:
- Owner-provided KDJ square logo and issuer identity.
- Issuer address and contact line.
- Centered INVOICE / KWITANSI title.
- Faktur/document number, issue date, and student name.
- Invoice: description and amount table, total, due date when present.
- Receipt: payment rows (description, amount, date, method, status), package/Pax summary, total package value, paid subtotal, and remaining balance.
- Bank transfer information and warning panel.
- Signatory name/area and terms/notes.

The renderer receives issuer/bank/signatory values from the immutable document snapshot. It does not embed bank account or signatory values as hidden generator defaults. The KDJ logo is a public brand asset at public/kdj-logo.png. The issuer signature is loaded only from server-side KDJ_ISSUER_SIGNATURE_BASE64 (a sensitive environment variable) or explicitly injected server-side PNG/JPEG bytes. It is never placed under public/ or committed to Git. The local copy is stored outside the repository and its Base64 value is in ignored .env.local. If no signature image is configured, the renderer shows a signatory line/name; it does not synthesize a signature.

## 3. Local source implementation

| File | Purpose |
|---|---|
| `package.json` / `package-lock.json` | Pin PDFKit 0.20.2 and add the PDF renderer test to the unified test runner |
| `lib/financial-document-pdf.mjs` | Render INVOICE / RECEIPT from an immutable document snapshot |
| `scripts/test-financial-document-pdf.mjs` | Render and validate invoice/receipt examples, image inputs, required metadata, amount validation, and one-page layout |

Renderer contract:
- Accepts only document types INVOICE or RECEIPT.
- Requires document number, issue date, positive IDR amount, student snapshot, issuer snapshot, and document-specific payment/line-item data.
- Receipt rendering requires at least one payment entry with date, method, and status. The renderer itself does not approve a payment or create a receipt.
- The renderer does not read arbitrary filesystem paths supplied by document data.
- Invalid/missing issuer and bank metadata is rejected rather than replaced with generator defaults.
- This is a renderer only; it does not issue numbers, create financial ledger rows, or alter payment balances.

## 4. Scope boundaries and dependencies

This delta does not implement or authorize:
- `kdj_financial_documents` ledger, event ledger, numbering sequences, or idempotency RPCs.
- Invoice creation at registration submission or package selection.
- Receipt issuance after a successful payment approval transaction.
- Immutable replacement/supersedes linkage.
- Private Storage bucket, object upload, signed URL, or customer/Admin download endpoints.
- Financial-document Outbox, media delivery, retries, UNKNOWN reconciliation, or WhatsApp Bot changes.
- Migration execution against local/staging/Production hosted databases.
- Vercel Preview/Production deployment or any Production environment changes.

The remaining scope and release gates in CR-CIR v0.3 continue to apply.

## 5. Test evidence

Executed in the isolated worktree based on the latest Production main commit:

| Check | Result |
|---|---|
| PDFKit invoice render | PASS |
| PDFKit receipt render | PASS |
| PDF header, EOF, metadata, page object | PASS |
| Example invoice page count | 1 A4 page |
| Example receipt page count | 1 A4 page |
| Local secret-signature render | PASS; one A4 page with signature image embedded |
| Required issuer/payment fields validation | PASS |
| Invalid type / zero amount / invalid image rejection | PASS |
| `npm test` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS (28 routes) |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `git diff --check` | PASS |

## 6. Known limitation / remaining review

- The supplied examples and automated rendering tests use Latin-script student names.
- Arabic/RTL names, mixed-direction text, glyph shaping, and extraction were not validated in this PDFKit implementation. Do not claim RTL support until a representative Arabic test suite and an appropriate font/BiDi strategy are implemented and reviewed.
- The owner supplied a standalone issuer signature asset. A local-only test confirmed the server secret is decoded and embedded. The signature file and Base64 secret are excluded from Git; Vercel Preview/Production secret configuration has not yet been added.
- Issuer legal metadata and bank details still require final confirmation as part of the financial-document issuance/storage CR-CIR before any live invoice or receipt is issued.

## 7. Release decision

This is a local source candidate for the PDF renderer only. It is not a Production feature release. Further financial-document ledger, issuance, private storage, and Portal integration require the remaining CR/CIR review and a separate Staging approval/UAT before Production.

## 8. Asset handling update ? 25 November 2026

- Added owner-provided KDJ square logo to the public brand assets.
- Isolated the issuer signature from the public folder and Git. Local Windows copy: LocalAppData KDJ private-assets; local environment variable: KDJ_ISSUER_SIGNATURE_BASE64 in ignored .env.local.
- Renderer reads the signature only on the server from that sensitive variable or an explicitly injected server-side image buffer.
- The actual signature is not stored in the repository, commit, or public URL. Vercel secret configuration is deferred until the financial-document feature is approved for Preview/Production.
