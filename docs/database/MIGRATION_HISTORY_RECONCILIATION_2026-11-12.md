# Supabase Staging Migration History Reconciliation
**Date:** 12 November 2026 (Asia/Jakarta)  
**Project:** Staging `pgmdurnylyuqkikbwwwy`  
**Scope:** Local Portal migration source alignment only. No database DDL or migration execution.

## Outcome
**B-02 CLOSED — SOURCE/MANIFEST ALIGNED.** The authoritative Staging migration history contains 12 versions. The Portal `supabase/migrations` directory now contains the corresponding 12 versioned SQL files. Three missing SQL sources were recovered byte-for-byte from `supabase_migrations.schema_migrations.statements[1]` and verified by MD5. Three non-canonical local SQL files were moved, not deleted, into `docs/database/migration-source-archive/2026-11-12/`.

## Canonical Staging manifest
| Version | Migration name |
|---|---|
| `20261109133525` | `kdj_lead_qualification_fu_final_20261109` |
| `20261109134305` | `kdj_enable_pg_cron_staging_20261109` |
| `20261109134454` | `kdj_lead_qualification_fk_indexes_20261109` |
| `20261110005919` | `kdj_direct_customer_booking_approval_gate_rt04` |
| `20261110005924` | `kdj_admin_booking_attested_lane` |
| `20261110010908` | `kdj_staging_key_bootstrap_window` |
| `20261110011336` | `kdj_lock_staging_key_bootstrap` |
| `20261110014506` | `kdj_staging_revoke_legacy_booking_bypass` |
| `20261110083515` | `kdj_bot_daily_reporting_20261109` |
| `20261110123155` | `kdj_otp_durable_shared_throttle` |
| `20261110172031` | `rt04_prepare_schedule_policy_validation` |
| `20261111032449` | `add_parent_guardian_contact_fields` |

## Recovered authoritative SQL files
Recovered from the original migration statement stored by Supabase. The resulting file byte lengths and MD5 values match the database record:

| File | Bytes | MD5 |
|---|---:|---|
| `20261109133525_kdj_lead_qualification_fu_final_20261109.sql` | 40,599 | `7bdc20694f67c3ec47ada26fb23d1583` |
| `20261109134305_kdj_enable_pg_cron_staging_20261109.sql` | 165 | `b5c9b02deed121d5547a32d4e97a4af2` |
| `20261109134454_kdj_lead_qualification_fk_indexes_20261109.sql` | 320 | `f72a34f615c3600f4008d9c697ed3eb1` |

The previous local lead-qualification SQL file was not byte-identical to the applied Staging source: one function call used unqualified `jsonb_build_object`, while the Staging-applied source uses `pg_catalog.jsonb_build_object`. The previous file is preserved in the archive rather than treated as the authoritative migration.

## Archived local-only source files
These files were present in the local migration folder but had no corresponding version in the Staging migration history:

- `20261029_kdj_admin_update_pendaftar_with_docs.sql`
- `20261108_kdj_monitoring_followup_foundation.sql`
- `20261109_kdj_lead_qualification_fu_final.sql` (superseded local source; see the exact canonical Staging copy above)

The first two files were not discarded. Read-only Staging introspection confirmed:
- `kdj_admin_update_pendaftar_with_docs` exists, has an empty `search_path`, is INVOKER, and is executable by `service_role` only (not `anon` or `authenticated`).
- All nine monitoring/follow-up tables declared by the 20261108 source exist and have RLS enabled.
- All seven functions declared by the 20261108 source exist; they are SECURITY DEFINER with empty `search_path`; `anon` and `authenticated` cannot execute them; `service_role` can execute them.
- All seven declared indexes and both lifecycle triggers exist.

Because those local-only scripts have no Staging migration-version entry and their declared objects already exist, they are retained as historical source/evidence outside `supabase/migrations`. They must not be replayed against Staging as migrations.

## Verification and safety
- Supabase Staging migration history returned exactly 12 versions.
- Local Portal migration directory was reconciled to the same 12 version prefixes and names.
- The three recovered sources were checksum-verified.
- The relevant Staging tables, functions, indexes, triggers, RLS flags, and function ACLs were checked read-only.
- No SQL migration was run, no rows in `supabase_migrations.schema_migrations` were inserted/updated/deleted, and no schema/ACL/RLS changes were performed.
- Supabase CLI is not currently available on the local machine PATH, so the final comparison was performed from the Supabase migration metadata and exact local manifest/checksums rather than `supabase migration list --linked`.
- No Git stage, commit, push, merge, reset, or file deletion occurred.

## Final disposition
B-02 is closed for Staging/local source-of-truth alignment. This does not authorize running or deploying pending migrations, applying schema changes, or making any Production changes.


## Supplemental canonical-source checksum verification — 12 Nov 2026

A second read-only reconciliation compared every local SQL file with the original `statements[1]` text stored in `supabase_migrations.schema_migrations`. CRLF was normalized to LF; the final newline was retained or omitted to match the exact stored statement serialization. Result: **12/12 exact MD5 matches**.

| Version | Canonical Staging MD5 | Result |
|---|---|---|
| `20261109133525` | `7bdc20694f67c3ec47ada26fb23d1583` | PASS |
| `20261109134305` | `b5c9b02deed121d5547a32d4e97a4af2` | PASS |
| `20261109134454` | `f72a34f615c3600f4008d9c697ed3eb1` | PASS |
| `20261110005919` | `b9e3952fe1191763835e27312e008081` | PASS |
| `20261110005924` | `de5dd577d39f9f37826abdbb7373b280` | PASS |
| `20261110010908` | `065f333bf40a134dcf9724556c63c1fa` | PASS |
| `20261110011336` | `77f0e0e5e54a22d8fc5d7302fe28c24d` | PASS |
| `20261110014506` | `175617c749ef7199c05569ece0084d2a` | PASS |
| `20261110083515` | `98c85f0cc8f1b557cc84b33400698606` | PASS |
| `20261110123155` | `fcaffb7bba6d3198a75ed430f22495fb` | PASS |
| `20261110172031` | `cf9f62a357437f7da8f7ef82250c7d2f` | PASS |
| `20261111032449` | `8e5ca304ec7dccccb102945d04d700ed` | PASS |

The one-backslash RT04 name-normalization candidate was preserved outside `supabase/migrations` before restoring the historical canonical file. This prevents an unreviewed source change from being represented as the migration already applied to Staging.

### Separate follow-up issue

Read-only SQL confirmed the active RT04 function uses the historical two-backslash regex under `standard_conforming_strings=on`. A controlled SQL expression test confirmed this pattern does not collapse repeated whitespace, while the single-backslash pattern does. This is documented separately in `docs/change-control/CR-CIR_RT04_NAME_NORMALIZATION_FIX_DRAFT_2026-11-12.md`. No database change was applied; a new additive migration requires explicit approval.

**Final B-02 disposition: CLOSED.** Local manifest and all 12 migration source files now match Staging history by version/name and checksum. No migration was replayed and no remote schema/history row was changed.
