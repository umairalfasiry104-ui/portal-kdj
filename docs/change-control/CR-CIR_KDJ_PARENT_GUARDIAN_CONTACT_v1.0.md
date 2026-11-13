# CR-CIR â€” Data Kontak Orang Tua/Wali pada Biodata Pendaftar

**ID:** CR-CIR-KDJ-REG-PARENT-003
**Version:** 1.0
**Request date:** 11 November 2026
**Decision authority:** Explicit user request in the project conversation on 11 November 2026
**Implementation target:** Local Portal working branch + Supabase Staging `pgmdurnylyuqkikbwwwy`
**Deployment:** Local/Staging only. Production deployment is not authorized.

## 1. Requested change

Add two optional fields to Step 1 (Data Diri Calon Mahasiswa) in the applicant Portal:

- **Nama Orang Tua/Wali** â€” `nama_orang_tua_wali`
- **Nomor WhatsApp Orang Tua/Wali** â€” `no_wa_orang_tua_wali`

The fields are independent and optional. They do not become a new final-submit requirement and do not block an existing applicant from saving a draft or submitting when all previously approved requirements are satisfied.

## 2. Impact review

### Portal UI and state

- Add the two controlled fields to Step 1.
- Persist/re-hydrate them through initial OTP login, existing local session state, and refresh of the applicant's latest database record.
- Preserve existing form locking behavior.
- Do not add optional parent fields to the mandatory progress denominator.

### Database

- Add nullable `varchar(150)` column `nama_orang_tua_wali`.
- Add nullable `varchar(20)` column `no_wa_orang_tua_wali`.
- Store the parent/guardian WhatsApp number in canonical Indonesian local format `08xxxxxxxxxx` (8â€“13 digits after the leading 08), accepting common input forms such as `08...`, `+62...`, or `62...` through the existing normalization helper.
- Add a CHECK constraint to prevent non-canonical values from being stored by future write paths.
- No existing row needs a backfill; the new columns are nullable.
- RLS remains enabled. Existing table grants expose `pendaftar` only to `postgres` and `service_role`; no grant or policy expansion is allowed.

### API and data contracts

- Applicant `POST /api/pendaftar`: accept, type-check, trim, validate and persist these values. Empty input is stored as NULL. Keep both fields optional. Omitted fields from older clients must not clear existing values.
- Customer OTP response DTO: return both columns so the authenticated applicant can restore their form.
- Customer document-refresh DTO: include both fields for the applicant's own record only.
- Admin applicant DTO: include both fields only under the existing `pendaftar.verification.read` permission.
- Admin UI: show both values in the existing read-only full biodata panel for roles already allowed to read verification data. Do not expand Admin Konsultan access.
- Do not include these fields in the Bot notification payload, Bot conversation state, Daily Report, logs, or unrelated RPCs.

### Privacy and security

- Treat the guardian name and phone number as personal data.
- Use existing server-side Supabase service-role access and session ownership checks; do not expose direct table access or broaden RLS/grants.
- Only the applicant's own authenticated Portal session can create/update their fields.
- Only existing Super Admin / Admin Verifikator biodata-read permission can receive the values from the Admin API.
- Parent/guardian phone is contact information only. This CR does not authorize automated WhatsApp messages or contact with the guardian.

### Compatibility and scope

- No change to OTP, booking, payment, document upload, Akta, Passport handoff, scheduling, Bot prompts, or final-submit business rules.
- Existing rows and API clients remain compatible because the columns are nullable and the new request properties are optional.
- No schema reset, table recreation, broad data deletion, or Production change.

## 3. Files expected to change

- `app/page.js`
- `app/api/pendaftar/route.js`
- `app/api/auth/verify-otp/route.js`
- `app/api/upload-dokumen/route.js`
- `app/api/admin/pendaftar/route.js`
- `app/admin/page.js`
- `supabase/migrations/<generated_timestamp>_add_parent_guardian_contact_fields.sql`
- `scripts/test-parent-guardian-fields.mjs`
- This CR/CIR record.

Bot source is intentionally unchanged.

## 4. Verification plan

