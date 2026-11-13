# CR-CIR — Akta Kelahiran Wajib pada Pendaftaran Awal

**ID:** CR-CIR-KDJ-REG-DOC-002  
**Version:** 1.0  
**Decision date:** 10 November 2026  
**Decision authority:** Explicit user approval recorded in the project conversation on 10 November 2026  
**Implementation target:** Local Portal + Bot prompt Markdown; Supabase Staging only if a database change is proven necessary  
**Deployment:** Local/Staging only. No Production deployment authorized.

## 1. Approved change

Add an Akta Kelahiran upload slot to the Portal registration document step and enforce it as a mandatory document for initial final submission.

The operational rule is:
- Akta Kelahiran must be available and uploaded at initial registration.
- Akta Kelahiran cannot be deferred or submitted later.
- Passport remains an allowed deferred document when not yet available, but must be provided no later than H-45 before departure.
- Passport may still be uploaded during initial registration when available.

This distinction must be reflected consistently in Portal UI, server-side final-submit validation, Admin document review, and Bot Markdown knowledge/SOP.

## 2. Impact review

### Portal UI
- Add `akta_kelahiran` to Step 3 upload list.
- Mark Akta Kelahiran as mandatory at initial registration.
- Change the passport label to clarify that it may follow by H-45.
- Include Akta Kelahiran in progress tracking.
- Final-submit client validation requires Akta Kelahiran but does not block solely because passport is not yet uploaded.

### API and storage
- Accept `akta_kelahiran` in the document upload allowlist.
- Sign the uploaded Akta Kelahiran URL for the applicant and authorized academic reviewers.
- Require Akta Kelahiran in the server-side final-submit validation.
- The biodata field `no_paspor` is optional at initial final submission; it can be completed when the passport is available by H-45.
- Exclude the optional passport number and passport upload from the mandatory initial-registration progress denominator so the progress indicator does not imply they block submission.
- Keep existing file controls: PDF/JPG/PNG, maximum 5 MB, file magic-byte checks, private storage bucket, session ownership checks, signed URLs, and upload lock once registration is submitted/under review.

### Admin and RBAC
- Treat Akta Kelahiran as an academic document type for Admin read/review.
- Keep existing academic-document permissions and ownership checks.
- Display it through the existing signed-document review path.

### Database and architecture
- `dokumen_pendaftar.jenis_dokumen` is a text column with a unique constraint on `(pendaftar_id, jenis_dokumen)`; no type-specific CHECK constraint exists.
- Existing upload uses the same private storage bucket and generic upsert path.
- Existing Admin RPC validates ownership and status values but does not restrict academic document names.
- Therefore no schema/API architecture migration is required for this change. Do not add a DB migration unless implementation verification identifies a concrete schema dependency.

### Bot knowledge and guardrails
- Update `03_knowledge_base.md` as the factual source.
- Update `02_sop_conversation_flow.md` and `05_guardrails_escalation.md` so Minje never describes Akta Kelahiran as deferrable and never requests document files through WhatsApp.
- Update one few-shot example only as illustrative guidance; it remains subordinate to the KB.

## 3. Security, privacy, and compatibility

- No public storage access is added.
- No new customer fields or document metadata fields are introduced.
- No document content or personal data is sent through WhatsApp.
- Existing customers' records and already-uploaded documents remain unchanged.
- Existing passport records continue to work.
- Missing Akta Kelahiran is enforced only when the applicant attempts initial final submission; drafts remain savable.

## 4. Verification plan

- Contract test confirms UI, upload allowlist, GET signing, Admin document filtering, and server-side final-submit validation all recognize `akta_kelahiran`.
- Negative contract test confirms Passport is not in the initial mandatory-document array.
- Run Portal ESLint and `git diff --check`.
- Build Portal and smoke-test public page/API availability.
- Browser UAT: verify the new tile, file type/size restrictions, upload/list rendering, and final submit is blocked when Akta is missing.
- Admin UAT: verify authorized academic reviewer can see and review Akta; unauthorized role remains denied.
- Do not upload synthetic documents against real applicant records. Use a dedicated QA account or mock-level tests.

## 5. Rollback

Revert only the CR-scoped Portal and prompt changes if regression is found. Do not delete uploaded files or existing document rows during rollback. Since no database migration is planned, there is no database rollback operation.

