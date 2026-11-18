# KDJ — Environment, Documentation & Release Authority

**Last reconciled:** 15 November 2026 (Asia/Jakarta)  
**Authority:** Owner-confirmed environment decision + KDJ Master System Specification v1.0 + KDJ Audit Protocol v2.  
**Status:** Current operating reference. Historical evidence documents retain their original test facts and are not rewritten as if they occurred on the current project.

## 1. Environment of record

| Environment | Supabase project ref | Current treatment |
|---|---|---|
| **Staging — official UAT target** | `faoxkegwhpcuubtiserj` | **OWNER-CONFIRMED 15 Nov 2026.** Use this project for the current local Staging Portal/Bot and new UAT evidence. |
| Previous Staging | `pgmdurnylyuqkikbwwwy` | Retired from the active Staging target. References and test results recorded against it are historical evidence only. Do not run new UAT or migrations against it. |
| Previously referenced Production/legacy project | `oudjeospzpiwkupfutow` | Separate from Staging. This identifier appears in prior Production/legacy records; verify current ownership, lifecycle and intended Production mapping before any use. Never repoint it as part of Staging work. |

The local Portal and Bot environment files were previously inspected as pointing to `faoxkegwhpcuubtiserj`. Re-check only by comparing the Supabase URL host/project ref and required variable presence; never print, copy into documentation, or expose secret values.

**Never infer environment from a branch name, Vercel alias, local .env file name, or old report.** Compare the project ref at the execution boundary before any command that can read or write remote data.

## 2. Database and migration status

The latest recorded read-only audit of the official Staging project found:

- 22 migration versions in the remote migration history.
- The following six migration versions were recorded as applied and their expected database objects were verified:
  - `20261114000000_kdj_departure_packages_and_installments.sql`
  - `20261114000001_kdj_attestation_key_storage_compatibility.sql`
  - `20261114000002_kdj_bot_attestation_key_reconcile.sql`
  - `20261114150930_admin_password_change_controls.sql`
  - `20261114152054_admin_scrypt_hash_compatibility.sql`
  - `20261114152234_admin_scrypt_hash_trigger_guard.sql`
- No migration was rerun as part of the 15 November documentation reconciliation.

The migration list/object checks are evidence from the stated audit, not a guarantee of live runtime readiness. Before applying any further migration, run a dry-run against the confirmed ref, reconcile local source with remote history, review SQL/ACL/RLS impact, and obtain the required authorization. Never use a blanket `db push` as a substitute for migration review.

## 3. Current system and release boundary

**Current disposition: automated code/database checks have a good baseline; live UAT and deployment readiness are not yet closed.**

Previously recorded local checks include Portal tests/lint/build, Bot automated tests/security audit, Supabase migration/object checks, RLS/grant checks and key-ID reconciliation. These are not fresh test executions from this documentation-only update. Runtime readiness must be established with fresh observations on the day of UAT.

Before declaring the current Staging live-UAT ready, collect fresh evidence for:
1. Exactly one Portal and one Bot process; no duplicate WhatsApp LocalAuth session owner.
2. Portal/Bot Supabase refs both resolve to `faoxkegwhpcuubtiserj`; key parity is checked by identifier or safe comparison without printing secrets.
3. Fresh Portal, Bot, Supabase, Gemini and WhatsApp heartbeats; WhatsApp state READY; no unresolved high-severity incident.
4. Portal-to-Bot protected API call succeeds through the intended local/private network route.
5. Dedicated tester-controlled WhatsApp number and real OTP journey: request, receive, verify, cooldown/replay/lockout as applicable.
6. Applicant journey: biodata, mandatory Akta upload, payment proof, final submit, Bot notification correlation, role ownership and cleanup.
7. RT-04: customer-controlled summary, exact SETUJU, replay/idempotency evidence, a second pending approval BATAL, Outbox provider acknowledgement and reconciliation.
8. Actual authenticated Admin browser UAT for Super Admin, Admin Konsultan and Admin Verifikator.
9. Daily Report is generated manually in Admin Portal and copied; verify role boundary and privacy-safe output.