- Verify migration applied to Staging and both columns / CHECK constraint exist.
- Verify RLS and table grants did not broaden.
- Run a focused contract test covering form state, optional request fields, phone normalization, customer DTO, admin RBAC DTO, and UI display.
- Run existing Akta/final-submit, session identity and Admin RBAC contract tests.
- Run Portal lint and `git diff --check`.
- Build or isolated smoke test without overwriting the active Portal dev server build cache.
- Manual UAT with a dedicated non-Admin Staging applicant: save both values, refresh/re-login, confirm values persist, and confirm Admin Verifikator / Super Admin can view them while Admin Konsultan cannot.
- Test empty optional fields do not block Step 1 save or final submit.
- Do not use real applicant or parent contact data in tests.

## 5. Rollback

- Revert the CR-scoped UI/API/test changes if regression is found.
- Keep the nullable DB columns and CHECK constraint in place during application rollback. They are additive and unused by the reverted code; do not drop columns containing user data.
- Production remains untouched.

## 6. Decision

**Accepted for local/Staging implementation** based on the explicit user request on 11 November 2026.
**Production deployment remains out of scope and requires separate approval.**

## 7. Implementation record

**Implemented:** 11 November 2026 â€” Local Portal working branch + Supabase Staging only.

### Changed artifacts

- `app/page.js`: optional guardian name and WhatsApp inputs added to Step 1; hydration from OTP, saved session and database refresh; excluded from mandatory progress denominator.
- `app/api/pendaftar/route.js`: optional input validation, phone normalization, persistence and customer response DTO. Omitted fields from older clients preserve existing values.
- `app/api/auth/verify-otp/route.js`: guardian fields included in the applicant-only OTP response DTO.
- `app/api/upload-dokumen/route.js`: guardian fields selected only for authenticated applicant-session refresh; not added to Admin document refresh output.
- `app/api/admin/pendaftar/route.js`: guardian fields included only under existing `pendaftar.verification.read` permission.
- `app/admin/page.js`: guardian fields shown in the existing read-only biodata panel.
- `supabase/migrations/20261111032449_add_parent_guardian_contact_fields.sql`: additive nullable columns and canonical Indonesian phone CHECK constraint.
- `scripts/test-parent-guardian-fields.mjs`: focused contract regression test.

### Staging migration and data verification

- Supabase migration version `20261111032449` (`add_parent_guardian_contact_fields`) applied successfully to `pgmdurnylyuqkikbwwwy`.
- `nama_orang_tua_wali`: `varchar(150)`, nullable.
- `no_wa_orang_tua_wali`: `varchar(20)`, nullable; CHECK requires `08[0-9]{8,13}` when non-null.
- Synthetic SQL persistence/update and invalid-format rejection check completed.
- No table grants or RLS policy changes were made. `anon` and `authenticated` still have no direct table grants; existing server-side service-role access is retained.
- The Bot notification payload, Bot source, Bot conversation state and Daily Report were not changed.

### Verification evidence

- `node scripts/test-parent-guardian-fields.mjs`: PASS.
- `node scripts/test-session-identity.mjs`: PASS.
- `node scripts/test-birth-certificate-upload.mjs`: PASS.
- `node scripts/test-admin-rbac.mjs`: PASS.
- `npm run lint`: exit 0; zero errors and five existing `@next/next/no-img-element` warnings.
- `git diff --check`: PASS (line-ending conversion warnings only).
- Portal dev server started on `http://127.0.0.1:3000`; root route returned HTTP 200 and Next.js compiled the route without reported error.

### Remaining manual UAT

- Use a dedicated non-Admin Staging applicant session to save both optional fields, refresh/re-login, and confirm persistence.
- Confirm Super Admin and Admin Verifikator can see both values; Admin Konsultan must not receive them.
- Confirm blank optional fields do not block Step 1 save or final submit.
- Use dummy parent contact information only. No actual guardian messaging is part of this change.

**Implementation status:** Local/Staging code and schema implementation complete; static contract/regression/lint/smoke checks PASS. Manual authenticated browser UAT remains OPEN.

**Release status:** Not committed, pushed, merged or deployed. Production remains untouched.
