# CR/CIR — Konfirmasi Rekening Pembayaran Pendaftaran KDJ

- **CR ID:** CR-CIR-KDJ-PAYMENT-ACCOUNT-001
- **Version:** 1.0
- **Decision date:** 12 November 2026
- **Decision owner:** Umair (project owner)
- **Status:** OWNER APPROVED — implement in Local/Staging
- **Target:** Applicant Portal UI and Bot Knowledge Base/Guardrails
- **Production:** No Production change or deployment is included.

## 1. Owner-confirmed source of truth

Project owner explicitly confirmed:

- **Bank:** Bank Syariah Indonesia (BSI)
- **Account number:** 7169735128
- **Legal account holder:** Yayasan Generasi Cerdas Akhlakul Karimah
- **Purpose:** KDJ initial registration and administration fee payment, Rp 1.500.000.
- **Payment instruction boundary:** Payment and transfer-proof submission remain through the official applicant Portal, `pendaftaran.kuliahdijordan.com`. The Bot must not request payment through WhatsApp private chat or distribute private account details through chat.

This owner confirmation supersedes the legacy payee string "Kuliah di Jordan Official" previously present beside the same account number in Bot prompts.

## 2. Change Request

Ensure the Portal and Bot's approved factual/guardrail copy use the same owner-confirmed BSI account number and legal account holder.

## 3. Impact review

### Portal
- Existing Portal payment card already displayed BSI, account number 7169735128 and Yayasan Generasi Cerdas Akhlakul Karimah.
- No UI business logic or bank field behavior changes are required.
- Add a contract test to protect the displayed account number and legal account holder.

### Bot
- Update `03_knowledge_base.md` with the confirmed payee.
- Update `05_guardrails_escalation.md` with the same account/payee and keep the existing prohibition against private WhatsApp payment instructions.
- Bump KB version 3.1.2 → 3.1.3 and Guardrails 3.1.4 → 3.1.5; update review/effective dates to 12 November 2026.
- Add prompt contract assertions so the Portal-facing facts and high-priority Guardrails remain aligned.

### Database, API, security and operations
- No database schema, migration, RPC, API, key, ACL, RLS, Storage, payment gateway or file upload behavior change.
- No new payment processing capability or WhatsApp payment flow.
- No customer data or financial transaction is modified by this change.

## 4. Verification criteria

- Portal test verifies BSI, account number and exact legal account holder.
- Bot prompt test verifies the same account/payee in KB and Guardrails and rejects the previous conflicting copy.
- Bot baseline and all five prompt metadata checks pass.
- Prompt identity/version contract passes.
- Portal focused payment-account test passes.
- Portal lint/build remains green.
- Live customer-facing payment instruction UAT remains part of the owner's final UAT pack.

## 5. Rollback

Revert only the copy and focused tests under this CR. Do not change or delete payment records, applicant submissions or uploaded transfer proofs. If the owner provides a new official account, create a new CR/CIR and update all copies atomically.

## 6. Approval record

**Approved by project owner:** Umair confirmed on 12 November 2026 that the correct name for BSI account 7169735128 is **Yayasan Generasi Cerdas Akhlakul Karimah**.

**Implementation authorization:** Local/Staging source and documentation only. Production remains untouched.


## 7. Execution evidence — 12 November 2026
- Owner confirmation recorded: account 7169735128, legal account holder Yayasan Generasi Cerdas Akhlakul Karimah.
- Portal: `npm run test:payment-account` PASS; all 15 `scripts/test-*.mjs` scripts PASS; ESLint 0 errors / 5 existing `no-img-element` warnings; Next.js production build PASS (19/19 static pages).
- Bot: all 16 `scripts/test-*.mjs` scripts PASS; `npm run test:baseline` PASS; `scripts/test-prompt-identity-update.mjs` PASS; `npm run check` PASS; `npm run security:check` PASS (0 production vulnerabilities, 207 verified registry signatures, 30 attestations).
- Source scan found no old account/payee tuple in the current Portal/Bot operational source. Negative regression assertions intentionally contain the old tuple as a prohibited value.
- Portal and Bot copy remain limited to registration instructions through the official Portal; no WhatsApp payment collection behavior was added.
- Live customer-facing payment UAT remains for the owner; no real payment or customer message was initiated by this CR.