A historic pass on `pgmd...` is not proof of a pass on `faox...`. Re-run only the impacted tests required by the environment change, consistent with KDJ Audit Protocol v2; do not repeat unrelated tests whose evidence remains valid.

## 4. Daily Report owner direction — latest policy

Effective 15 November 2026, the active release scope is **manual Admin Portal report generation and clipboard copy only**.

- No automated WhatsApp report delivery.
- No automated email delivery.
- No scheduled outbound report dispatch or broadcast.
- Keep Bot report-delivery worker/feature flag disabled and do not enqueue or send report deliveries.
- Existing Bot activity event ledger and manual Portal report remain within scope.
- CR/CIR v2.0 dated 12 November records a prior approval for automatic delivery; this later owner direction supersedes that delivery/scheduling portion until the owner explicitly re-approves it through the required change-control process.

This does not authorize code/schema changes to implement new reporting behavior. The Master System Specification v1.0 remains frozen.

## 5. Vercel, VPS and Production boundary

- No deployment was performed by the 15 November audit/documentation refresh.
- The currently accessible Vercel team scope did not expose a KDJ project. A separate historical OD-08 record from 10 November reported a `portal-kdj` project. Resolve the account/team/project access discrepancy before touching Vercel settings or initiating deployment.
- Do not infer that a GitHub push proves a Vercel deployment target is configured.
- No KDJ Bot VPS deployment has been verified. Treat VPS readiness as **OPEN** until the actual host, owner access, runtime, process manager, persistent WhatsApp LocalAuth storage, firewall, HTTPS reverse proxy, monitoring, restart and backup/recovery controls are inspected.
- A Bot API bound to `127.0.0.1:3001` is reachable only from the same machine. A Vercel-hosted Portal cannot call the user's PC loopback. Remote integration requires an owner-approved, authenticated, HTTPS-reachable Bot endpoint with ingress controls.
- Keep Production isolated. Do not run migrations, change secrets, promote aliases, change DNS, or deploy to Production without explicit owner approval and a separately recorded release gate.

## 6. Source and change-control reference

Local repositories:
- Portal: `C:\Users\umair\KDJ stagging\kdj-portal`
- Bot: `C:\Users\umair\KDJ stagging\kdj-wa-bot`

The last confirmed GitHub push recorded:
- Portal `main`: `045de03334ae6e3d4c7c7f8be260f002b4da7cb4`
- Bot `main`: `551df0173e5d0c88860b9a6914416fdcaa92a08e`

Those hashes are the last confirmed pushed commits, not necessarily the complete current local worktree. Inspect `git status` and review each exact file before staging; preserve pre-existing local modifications, logs, session folders and backups. Never use broad `git add .`.

All changes outside frozen Master Spec v1.0 require CR/CIR and impact review. No Production change without explicit approval.

## 7. Document lifecycle rules

- Current environment/release truth belongs in this document and the matching Bot environment status record.
- UAT reports and audit snapshots retain their original dates, refs, outcomes, hashes and evidence. Add a clearly dated supersession note; never rewrite old project evidence to look as though it ran on `faox...`.
- A test result is valid only for its recorded commit/source, environment, method and observation time.
- Credentials, OTPs, private keys, customer identifiers, phone numbers and message contents must not be copied into documentation.
- Update the runbook and roadmap whenever environment authority or operational policy changes.

## 8. Reconciliation record

| Date | Update |
|---|---|
| 15 Nov 2026 | Owner confirmed `faoxkegwhpcuubtiserj` as the official Staging project, replacing `pgmdurnylyuqkikbwwwy`. |
| 15 Nov 2026 | Confirmed manual Admin Portal Daily Report only; automated WhatsApp/email delivery remains unauthorized. |
| 15 Nov 2026 | Vercel KDJ project access discrepancy and VPS readiness remain open; no deployment initiated. |
