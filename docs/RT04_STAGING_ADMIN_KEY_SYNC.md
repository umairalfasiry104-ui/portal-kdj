# RT-04 Staging Admin HMAC Key Sync

## Current status
- The RT-04 Bot key proof succeeded against Staging. Do not rotate the Bot key.
- The Admin Portal local key is valid 32 bytes (64 hex characters), but a signature proof returned `INVALID_ADMIN_ATTESTATION`.
- Staging has one active `admin-v1` row, but no Admin audit rows and no RT-04 approval rows exist.
- The temporary service_role bootstrap permission has been revoked. The bootstrap function is PostgreSQL-operator-only.

## One-time reconciliation
1. Keep the current value of `KDJ_ADMIN_BOOKING_HMAC_KEY` in the Staging Portal `.env.local` file.
2. In Supabase Dashboard, open the **KDJ Staging** SQL Editor. Do not use Production.
3. Copy the current value from the local `.env.local` file and replace only the placeholder below. Never paste the value into chat, Git, an issue, or a log.
4. Run this transaction. It aborts if the Admin audit table contains any row.

```sql
begin;

do $guard$
begin
    if exists (select 1 from private.kdj_admin_booking_audit) then
        raise exception 'STOP: Admin audit is not empty; key rotation requires a reviewed migration.';
    end if;
end
$guard$;

delete from private.kdj_admin_booking_attestation_keys
where key_id = 'admin-v1';

select public.kdj_bootstrap_admin_booking_attestation_key(
    'admin-v1',
    '<PASTE KDJ_ADMIN_BOOKING_HMAC_KEY HEX HERE>'
);

commit;
```

5. Confirm the result is `KEY_PROVISIONED`. Then verify key metadata without selecting `key_bytes`:

```sql
select key_id, status, octet_length(key_bytes) as key_bytes_length
from private.kdj_admin_booking_attestation_keys;
```

Expected: one row, `admin-v1`, `ACTIVE`, `32`.

## Safety
- The SQL Editor must execute as `postgres`; the bootstrap RPC is intentionally not executable by `service_role`, `anon`, or `authenticated`.
- This is safe only while `private.kdj_admin_booking_audit` is empty. The transaction guard enforces that condition.
- Do not delete or rotate the Bot key. Its signature proof already passed.
- After the SQL succeeds, report only the returned code and metadata row. Do not send either secret value.
