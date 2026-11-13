# Archived migration-source files — 12 November 2026

These SQL files are preserved for audit/history only. They are not part of the canonical Supabase Staging migration manifest and must not be run or copied back into `supabase/migrations` without a reviewed change-control decision.

| Archived source | Disposition |
|---|---|
| `20261029_kdj_admin_update_pendaftar_with_docs.sql` | Local-only historical source. Declared function is present in Staging and has been read-only verified. |
| `20261108_kdj_monitoring_followup_foundation.sql` | Local-only historical source. Declared tables, functions, indexes and triggers are present in Staging and have been read-only verified. |
| `20261109_kdj_lead_qualification_fu_final.sql` | Superseded source file; it differs from the SQL statement actually recorded by Staging. The canonical version is `supabase/migrations/20261109133525_kdj_lead_qualification_fu_final_20261109.sql`. |

No database migration was applied during this reconciliation.


- `20261110172031_rt04_prepare_schedule_policy_validation.pre-reconciliation-candidate.sql`: retained one-backslash name-whitespace normalization candidate recovered from the local working copy. It differs from the original Staging-applied migration and is not an applied migration source. See `docs/change-control/CR-CIR_RT04_NAME_NORMALIZATION_FIX_DRAFT_2026-11-12.md` before considering a new additive migration.
