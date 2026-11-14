-- Temporary, one-use staging-only window to provision isolated RT-04 and Admin HMAC keys.
-- Must be followed immediately by 20261110080100_kdj_lock_staging_key_bootstrap.sql.

begin;

create or replace function public.kdj_bootstrap_admin_booking_attestation_key(
    p_key_id text,
    p_secret_hex text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_existing_key bytea;
    v_new_key bytea;
begin
    if p_key_id is null
       or p_key_id !~ '^[A-Za-z0-9._-]{1,80}$'
       or p_secret_hex is null
       or p_secret_hex !~ '^[a-fA-F0-9]+$'
       or pg_catalog.length(p_secret_hex) < 64
       or pg_catalog.length(p_secret_hex) > 512
       or pg_catalog.length(p_secret_hex) % 2 <> 0 then
        return pg_catalog.jsonb_build_object('ok', false, 'code', 'INVALID_KEY_MATERIAL');
    end if;

    v_new_key := pg_catalog.decode(p_secret_hex, 'hex');
    perform pg_catalog.pg_advisory_xact_lock(82026, 4101);

    select k.key_bytes
      into v_existing_key
      from private.kdj_admin_booking_attestation_keys as k
     where k.key_id = p_key_id;

    if found then
        if v_existing_key = v_new_key then
            return pg_catalog.jsonb_build_object('ok', true, 'code', 'KEY_ALREADY_MATCHES');
        end if;
        return pg_catalog.jsonb_build_object('ok', false, 'code', 'KEY_ALREADY_PROVISIONED');
    end if;

    if exists (select 1 from private.kdj_admin_booking_attestation_keys) then
        return pg_catalog.jsonb_build_object('ok', false, 'code', 'BOOTSTRAP_ALREADY_COMPLETED');
    end if;

    insert into private.kdj_admin_booking_attestation_keys (key_id, hmac_secret, key_bytes, status)
    values (p_key_id, pg_catalog.lower(p_secret_hex), v_new_key, 'ACTIVE');

    return pg_catalog.jsonb_build_object('ok', true, 'code', 'KEY_PROVISIONED');
exception
    when unique_violation then
        return pg_catalog.jsonb_build_object('ok', false, 'code', 'BOOTSTRAP_ALREADY_COMPLETED');
end;
$$;

create or replace function public.kdj_bootstrap_rt04_bot_attestation_key(
    p_key_id text,
    p_secret_hex text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_existing_key bytea;
    v_new_key bytea;
begin
    if p_key_id is null or p_key_id !~ '^[A-Za-z0-9._-]{1,80}$'
       or p_secret_hex is null
       or p_secret_hex !~ '^[a-fA-F0-9]+$'
       or pg_catalog.length(p_secret_hex) < 64
       or pg_catalog.length(p_secret_hex) > 512
       or pg_catalog.length(p_secret_hex) % 2 <> 0 then
        return pg_catalog.jsonb_build_object('ok', false, 'code', 'INVALID_KEY_MATERIAL');
    end if;

    v_new_key := pg_catalog.decode(p_secret_hex, 'hex');
    perform pg_catalog.pg_advisory_xact_lock(82026, 4102);

    select k.key_bytes
      into v_existing_key
      from private.kdj_bot_attestation_keys as k
     where k.key_id = p_key_id;

    if found then
        if v_existing_key = v_new_key then
            return pg_catalog.jsonb_build_object('ok', true, 'code', 'KEY_ALREADY_MATCHES');
        end if;
        return pg_catalog.jsonb_build_object('ok', false, 'code', 'KEY_ALREADY_PROVISIONED');
    end if;

    if exists (select 1 from private.kdj_bot_attestation_keys) then
        return pg_catalog.jsonb_build_object('ok', false, 'code', 'BOOTSTRAP_ALREADY_COMPLETED');
    end if;

    insert into private.kdj_bot_attestation_keys (key_id, hmac_secret, key_bytes, status)
    values (p_key_id, pg_catalog.lower(p_secret_hex), v_new_key, 'ACTIVE');

    return pg_catalog.jsonb_build_object('ok', true, 'code', 'KEY_PROVISIONED');
exception
    when unique_violation then
        return pg_catalog.jsonb_build_object('ok', false, 'code', 'BOOTSTRAP_ALREADY_COMPLETED');
end;
$$;

revoke all on function public.kdj_bootstrap_admin_booking_attestation_key(text, text)
    from public, anon, authenticated;
revoke all on function public.kdj_bootstrap_rt04_bot_attestation_key(text, text)
    from public, anon, authenticated;

grant execute on function public.kdj_bootstrap_admin_booking_attestation_key(text, text)
    to service_role;
grant execute on function public.kdj_bootstrap_rt04_bot_attestation_key(text, text)
    to service_role;

commit;