## 6. Decision status

**Approved for local/Staging implementation** by explicit user instruction in the conversation on 10 November 2026.  
**Production deployment remains out of scope and requires separate approval.**


## 7. Implementation and verification record

**Executed:** 10 November 2026 — Local Portal Staging branch only.

### Implemented files
- `app/page.js`: Akta Kelahiran upload tile, mandatory initial document validation, passport-number optional label, and progress tracking excludes deferred passport fields.
- `app/api/upload-dokumen/route.js`: accepts `akta_kelahiran` and returns its signed URL through the existing academic-document path.
- `app/api/pendaftar/route.js`: server-side initial final submit requires Akta Kelahiran and does not require passport number or passport upload.
- `app/api/admin/pendaftar/route.js` and `app/admin/page.js`: academic reviewer access and display for Akta Kelahiran; document count updated to 5 slots.
- Bot Markdown `02`, `03`, `04`, and `05`: consistent mandatory-Akta and passport H-45 rule; privacy guidance prohibits sending document files through WhatsApp.

### Verification evidence
- `node scripts/test-birth-certificate-upload.mjs`: PASS.
- `npm run lint`: PASS, 0 errors and 5 existing `@next/next/no-img-element` warnings.
- `git diff --check`: PASS.
- Portal smoke test: `/`, `/admin`, and `/api/health` each returned HTTP 200 after changes.
- Database inspection: `pendaftar.no_paspor` is nullable; `dokumen_pendaftar.jenis_dokumen` is generic text and already supports the new value. No schema migration was needed for Akta Kelahiran.

### Not yet covered by this record
- Actual document upload and final-submit UAT must be performed using a dedicated QA applicant account. No existing applicant record or storage object was modified during this implementation.
- Production deployment is not authorized by this CR.

**Implementation status:** Local/Staging code changes and static contract verification complete; dedicated applicant browser UAT remains pending.

---

## 8. Owner decision addendum — Passport follow-up workflow (10 November 2026)

The owner clarified that a deferred Passport document is **not uploaded by the applicant in the Portal**. After initial registration, the applicant hands the Passport document directly to Admin Human, no later than H-45 before departure.

### Implementation impact
- Removed the Passport upload tile from the applicant Portal.
- Removed paspor from the applicant POST /api/upload-dokumen allowlist. An applicant cannot upload a Passport file through the Portal endpoint.
- Kept Passport out of the initial final-submit required-document list.
- Kept legacy/Admin academic-document read/sign support for Passport records, so existing records are not made unreadable.
- Kept the optional no_paspor biodata field; it does not block initial final submission.
- Admin Portal document counter now reflects four Portal-uploaded academic slots. Passport follow-up is handled separately by Admin Human and is not counted as a Portal upload slot.
- Bot KB/SOP/guardrails now direct the applicant to Admin Human for the deferred Passport handoff. Minje/Bot must not request or receive the Passport file in automated WhatsApp chat.
- The precise approved secure channel used by Admin Human to receive the file must be stated by the operating team; the Bot should only say that Admin Human will provide the official channel.

This is a clarification of the existing H-45 Passport deferral rule. Akta Kelahiran remains mandatory at initial registration and must be uploaded through the Portal.

### Re-verification
- Portal Akta/Passport contract test: PASS.
- Portal Daily Report contract test: PASS.
- Portal ESLint: PASS, zero errors and five existing no-img-element warnings.
- Portal git diff --check: PASS.
- Akta API/Storage UAT remains PASS from the Staging UAT report; runtime negative test for applicant Passport upload and final production build after this addendum are recorded separately in the release gate.

**Decision status:** Owner-directed workflow adjustment; local/Staging implementation only. Production remains untouched.

 
### Final runtime/build verification — 10 November 2026
- Applicant Passport upload negative API test: PASS, HTTP 400 with the expected disallowed-document response.
- The temporary test applicant was deleted after the request; no Passport Storage object was created.
- Final Portal production build after the Passport workflow adjustment: PASS on Next.js 16.4.3; TypeScript passed; 19/19 static pages generated; exit code 0.
- Final Bot prompt regression after the Admin Human Passport handoff update: check, baseline, scheduling, qualification, daily-report, and RT04 automated suites all PASS.
