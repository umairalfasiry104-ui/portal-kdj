# CR/CIR — Passport Follow-up via Admin Human

**CR ID:** KDJ-CR-PASSPORT-HUMAN-HANDOFF-2026-11-10  
**Version:** 1.0  
**Date:** 10 November 2026  
**Requestor / decision owner:** Umair  
**Implementation target:** Local Portal + Bot Markdown + Supabase Staging verification  
**Production:** Not authorized; untouched  
**Status:** Owner-approved for local/Staging implementation

## 1. Owner decision

A deferred Passport document is **not uploaded by the applicant in the Portal**. After initial registration, the applicant sends the Passport document to Admin Human's personal WhatsApp number no later than H-45 before departure. Admin Human gives the personal WhatsApp number directly to the applicant.

The Portal must not accept an applicant Passport file. The automated Minje/Bot must not ask for or receive a Passport file. Admin Human is responsible for communicating the official receiving channel to the applicant.

The handoff channel is the personal WhatsApp number of Admin Human. Admin Human gives that number directly to the applicant after registration. The Bot inbox is not a receiving channel. The optional Passport number field remains non-blocking for initial registration. Akta Kelahiran remains mandatory at initial registration and must be uploaded in the Portal.

## 2. Reason and scope

The prior Portal/Markdown language could be understood as allowing a deferred Passport file to be uploaded through the applicant Portal at H-45. The owner clarified that the file handoff belongs directly to Admin Human instead.

This CR changes only the handling channel for the deferred Passport file and its presentation in the applicant Portal. It does not relax the H-45 deadline or the mandatory initial Akta Kelahiran rule.

## 3. Change impact review

### Portal UI
- Remove the applicant Passport file-upload tile.
- Explain that Passport is handed directly to Admin Human after registration and no later than H-45.
- Keep the optional Passport number field non-blocking.
- Change the Portal document count from five to four uploaded academic document slots.

### Server/API and storage
- Remove paspor from the applicant POST /api/upload-dokumen allowlist.
- Keep legacy/Admin read and signed-URL support for existing Passport document records.
- Keep Passport out of the initial final-submit required-document list.
- Do not add an Admin Passport upload endpoint or store externally handed Passport files in the Portal under this CR; the Admin Human operating channel is outside this Portal upload flow.

### Bot prompt and privacy
- Update SOP, KB, Few-Shot and Guardrails to describe the Admin Human handoff.
- Minje/Bot must not ask for or receive the Passport file in automated WhatsApp chat.
- Admin Human communicates the official receiving channel. This document does not invent or authorize a specific channel.

### Database / architecture
- No schema or database migration required.
- No key, ACL, RPC, booking or authentication changes.
- Preserve historical/Admin read support for Passport records.

## 4. Security, privacy and compatibility
- Applicant cannot upload Passport to the Portal through the API, even if a client attempts a direct request.
- Existing Passport document rows remain readable for authorized Admin academic review.
- Passport number remains optional at first submission.
- Akta Kelahiran remains mandatory and is not covered by the Passport deferral.
- No file or sensitive document data is requested by Minje/Bot.

## 5. Verification evidence — 10 November 2026
- Akta/Passport Portal contract test: PASS.
- Applicant POST upload request with jenis_dokumen=paspor returned HTTP 400; synthetic applicant removed; no Passport object stored: PASS.
- Admin/legacy academic document retrieval still includes paspor: contract PASS.
- Bot check, baseline, scheduling, qualification, daily-report and RT04 automated suites after prompt update: PASS.
- Portal ESLint: PASS, zero errors and five existing no-img-element warnings.
- Portal production build after Portal Passport tile/API change: PASS (Next.js 16.4.3, TypeScript PASS, 19 static pages generated).
- Production not modified.

## 6. Operational handoff channel — owner confirmed
The applicant sends the deferred Passport file to the **personal WhatsApp number of Admin Human** after registration and no later than H-45 before departure. Admin Human gives that number directly to the applicant. The automated Minje/Bot WhatsApp inbox must never be used to receive the Passport file.

## 7. Rollback
If implementation regression occurs, revert the CR-scoped Portal tile/API allowlist and Markdown changes only. Do not remove existing Passport document rows, historical storage records, or unrelated applicant data as part of rollback.

## 8. Approval
**Owner decision:** Approved explicitly by Umair in the KDJ work session on 10 November 2026.  
**Implementation boundary:** Local/Staging only.  
**Production deployment:** Not authorized by this CR.
