# CR/CIR Draft — RT04 Prepare Booking Name Whitespace Normalization

- **CR ID:** CR-CIR-KDJ-RT04-NAME-NORMALIZATION-2026-11-12
- **Status:** DRAFT — explicit owner approval required before applying a new Staging migration
- **Date:** 12 November 2026 (Asia/Jakarta)
- **Environment:** Staging only after approval; Production excluded.
- **Related migration:** `20261110172031_rt04_prepare_schedule_policy_validation`

## 1. Finding

The authoritative SQL statement stored in `supabase_migrations.schema_migrations` and the active Staging function `public.kdj_prepare_booking_approval(...)` contain a two-backslash regex pattern in the name normalization expression:

```sql
regexp_replace(..., '\\s+', ' ', 'g')
```

Staging reports `standard_conforming_strings = on`. A read-only SQL check demonstrated:

- One backslash (`'\s+'`) collapses repeated spaces: `Nama   Dua   Kata` → `Nama Dua Kata`.
- Two backslashes (`'\\s+'`) do not collapse repeated spaces.

The local source initially contained the one-backslash candidate, but it did not match the migration source originally applied to Staging. The canonical migration file has now been restored to the historical Staging source. The one-backslash candidate is preserved at:

`docs/database/migration-source-archive/2026-11-12/20261110172031_rt04_prepare_schedule_policy_validation.pre-reconciliation-candidate.sql`

## 2. Proposed change

Create a new additive migration that replaces only the name-normalization expression in `public.kdj_prepare_booking_approval` with the single-backslash whitespace pattern. Do not edit or replay migration `20261110172031`, and do not change booking policy, signed payload fields, nonce consumption, idempotency, or slot availability predicates.

The new migration filename must be generated using `supabase migration new <descriptive-name>` after approval. The local Supabase CLI is not currently available on PATH.

## 3. Impact review

- **Booking policy:** no change to H-1, weekdays, 09:00–17:00 WIB, 120-minute session, 30-minute buffer, or 150-minute slot block.
- **Identity/signature:** no change to identity references, attestation, nonce, hash payload, or replay protection.
- **Database:** one `CREATE OR REPLACE FUNCTION` migration; no table, column, index, trigger, or ACL change intended.
- **Bot/Portal:** no request contract change.
- **Security:** no new role privilege or exposed endpoint.
- **Rollback:** restore the prior function definition from the authoritative Staging migration source via a separate reviewed rollback migration. Do not rewrite migration history.

## 4. Required non-live verification after approval

- Contract-test repeated spaces, leading/trailing whitespace, tabs, mixed whitespace, empty input and Unicode names.
- Confirm the function retains service_role-only EXECUTE and an empty `search_path`.
- Rerun Portal/Bot relevant RT04 and booking regression tests.
- Read back active function definition and ACL after applying the new Staging migration.

## 5. Safety disposition

No Staging SQL, function, ACL, or migration-history row was changed during this investigation. This issue is separate from the fixed H-1/weekday/working-hours booking validation behavior. Do not apply the proposed fix until the owner approves this CR/CIR.
