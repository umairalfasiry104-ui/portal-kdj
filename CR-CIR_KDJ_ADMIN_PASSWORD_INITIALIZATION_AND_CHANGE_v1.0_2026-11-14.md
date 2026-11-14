# CR/CIR — Admin Password Initialization & Portal Change Password

**Change ID:** CR-CIR-KDJ-AUTH-2026-11-14-01  
**Project:** KDJ Portal / Supabase Staging `faoxkegwhpcuubtiserj`  
**Date:** 14 November 2026  
**Status:** Approved for Staging implementation by the explicit Owner request in this conversation. Production deployment is out of scope.

## 1. Business request

Initialize passwords for the four existing Admin identities and provide a self-service password-change feature in Admin Portal.

## 2. Approved scope

- Keep the four existing Admin identities, usernames, and roles unchanged.
- Generate one unique, high-entropy temporary password per account.
- Store only an adaptive password hash; never store or log plaintext passwords.
- Require all four accounts to change their temporary password before accessing any Admin dashboard/API capability.
- Provide an authenticated password-change form for subsequent changes.
- Require the current password, new password confirmation, and a minimum 14-character password.
- Increment `session_version` when a password is changed to revoke all prior sessions.
- Use an expiring, restricted password-change session for first login. It must not authorize ordinary Admin APIs.
- Keep support for verifying legacy SHA-256 hashes during transition; new passwords use scrypt.
- Add automated contract tests, lint, and build verification.

## 3. Impact review

| Area | Impact | Control |
|---|---|---|
| Database | Add `admins.must_change_password` | New forward-only migration; default true |
| Authentication | New scrypt hash format | Node.js async `crypto.scrypt`, per-password 16-byte salt, N=2^17/r=8/p=1 |
| Login | Temporary first-login flow | Short-lived restricted cookie, no dashboard access |
| Authorization | Enforce mandatory change server-side | `requireAdminSession` denies accounts flagged for change |
| Password update | New API endpoint | Current password check, rate limit, compare-and-swap update |
| Sessions | Existing sessions invalidated | Increment `session_version`; issue fresh cookie only after success |
| Portal UI | Password management form | Required first-login view and dashboard change-password dialog |
| Bot / WhatsApp | No impact | No Bot code, jobs, or outbound messages changed |
| Storage / booking / reports | No impact | No data model or workflow changes |

## 4. Security decisions

- Do not reuse a common password between Admin accounts.
- Do not return password hashes or plaintext passwords from APIs.
- Temporary credentials are disclosed once to the Owner and must be rotated immediately.
- No password reset by another Admin is introduced in this change.
- The restricted first-login cookie is accepted only by the password-change endpoint.
- Direct requests to any other Admin endpoint remain denied while `must_change_password=true`.
- No default password is committed to source control, SQL migration text, logs, or deployment environment.
- The migration only targets the new Staging project. Production is not touched.

## 5. Acceptance criteria

1. The four expected Admin accounts retain their IDs and roles.
2. Every account has a non-null scrypt hash and `must_change_password=true` after initialization.
3. Each temporary password authenticates only its corresponding Admin account.
4. First login cannot reach dashboard APIs before password change.
5. Successful password change clears the mandatory-change flag, increments session version, and issues a normal session.
6. Old sessions are invalid after password change.
7. Wrong current password, confirmation mismatch, weak password, and stale/concurrent session are rejected.
8. Each Admin can subsequently change their password from Portal.
9. Unit/contract tests, lint, and production build pass.
10. Production project ref and Production deployments remain unchanged.

## 6. Rollback

Do not roll back by restoring or reintroducing plaintext/default passwords. If a defect is found, disable the new Portal password-change UI/API and retain server-side access denial for accounts requiring a password change until a corrected build is ready. The additive database column is backward-compatible for existing code that does not select it, but the new application version must remain paired with the migration.
