-- Secure Admin manual booking lane for RT-04 legacy caller cutover.
-- Depends on 20261109171100_kdj_direct_customer_booking_approval_gate.sql.
-- Additive only: legacy caller permissions remain unchanged until OD-08 is closed.

begin;

create table if not exists private.kdj_admin_booking_attestation_keys (
    key_id text primary key,
    key_bytes bytea not null,
    hmac_secret text not null CHECK (hmac_secret ~ '^[a-fA-F0-9]+$' AND pg_catalog.length(hmac_secret) BETWEEN 64 AND 512 AND pg_catalog.length(hmac_secret) % 2 = 0),
    status text not null default 'ACTIVE',
    created_at timestamptz not null default pg_catalog.clock_timestamp(),
    constraint kdj_admin_booking_attestation_keys_key_id
        check (key_id ~ '^[A-Za-z0-9._-]{1,80}$'),
    constraint kdj_admin_booking_attestation_keys_key_length
        check (pg_catalog.octet_length(key_bytes) >= 32),
    constraint kdj_admin_booking_attestation_keys_status
        check (status in ('ACTIVE', 'REVOKED'))
);

create unique index if not exists kdj_admin_booking_attestation_one_active_key
    on private.kdj_admin_booking_attestation_keys ((status))
    where status = 'ACTIVE';

create table if not exists private.kdj_admin_booking_audit (
    audit_id uuid primary key default pg_catalog.gen_random_uuid(),
    actor_admin_id uuid not null,
    actor_username text not null,
    actor_role text not null,
    actor_session_version integer not null,
    action text not null default 'CREATE',
    booking_id uuid,
    idempotency_key_hash text not null,
    request_hash text not null,
    nonce uuid not null,
    issued_at timestamptz not null,
    outcome_code text not null,
    outcome jsonb not null,
    created_at timestamptz not null default pg_catalog.clock_timestamp(),
    constraint kdj_admin_booking_audit_action
        check (action = 'CREATE'),
    constraint kdj_admin_booking_audit_role
        check (actor_role in ('Super Admin', 'Admin Konsultan')),
    constraint kdj_admin_booking_audit_session_version
        check (actor_session_version > 0),
    constraint kdj_admin_booking_audit_hashes
        check (idempotency_key_hash ~ '^[a-f0-9]{64}$'
            and request_hash ~ '^[a-f0-9]{64}$')
);

create unique index if not exists kdj_admin_booking_audit_nonce
    on private.kdj_admin_booking_audit (nonce);

create unique index if not exists kdj_admin_booking_audit_idempotency
    on private.kdj_admin_booking_audit (idempotency_key_hash);

revoke all on table private.kdj_admin_booking_attestation_keys
    from public, anon, authenticated, service_role;
revoke all on table private.kdj_admin_booking_audit
    from public, anon, authenticated, service_role;

