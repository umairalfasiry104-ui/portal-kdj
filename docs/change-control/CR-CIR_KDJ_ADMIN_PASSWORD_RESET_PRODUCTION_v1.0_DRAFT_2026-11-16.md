# CR/CIR — Production Admin Password Reset and Mandatory First-Login Rotation

**Change ID:** CR-CIR-KDJ-AUTH-PRODUCTION-RESET-2026-11-16-01  
**Project:** KDJ Portal / Supabase Production `faoxkegwhpcuubtiserj`  
**Date:** 16 November 2026  
**Status:** DRAFT / BLOCKED — owner requested reset; execution is held until the Production Portal is reachable and first-login flow is verified.  
**Related:** `CR-CIR_KDJ_ADMIN_PASSWORD_INITIALIZATION_AND_CHANGE_v1.0_2026-11-14.md` (Staging-only scope; Production was explicitly out of scope).

## 1. Request and intended outcome

Reset the passwords of all four existing Admin accounts with four distinct, high-entropy initial passwords. Each Admin receives only their own initial credential and must change it using the Portal's authenticated self-service flow. No common password is allowed.

## 2. Read-only Production evidence

Supabase Production project `faoxkegwhpcuubtiserj`:
- Four expected Admin accounts exist and are active: `superadmin`, `konsultan`, `verifikator`, and `viewer`.
- All four currently have a non-empty scrypt password hash.
- `admins.must_change_password` exists and is `false` for all four.
- `admins.session_version` is present and can be incremented to revoke existing sessions.
- No password hash, plaintext credential, or account identity/role was changed in this inspection.

Local Portal implementation:
- `/api/admin/auth` checks `must_change_password` and issues a restricted `admin_password_change` session when true.
- `/api/admin/auth/change-password` verifies current password, new-password policy and confirmation, checks the restricted session, and uses a compare-and-swap database update while incrementing `session_version`.
- Local `test-admin-password-contract.mjs` passed (scrypt hashing, verification, wrong-password rejection, unique salts).
- Local `test-admin-rbac.mjs` passed.

Production reachability / Vercel checks:
- `https://pendaftaran.kuliahdijordan.com/`, `/admin`, `/admin/`, and `/api/admin/auth` returned HTTP 404 from the public endpoint during this audit.
- The currently connected Vercel team did not return a `portal-kdj` project in its project listing.
- Vercel reported no project-domain associations for the apex `kuliahdijordan.com` and no alias for `pendaftaran.kuliahdijordan.com`.
- Vercel domain configuration reports `misconfigured = true`. Actual nameservers are `ns1.niagahoster.com` and `ns2.niagahoster.com`; the Vercel record expects `ns1.vercel-dns.com` and `ns2.vercel-dns.com`.
- The connected Vercel scope may differ from the historical team/project inventory. Reconcile the actual Owner account/team and intended Portal project before any DNS or deployment action.

## 3. Execution boundary

**No Production password reset has been executed. No temporary passwords have been generated or disclosed.**

Resetting hashes and setting `must_change_password=true` before the correct Production Portal is live would force every Admin into a first-login flow that cannot currently be reached. This could lock all four Admins out of the Portal.

No DNS, Vercel project, alias, deployment, or Supabase password data has been changed.

## 4. Preconditions before execution

1. Owner confirms the correct Vercel account/team and the exact Production Portal project.
2. Restore/verify the Production domain-to-project association and HTTPS route. Test the login page and `/api/admin/auth` against the actual Production deployment.
3. Verify deployed Production code includes the restricted first-login session, mandatory-password-change gate, password-change UI, and `/api/admin/auth/change-password` implementation.
4. Complete one non-production first-login UAT with a throwaway Admin fixture, verifying normal Admin APIs are denied until password change and the new password establishes a normal session.
5. Owner reconfirms the Production reset execution after the Portal is reachable.

## 5. Planned transactional update

When preconditions pass:
- Generate four independent random initial passwords in memory only.
- Hash each using the existing `hashAdminPassword()` scrypt implementation; do not write plaintext into any file, SQL migration, log, or environment variable.
- Update the four exact Admin rows in one transaction: new `password_hash`, `must_change_password = true`, `session_version = session_version + 1`, and `updated_at`.
- Verify four updated rows, active status, non-empty scrypt hashes, mandatory-change flag true, and session-version increments.
- Disclose each one-time initial password to the Owner in this conversation, associated only with its Admin username. The Owner distributes each credential privately to the correct Admin.
- Each Admin changes their password individually on first login; the temporary password is not retained after the change.

## 6. Acceptance criteria

- All four identities and roles remain unchanged.
- Every initial password authenticates only its intended Admin account.
- Every first-login session can access only the change-password endpoint.
- Ordinary dashboard/API access is denied while `must_change_password=true`.
- Successful password change clears the flag, increments session version, revokes all prior sessions, and establishes a normal session.
- Wrong current password, mismatched confirmation, weak password, stale session, or concurrent update fails closed.
- After change, each Admin can log in with their new password independently.

## 7. Current next action

Resolve the correct Vercel account/team and reattach the Production Portal domain to its actual project. Do not alter DNS records, nameservers, aliases, project linkage, deployments, or Production password hashes until the Owner confirms the exact target and the Portal login/change-password route is verified live.