create or replace function private.kdj_admin_booking_verify_attestation(
    p_key_id text,
    p_fields text[],
    p_nonce uuid,
    p_signature text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_key bytea;
    v_payload text;
    v_expected bytea;
    v_provided bytea;
    v_matches boolean;
begin
    if p_key_id is null
       or p_nonce is null
       or p_signature is null
       or p_signature !~ '^[a-fA-F0-9]{64}$'
       or p_fields is null
       or pg_catalog.cardinality(p_fields) <> 8 then
        return false;
    end if;

    select k.key_bytes
      into v_key
      from private.kdj_admin_booking_attestation_keys as k
     where k.key_id = p_key_id
       and k.status = 'ACTIVE';

    if v_key is null then
        return false;
    end if;

    v_payload := private.kdj_rt04_canonical_payload(
        array['KDJ-ADMIN-BOOKING', '1', p_key_id, 'CREATE']
        || p_fields
        || array[p_nonce::text]
    );

    v_expected := extensions.hmac(
        pg_catalog.convert_to(v_payload, 'UTF8'),
        v_key,
        'sha256'
    );
    v_provided := pg_catalog.decode(pg_catalog.lower(p_signature), 'hex');

    if pg_catalog.octet_length(v_provided) <> 32 then
        return false;
    end if;

    select pg_catalog.bool_and(
        pg_catalog.get_byte(v_expected, g.i) = pg_catalog.get_byte(v_provided, g.i)
    )
      into v_matches
      from pg_catalog.generate_series(0, 31) as g(i);

    return coalesce(v_matches, false);
exception
    when others then
        return false;
end;
$$;

create or replace function public.kdj_bootstrap_admin_booking_attestation_key(
    p_key_id text,
    p_secret_hex text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

    perform pg_catalog.pg_advisory_xact_lock(82026, 4101);

    if exists (
        select 1
          from private.kdj_admin_booking_attestation_keys
    ) then
        return pg_catalog.jsonb_build_object('ok', false, 'code', 'BOOTSTRAP_ALREADY_COMPLETED');
    end if;

    insert into private.kdj_admin_booking_attestation_keys (
        key_id, key_bytes, status
    )
    values (
        p_key_id, pg_catalog.decode(p_secret_hex, 'hex'), 'ACTIVE'
    );

    return pg_catalog.jsonb_build_object(
        'ok', true,
        'code', 'KEY_PROVISIONED',
        'key_id', p_key_id
    );
exception
    when unique_violation then
        return pg_catalog.jsonb_build_object('ok', false, 'code', 'BOOTSTRAP_ALREADY_COMPLETED');
end;
$$;

create or replace function public.kdj_admin_create_booking_attested(
    p_key_id text,
    p_actor_admin_id uuid,
    p_actor_session_version integer,
    p_no_wa text,
    p_nama_leads text,
    p_metode text,
    p_jadwal_pilihan timestamptz,
    p_idempotency_key text,
    p_issued_at_ms bigint,
    p_nonce uuid,
    p_signature text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_fields text[];
    v_request_payload text;
    v_request_hash text;
    v_idempotency_hash text;
    v_existing private.kdj_admin_booking_audit%rowtype;
    v_admin public.admins%rowtype;
    v_booking jsonb;
    v_booking_id uuid;
    v_issued_at timestamptz;
    v_result_code text;
begin
    if p_actor_admin_id is null
       or p_actor_session_version is null
       or p_actor_session_version < 1
       or p_no_wa is null
       or p_no_wa !~ '^08[0-9]{8,13}$'
       or p_nama_leads is null
       or pg_catalog.length(pg_catalog.btrim(p_nama_leads)) not between 2 and 120
       or p_metode is null
       or p_metode not in ('Zoom', 'Offline')
       or p_jadwal_pilihan is null
       or p_idempotency_key is null
       or p_idempotency_key !~ '^admin-create:[A-Za-z0-9:_-]{8,200}$'
       or p_issued_at_ms is null
       or p_nonce is null then
        return pg_catalog.jsonb_build_object('ok', false, 'code', 'INVALID_ADMIN_BOOKING_REQUEST');
    end if;

    if p_issued_at_ms < (
            pg_catalog.date_part('epoch', pg_catalog.clock_timestamp() - interval '2 minutes') * 1000
        )::bigint
       or p_issued_at_ms > (
            pg_catalog.date_part('epoch', pg_catalog.clock_timestamp() + interval '1 minute') * 1000
        )::bigint then
        return pg_catalog.jsonb_build_object('ok', false, 'code', 'ATTESTATION_EXPIRED');
    end if;
    v_issued_at := pg_catalog.to_timestamp(p_issued_at_ms::double precision / 1000.0);

    v_fields := array[
        p_actor_admin_id::text,
        p_actor_session_version::text,
        p_no_wa,
        pg_catalog.btrim(p_nama_leads),
        p_metode,
        pg_catalog.round(pg_catalog.date_part('epoch', p_jadwal_pilihan) * 1000)::bigint::text,
        p_idempotency_key,
        p_issued_at_ms::text
    ];

    if not private.kdj_admin_booking_verify_attestation(
        p_key_id, v_fields, p_nonce, p_signature
    ) then
        return pg_catalog.jsonb_build_object('ok', false, 'code', 'INVALID_ADMIN_ATTESTATION');
    end if;

    select *
      into v_admin
      from public.admins as a
     where a.id = p_actor_admin_id
     for share;

    if not found
       or v_admin.is_active is distinct from true
       or v_admin.session_version <> p_actor_session_version
       or v_admin.role is null
       or v_admin.role not in ('Super Admin', 'Admin Konsultan') then
        return pg_catalog.jsonb_build_object('ok', false, 'code', 'ADMIN_SESSION_REVOKED_OR_UNAUTHORIZED');
    end if;

    v_request_payload := private.kdj_rt04_canonical_payload(
        array['KDJ-ADMIN-BOOKING', '1', p_key_id, 'CREATE']
        || v_fields[1:7]
    );
    v_request_hash := pg_catalog.encode(
        extensions.digest(pg_catalog.convert_to(v_request_payload, 'UTF8'), 'sha256'),
        'hex'
    );
    v_idempotency_hash := pg_catalog.encode(
        extensions.digest(pg_catalog.convert_to(p_idempotency_key, 'UTF8'), 'sha256'),
        'hex'
    );

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(v_idempotency_hash, 0)
    );

    select *
      into v_existing
      from private.kdj_admin_booking_audit as a
     where a.nonce = p_nonce;

    if found then
        if v_existing.request_hash <> v_request_hash
           or v_existing.idempotency_key_hash <> v_idempotency_hash then
            return pg_catalog.jsonb_build_object('ok', false, 'code', 'ATTESTATION_REPLAY_MISMATCH');
        end if;
        if v_existing.outcome->>'ok' = 'true' then
            return v_existing.outcome || pg_catalog.jsonb_build_object('code', 'IDEMPOTENT_REPLAY');
        end if;
        return v_existing.outcome || pg_catalog.jsonb_build_object('idempotent_replay', true);
    end if;

    select *
      into v_existing
      from private.kdj_admin_booking_audit as a
     where a.idempotency_key_hash = v_idempotency_hash;

    if found then
        if v_existing.request_hash <> v_request_hash then
            return pg_catalog.jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_KEY_REUSED');
        end if;
        if v_existing.outcome->>'ok' = 'true' then
            return v_existing.outcome || pg_catalog.jsonb_build_object('code', 'IDEMPOTENT_REPLAY');
        end if;
        return v_existing.outcome || pg_catalog.jsonb_build_object('idempotent_replay', true);
    end if;

    -- Preserve Scheduling V2 slot rules and atomic Outbox creation.
    -- This call runs as the postgres-owned SECURITY DEFINER function owner.
    v_booking := public.kdj_create_booking(
        p_no_wa,
        pg_catalog.btrim(p_nama_leads),
        p_metode,
        p_jadwal_pilihan,
        p_idempotency_key
    );

    v_result_code := coalesce(v_booking->>'code', 'BOOKING_CREATE_UNKNOWN');
    v_booking_id := null;
    if coalesce(v_booking->>'ok', 'false') = 'true' then
        if (v_booking->>'booking_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
            v_booking_id := (v_booking->>'booking_id')::uuid;
        else
            raise exception 'ADMIN_BOOKING_RESULT_MISSING_BOOKING_ID';
        end if;
    end if;

    insert into private.kdj_admin_booking_audit (
        actor_admin_id,
        actor_username,
        actor_role,
        actor_session_version,
        action,
        booking_id,
        idempotency_key_hash,
        request_hash,
        nonce,
        issued_at,
        outcome_code,
        outcome
    )
    values (
        v_admin.id,
        coalesce(v_admin.username, v_admin.id::text),
        v_admin.role,
        v_admin.session_version,
        'CREATE',
        v_booking_id,
        v_idempotency_hash,
        v_request_hash,
        p_nonce,
        v_issued_at,
        v_result_code,
        v_booking
    );

    return v_booking;
end;
$$;

revoke all on function private.kdj_admin_booking_verify_attestation(text, text[], uuid, text)
    from public, anon, authenticated, service_role;
revoke all on function public.kdj_bootstrap_admin_booking_attestation_key(text, text)
    from public, anon, authenticated, service_role;
revoke all on function public.kdj_admin_create_booking_attested(
    text, uuid, integer, text, text, text, timestamptz, text, bigint, uuid, text
) from public, anon, authenticated;

grant execute on function public.kdj_bootstrap_admin_booking_attestation_key(text, text)
    to postgres;
grant execute on function public.kdj_admin_create_booking_attested(
    text, uuid, integer, text, text, text, timestamptz, text, bigint, uuid, text
) to service_role;

comment on table private.kdj_admin_booking_attestation_keys is
'Private server-only HMAC key custody for Portal Admin booking attestations. Bootstrap can insert once; key material is never returned.';
comment on table private.kdj_admin_booking_audit is
'Durable immutable-by-API Admin booking CREATE audit. Written atomically with Scheduling V2 booking and Outbox transaction.';
comment on function public.kdj_admin_create_booking_attested(
    text, uuid, integer, text, text, text, timestamptz, text, bigint, uuid, text
) is
'Portal-server HMAC attested Admin booking. Revalidates active Admin and session_version in PostgreSQL and writes durable audit in the same transaction as booking/Outbox.';

commit;

-- This migration intentionally does not revoke service_role DML on jadwal_konsultasi
-- or EXECUTE on kdj_create_booking. Complete OD-08 / VPS / Vercel inventory first.


