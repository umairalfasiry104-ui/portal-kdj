-- RT-04: durable WhatsApp customer booking approval gate.
-- Additive implementation. This migration does NOT cut over or revoke the legacy
-- kdj_create_booking RPC / jadwal_konsultasi service_role DML. OD-08 plus a secure
-- Admin booking actor lane must be closed before those bypasses can be removed.
-- Do not apply to STAGING/PRODUCTION until the local DB dry-run and caller cutover review pass.

begin;

create schema if not exists private authorization postgres;
grant usage on schema private to postgres;

create table if not exists private.kdj_bot_attestation_keys (
    key_id text primary key,
    key_bytes bytea not null,
    status text not null default 'ACTIVE',
    valid_from timestamptz not null default pg_catalog.clock_timestamp(),
    valid_until timestamptz,
    created_at timestamptz not null default pg_catalog.clock_timestamp(),
    constraint kdj_bot_attestation_keys_key_id_format
        check (key_id ~ '^[A-Za-z0-9._-]{1,80}$'),
    constraint kdj_bot_attestation_keys_key_length
        check (pg_catalog.octet_length(key_bytes) >= 32),
    constraint kdj_bot_attestation_keys_status
        check (status in ('ACTIVE', 'RETIRING', 'REVOKED')),
    constraint kdj_bot_attestation_keys_validity
        check (valid_until is null or valid_until > valid_from)
);

create unique index if not exists kdj_bot_attestation_one_active_key
    on private.kdj_bot_attestation_keys ((status))
    where status = 'ACTIVE';

create table if not exists private.kdj_booking_attestation_nonces (
    key_id text not null references private.kdj_bot_attestation_keys(key_id),
    action text not null,
    nonce uuid not null,
    approval_id uuid,
    payload_hash text not null,
    created_at timestamptz not null default pg_catalog.clock_timestamp(),
    primary key (key_id, action, nonce),
    constraint kdj_booking_attestation_nonces_action
        check (action in ('PREPARE', 'SUMMARY_SENT', 'APPROVE', 'CANCEL', 'RECOVER')),
    constraint kdj_booking_attestation_nonces_payload_hash
        check (payload_hash ~ '^[a-f0-9]{64}$')
);

create table if not exists private.booking_customer_approvals (
    approval_id uuid primary key,
    request_id uuid not null,
    request_version integer not null,
    customer_phone text not null,
    customer_name text not null,
    metode text not null,
    jadwal_pilihan timestamptz not null,
    timezone text not null default 'Asia/Jakarta',
    duration_minutes smallint not null default 120,
    buffer_minutes smallint not null default 30,
    offline_address text,
    identity_ref text not null,
    request_hash text not null,
    idempotency_key text not null unique,
    status text not null,
    source_message_ref text not null,
    source_message_timestamp bigint not null,
    prepared_at timestamptz not null default pg_catalog.clock_timestamp(),
    summary_provider_message_ref text,
    summary_provider_timestamp bigint,
    summary_send_accepted_at timestamptz,
    expires_at timestamptz,
    approval_message_ref text,
    approval_message_timestamp bigint,
    approval_sender_ref text,
    approval_command text,
    approval_nonce uuid,
    approved_at timestamptz,
    cancellation_message_ref text,
    cancelled_at timestamptz,
    booking_id uuid,
    booking_status text,
    notification_event_id uuid,
    booking_result jsonb,
    failure_code text,
    created_at timestamptz not null default pg_catalog.clock_timestamp(),
    updated_at timestamptz not null default pg_catalog.clock_timestamp(),
    constraint booking_customer_approvals_phone
        check (customer_phone ~ '^08[0-9]{8,13}$'),
    constraint booking_customer_approvals_name
        check (pg_catalog.length(pg_catalog.btrim(customer_name)) between 2 and 120),
    constraint booking_customer_approvals_method
        check (metode in ('Zoom', 'Offline')),
    constraint booking_customer_approvals_timezone
        check (timezone = 'Asia/Jakarta'),
    constraint booking_customer_approvals_duration
        check (duration_minutes = 120 and buffer_minutes = 30),
    constraint booking_customer_approvals_offline_address
        check ((metode = 'Offline' and offline_address is not null and pg_catalog.length(offline_address) > 0)
            or (metode = 'Zoom' and offline_address is null)),
    constraint booking_customer_approvals_identity_ref
        check (identity_ref ~ '^[a-f0-9]{64}$'),
    constraint booking_customer_approvals_request_hash
        check (request_hash ~ '^[a-f0-9]{64}$'),
    constraint booking_customer_approvals_message_refs
        check (source_message_ref ~ '^[a-f0-9]{64}$'
            and (summary_provider_message_ref is null or summary_provider_message_ref ~ '^[a-f0-9]{64}$')
            and (approval_message_ref is null or approval_message_ref ~ '^[a-f0-9]{64}$')
            and (approval_sender_ref is null or approval_sender_ref ~ '^[a-f0-9]{64}$')
            and (cancellation_message_ref is null or cancellation_message_ref ~ '^[a-f0-9]{64}$')),
    constraint booking_customer_approvals_version
        check (request_version > 0),
    constraint booking_customer_approvals_timestamps
        check (source_message_timestamp > 0
            and (summary_provider_timestamp is null or summary_provider_timestamp > 0)
            and (approval_message_timestamp is null or approval_message_timestamp > 0)),
    constraint booking_customer_approvals_status
        check (status in (
            'PREPARED', 'AWAITING_APPROVAL', 'APPROVAL_CANDIDATE',
            'CONSUMED', 'EXPIRED', 'SUPERSEDED', 'CANCELLED',
            'SLOT_UNAVAILABLE', 'FAILED'
        )),
    constraint booking_customer_approvals_expiry
        check (expires_at is null or
            (summary_send_accepted_at is not null and expires_at = summary_send_accepted_at + interval '10 minutes')),
    constraint booking_customer_approvals_approval_evidence
        check ((approval_message_ref is null and approval_message_timestamp is null
                    and approval_sender_ref is null and approval_command is null
                    and approval_nonce is null and approved_at is null)
            or (approval_message_ref is not null and approval_message_timestamp is not null
                    and approval_sender_ref is not null and approval_command in
                        ('SETUJU', 'YA, SETUJU', 'SAYA SETUJU')
                    and approval_nonce is not null and approved_at is not null)),
    constraint booking_customer_approvals_consumed_booking
        check (status <> 'CONSUMED' or (booking_id is not null and booking_result is not null))
);

create unique index if not exists booking_customer_approvals_one_active_per_phone
    on private.booking_customer_approvals (customer_phone)
    where status in ('PREPARED', 'AWAITING_APPROVAL', 'APPROVAL_CANDIDATE');

create unique index if not exists booking_customer_approvals_summary_message_ref
    on private.booking_customer_approvals (summary_provider_message_ref)
    where summary_provider_message_ref is not null;

create unique index if not exists booking_customer_approvals_approval_message_ref
    on private.booking_customer_approvals (approval_message_ref)
    where approval_message_ref is not null;

create unique index if not exists booking_customer_approvals_cancel_message_ref
    on private.booking_customer_approvals (cancellation_message_ref)
    where cancellation_message_ref is not null;

create index if not exists booking_customer_approvals_request_version
    on private.booking_customer_approvals (request_id, request_version desc);

create index if not exists booking_customer_approvals_phone_history
    on private.booking_customer_approvals (customer_phone, created_at desc);

revoke all on table private.kdj_bot_attestation_keys from public, anon, authenticated, service_role;
revoke all on table private.kdj_booking_attestation_nonces from public, anon, authenticated, service_role;
revoke all on table private.booking_customer_approvals from public, anon, authenticated, service_role;

create or replace function private.kdj_rt04_canonical_payload(p_fields text[])
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
    v_field text;
    v_bytes bytea;
    v_encoded text;
    v_result text := '';
    v_first boolean := true;
begin
    if p_fields is null then
        raise exception 'RT04_FIELDS_REQUIRED';
    end if;

    foreach v_field in array p_fields loop
        v_bytes := pg_catalog.convert_to(coalesce(v_field, ''), 'UTF8');
        v_encoded := pg_catalog.encode(v_bytes, 'base64');
        v_encoded := pg_catalog.replace(v_encoded, E'\n', '');
        v_encoded := pg_catalog.replace(v_encoded, E'\r', '');
        v_encoded := pg_catalog.replace(v_encoded, '+', '-');
        v_encoded := pg_catalog.replace(v_encoded, '/', '_');
        v_encoded := pg_catalog.rtrim(v_encoded, '=');

        if not v_first then
            v_result := v_result || '|';
        end if;
        v_result := v_result || pg_catalog.octet_length(v_bytes)::text || ':' || v_encoded;
        v_first := false;
    end loop;

    return v_result;
end;
$$;

create or replace function private.kdj_rt04_verify_attestation(
    p_key_id text,
    p_action text,
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
    v_constant_time_match boolean;
begin
    if p_key_id is null or p_action is null
        or p_action not in ('PREPARE', 'SUMMARY_SENT', 'APPROVE', 'CANCEL', 'RECOVER')
        or p_nonce is null or p_signature is null
        or p_signature !~ '^[a-fA-F0-9]{64}$' then
        return false;
    end if;

    select k.key_bytes
      into v_key
      from private.kdj_bot_attestation_keys as k
     where k.key_id = p_key_id
       and k.status in ('ACTIVE', 'RETIRING')
       and k.valid_from <= pg_catalog.clock_timestamp()
       and (k.valid_until is null or k.valid_until > pg_catalog.clock_timestamp())
       and (p_action <> 'PREPARE' or k.status = 'ACTIVE');

    if v_key is null then
        return false;
    end if;

    v_payload := private.kdj_rt04_canonical_payload(
        array['KDJ-BOOKING-APPROVAL', '1', p_key_id, p_action]
        || coalesce(p_fields, array[]::text[])
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
      into v_constant_time_match
      from pg_catalog.generate_series(0, 31) as g(i);

    return coalesce(v_constant_time_match, false);
exception
    when others then
        return false;
end;
$$;

create or replace function private.kdj_rt04_consume_nonce(
    p_key_id text,
    p_action text,
    p_nonce uuid,
    p_approval_id uuid,
    p_fields text[],
    p_signature text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_payload text;
    v_payload_hash text;
    v_existing private.kdj_booking_attestation_nonces%rowtype;
begin
    if not private.kdj_rt04_verify_attestation(
        p_key_id, p_action, p_fields, p_nonce, p_signature
    ) then
        return false;
    end if;

    v_payload := private.kdj_rt04_canonical_payload(
        array['KDJ-BOOKING-APPROVAL', '1', p_key_id, p_action]
        || coalesce(p_fields, array[]::text[])
        || array[p_nonce::text]
    );
    v_payload_hash := pg_catalog.encode(
        extensions.digest(pg_catalog.convert_to(v_payload, 'UTF8'), 'sha256'),
        'hex'
    );

    insert into private.kdj_booking_attestation_nonces (
        key_id, action, nonce, approval_id, payload_hash
    )
    values (
        p_key_id, p_action, p_nonce, p_approval_id, v_payload_hash
    )
    on conflict (key_id, action, nonce) do nothing;

    if found then
        return true;
    end if;

    select *
      into v_existing
      from private.kdj_booking_attestation_nonces
     where key_id = p_key_id
       and action = p_action
       and nonce = p_nonce;

    return found
       and v_existing.payload_hash = v_payload_hash
       and v_existing.approval_id is not distinct from p_approval_id;
end;
$$;

create or replace function private.kdj_rt04_finalize_booking_approval(p_approval_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_approval private.booking_customer_approvals%rowtype;
    v_booking jsonb;
    v_code text;
    v_booking_id uuid;
    v_notification_id uuid;
begin
    select *
      into v_approval
      from private.booking_customer_approvals
     where approval_id = p_approval_id
     for update;

    if not found then
        return jsonb_build_object('ok', false, 'code', 'APPROVAL_NOT_FOUND');
    end if;

    if v_approval.status = 'CONSUMED' then
        return coalesce(
            v_approval.booking_result || pg_catalog.jsonb_build_object('code', 'IDEMPOTENT_REPLAY'),
            jsonb_build_object('ok', false, 'code', 'BOOKING_RESULT_MISSING')
        );
    end if;

    if v_approval.status <> 'APPROVAL_CANDIDATE'
       or v_approval.summary_send_accepted_at is null
       or v_approval.expires_at is null
       or v_approval.approval_message_timestamp is null then
        return jsonb_build_object('ok', false, 'code', 'APPROVAL_NOT_READY');
    end if;

    if pg_catalog.to_timestamp(v_approval.approval_message_timestamp::double precision)
            <= pg_catalog.to_timestamp(v_approval.source_message_timestamp::double precision) then
        update private.booking_customer_approvals
           set status = 'AWAITING_APPROVAL',
               approval_message_ref = null,
               approval_message_timestamp = null,
               approval_sender_ref = null,
               approval_command = null,
               approval_nonce = null,
               approved_at = null,
               failure_code = 'APPROVAL_ORDER_UNPROVEN',
               updated_at = pg_catalog.clock_timestamp()
         where approval_id = p_approval_id;
        return jsonb_build_object('ok', false, 'code', 'APPROVAL_PRECEDES_SUMMARY');
    end if;

    if pg_catalog.to_timestamp(v_approval.approval_message_timestamp::double precision)
            <= v_approval.summary_send_accepted_at then
        update private.booking_customer_approvals
           set status = 'AWAITING_APPROVAL',
               approval_message_ref = null,
               approval_message_timestamp = null,
               approval_sender_ref = null,
               approval_command = null,
               approval_nonce = null,
               approved_at = null,
               failure_code = 'APPROVAL_ORDER_UNPROVEN',
               updated_at = pg_catalog.clock_timestamp()
         where approval_id = p_approval_id;
        return jsonb_build_object('ok', false, 'code', 'APPROVAL_PRECEDES_SUMMARY');
    end if;

    if pg_catalog.to_timestamp(v_approval.approval_message_timestamp::double precision)
            >= v_approval.expires_at then
        update private.booking_customer_approvals
           set status = 'EXPIRED',
               failure_code = 'APPROVAL_EXPIRED',
               updated_at = pg_catalog.clock_timestamp()
         where approval_id = p_approval_id;
        return jsonb_build_object('ok', false, 'code', 'APPROVAL_EXPIRED');
    end if;

    -- This calls the preserved Scheduling V2 + Customer Outbox V6.2 transaction.
    -- The legacy RPC remains an independently callable bypass until OD-08/admin
    -- lane cutover is complete; see migration header and RT04 evidence document.
    v_booking := public.kdj_create_booking(
        v_approval.customer_phone,
        v_approval.customer_name,
        v_approval.metode,
        v_approval.jadwal_pilihan,
        v_approval.idempotency_key
    );

    -- Persist the approved customer-visible snapshot with the result so a Bot restart
    -- can acknowledge an exact replay without requiring volatile session state.
    v_booking := v_booking || pg_catalog.jsonb_build_object(
        'approval_id', v_approval.approval_id,
        'request_id', v_approval.request_id,
        'request_version', v_approval.request_version,
        'request_hash', v_approval.request_hash,
        'customer_name', v_approval.customer_name,
        'customer_phone', v_approval.customer_phone,
        'metode', v_approval.metode,
        'jadwal_pilihan', v_approval.jadwal_pilihan,
        'idempotency_key', v_approval.idempotency_key,
        'offline_address', v_approval.offline_address
    );

    v_code := coalesce(v_booking->>'code', v_booking->>'error', 'BOOKING_FAILED');

    if coalesce((v_booking->>'ok')::boolean, false) then
        v_booking_id := nullif(v_booking->>'booking_id', '')::uuid;
        v_notification_id := nullif(v_booking->>'notification_event_id', '')::uuid;

        update private.booking_customer_approvals
           set status = 'CONSUMED',
               booking_id = v_booking_id,
               booking_status = v_booking->>'status',
               notification_event_id = v_notification_id,
               booking_result = v_booking,
               failure_code = null,
               updated_at = pg_catalog.clock_timestamp()
         where approval_id = p_approval_id;

        return v_booking || jsonb_build_object(
            'approval_id', p_approval_id,
            'request_id', v_approval.request_id,
            'request_version', v_approval.request_version,
            'request_hash', v_approval.request_hash
        );
    end if;

    if v_code = 'SLOT_UNAVAILABLE' then
        update private.booking_customer_approvals
           set status = 'SLOT_UNAVAILABLE',
               booking_result = v_booking,
               failure_code = v_code,
               updated_at = pg_catalog.clock_timestamp()
         where approval_id = p_approval_id;
        return v_booking || jsonb_build_object('approval_id', p_approval_id);
    end if;

    if v_code = 'IDEMPOTENCY_RETRY_REQUIRED' then
        update private.booking_customer_approvals
           set failure_code = v_code,
               updated_at = pg_catalog.clock_timestamp()
         where approval_id = p_approval_id;
        return v_booking || jsonb_build_object('approval_id', p_approval_id);
    end if;

    update private.booking_customer_approvals
       set status = 'FAILED',
           booking_result = v_booking,
           failure_code = v_code,
           updated_at = pg_catalog.clock_timestamp()
     where approval_id = p_approval_id;

    return v_booking || jsonb_build_object('approval_id', p_approval_id);
end;
$$;

create or replace function public.kdj_prepare_booking_approval(
    p_key_id text,
    p_approval_id uuid,
    p_request_id uuid,
    p_request_version integer,
    p_customer_phone text,
    p_identity_ref text,
    p_source_message_ref text,
    p_source_message_timestamp bigint,
    p_customer_name text,
    p_metode text,
    p_jadwal_pilihan text,
    p_timezone text,
    p_duration_minutes smallint,
    p_buffer_minutes smallint,
    p_offline_address text,
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
    v_schedule timestamptz;
    v_name text;
    v_address text;
    v_version integer;
    v_hash text;
    v_hash_payload text;
    v_idempotency_key text;
    v_existing private.booking_customer_approvals%rowtype;
begin
    if p_approval_id is null or p_request_id is null
       or p_request_version is null or p_request_version < 1 then
        return jsonb_build_object('ok', false, 'code', 'INVALID_REQUEST_ID');
    end if;
    if p_customer_phone is null or p_identity_ref is null or p_source_message_ref is null
       or p_customer_phone !~ '^08[0-9]{8,13}$'
       or p_identity_ref !~ '^[a-f0-9]{64}$'
       or p_source_message_ref !~ '^[a-f0-9]{64}$'
       or p_source_message_timestamp is null or p_source_message_timestamp <= 0 then
        return jsonb_build_object('ok', false, 'code', 'INVALID_VERIFIED_IDENTITY');
    end if;
    if p_metode is null or p_timezone is null
       or p_duration_minutes is null or p_buffer_minutes is null
       or p_metode not in ('Zoom', 'Offline')
       or p_timezone <> 'Asia/Jakarta'
       or p_duration_minutes <> 120
       or p_buffer_minutes <> 30 then
        return jsonb_build_object('ok', false, 'code', 'INVALID_BOOKING_POLICY');
    end if;

    v_name := pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_customer_name, '')), '\s+', ' ', 'g');
    if pg_catalog.length(v_name) < 2 or pg_catalog.length(v_name) > 120 then
        return jsonb_build_object('ok', false, 'code', 'INVALID_NAME');
    end if;

    if p_jadwal_pilihan is null or pg_catalog.btrim(p_jadwal_pilihan) = '' then
        return jsonb_build_object('ok', false, 'code', 'INVALID_DATETIME');
    end if;

    begin
        v_schedule := p_jadwal_pilihan::timestamptz;
    exception when others then
        return jsonb_build_object('ok', false, 'code', 'INVALID_DATETIME');
    end;

    v_address := case
        when p_metode = 'Offline' then
            'KDJ Home Office, Jl. Raya Pulo Mangga No.157, Grogol, Kec. Limo, Kota Depok, Jawa Barat 16512 (Gmaps: https://maps.app.goo.gl/YyMVvY5hjumMS5b17)'
        else null
    end;

    if (p_metode = 'Offline' and p_offline_address is distinct from v_address)
       or (p_metode = 'Zoom' and coalesce(p_offline_address, '') <> '') then
        return jsonb_build_object('ok', false, 'code', 'INVALID_OFFLINE_ADDRESS_SNAPSHOT');
    end if;

    v_fields := array[
        p_approval_id::text,
        p_request_id::text,
        p_request_version::text,
        p_customer_phone,
        p_identity_ref,
        p_source_message_ref,
        p_source_message_timestamp::text,
        v_name,
        p_metode,
        p_jadwal_pilihan,
        p_timezone,
        p_duration_minutes::text,
        p_buffer_minutes::text,
        coalesce(p_offline_address, '')
    ];

    if not private.kdj_rt04_consume_nonce(
        p_key_id, 'PREPARE', p_nonce, p_approval_id, v_fields, p_signature
    ) then
        return jsonb_build_object('ok', false, 'code', 'INVALID_ATTESTATION_OR_REPLAY');
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_customer_phone, 0)
    );

    select *
      into v_existing
      from private.booking_customer_approvals
     where approval_id = p_approval_id
     for update;

    if found then
        if v_existing.request_id = p_request_id
           and v_existing.customer_phone = p_customer_phone
           and v_existing.customer_name = v_name
           and v_existing.metode = p_metode
           and v_existing.jadwal_pilihan = v_schedule
           and v_existing.identity_ref = p_identity_ref then
            return jsonb_build_object(
                'ok', true, 'code', 'PREPARE_REPLAY',
                'approval_id', v_existing.approval_id,
                'request_id', v_existing.request_id,
                'request_version', v_existing.request_version,
                'request_hash', v_existing.request_hash,
                'customer_phone', v_existing.customer_phone,
                'idempotency_key', v_existing.idempotency_key,
                'customer_name', v_existing.customer_name,
                'metode', v_existing.metode,
                'jadwal_pilihan', v_existing.jadwal_pilihan,
                'timezone', v_existing.timezone,
                'duration_minutes', v_existing.duration_minutes,
                'offline_address', v_existing.offline_address,
                'expires_at', v_existing.expires_at,
                'status', v_existing.status
            );
        end if;
        return jsonb_build_object('ok', false, 'code', 'APPROVAL_ID_REUSED');
    end if;

    select coalesce(pg_catalog.max(a.request_version), 0) + 1
      into v_version
      from private.booking_customer_approvals as a
     where a.request_id = p_request_id;

    if p_request_version <> v_version then
        return jsonb_build_object('ok', false, 'code', 'REQUEST_VERSION_CONFLICT',
            'expected_version', v_version);
    end if;

    update private.booking_customer_approvals
       set status = 'SUPERSEDED',
           updated_at = pg_catalog.clock_timestamp()
     where customer_phone = p_customer_phone
       and status in ('PREPARED', 'AWAITING_APPROVAL', 'APPROVAL_CANDIDATE');

    v_hash_payload := pg_catalog.jsonb_build_array(
        'KDJ_BOOKING_SUMMARY',
        '1',
        p_request_id::text,
        v_version::text,
        p_identity_ref,
        v_name,
        p_metode,
        pg_catalog.to_char(v_schedule at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'Asia/Jakarta',
        '120',
        case when p_metode = 'Offline' then v_address else '' end
    )::text;

    v_hash := pg_catalog.encode(
        extensions.digest(pg_catalog.convert_to(v_hash_payload, 'UTF8'), 'sha256'),
        'hex'
    );
    v_idempotency_key := 'rt04-wa:' || p_request_id::text || ':' || v_version::text;

    insert into private.booking_customer_approvals (
        approval_id, request_id, request_version, customer_phone, customer_name,
        metode, jadwal_pilihan, timezone, duration_minutes, buffer_minutes,
        offline_address, identity_ref, request_hash, idempotency_key, status,
        source_message_ref, source_message_timestamp
    )
    values (
        p_approval_id, p_request_id, v_version, p_customer_phone, v_name,
        p_metode, v_schedule, 'Asia/Jakarta', 120, 30,
        v_address, p_identity_ref, v_hash, v_idempotency_key, 'PREPARED',
        p_source_message_ref, p_source_message_timestamp
    );

    return jsonb_build_object(
        'ok', true,
        'code', 'PREPARED',
        'approval_id', p_approval_id,
        'request_id', p_request_id,
        'request_version', v_version,
        'request_hash', v_hash,
        'customer_phone', p_customer_phone,
        'idempotency_key', v_idempotency_key,
        'customer_name', v_name,
        'metode', p_metode,
        'jadwal_pilihan', v_schedule,
        'timezone', 'Asia/Jakarta',
        'duration_minutes', 120,
        'offline_address', v_address,
        'expires_at', null,
        'status', 'PREPARED'
    );
end;
$$;

create or replace function public.kdj_record_booking_summary_sent(
    p_key_id text,
    p_approval_id uuid,
    p_request_id uuid,
    p_request_version integer,
    p_request_hash text,
    p_identity_ref text,
    p_provider_message_ref text,
    p_provider_message_timestamp bigint,
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
    v_row private.booking_customer_approvals%rowtype;
    v_expiry timestamptz;
    v_final jsonb;
begin
    if p_provider_message_ref is null or p_provider_message_timestamp is null
       or p_provider_message_ref !~ '^[a-f0-9]{64}$'
       or p_provider_message_timestamp <= 0 then
        return jsonb_build_object('ok', false, 'code', 'INVALID_PROVIDER_SEND_EVIDENCE');
    end if;

    v_fields := array[
        p_approval_id::text,
        p_request_id::text,
        p_request_version::text,
        p_request_hash,
        p_identity_ref,
        p_provider_message_ref,
        p_provider_message_timestamp::text
    ];

    if not private.kdj_rt04_consume_nonce(
        p_key_id, 'SUMMARY_SENT', p_nonce, p_approval_id, v_fields, p_signature
    ) then
        return jsonb_build_object('ok', false, 'code', 'INVALID_ATTESTATION_OR_REPLAY');
    end if;

    select *
      into v_row
      from private.booking_customer_approvals
     where approval_id = p_approval_id
     for update;

    if not found
       or v_row.request_id <> p_request_id
       or v_row.request_version <> p_request_version
       or v_row.request_hash <> p_request_hash
       or v_row.identity_ref <> p_identity_ref then
        return jsonb_build_object('ok', false, 'code', 'APPROVAL_SNAPSHOT_MISMATCH');
    end if;

    v_expiry := pg_catalog.to_timestamp(p_provider_message_timestamp::double precision)
        + interval '10 minutes';

    if v_row.summary_provider_message_ref is not null then
        if v_row.summary_provider_message_ref = p_provider_message_ref
           and v_row.summary_provider_timestamp = p_provider_message_timestamp then
            if v_row.status = 'APPROVAL_CANDIDATE' then
                v_final := private.kdj_rt04_finalize_booking_approval(p_approval_id);
                return v_final;
            end if;
            return jsonb_build_object(
                'ok', true, 'code', 'SUMMARY_SEND_REPLAY',
                'approval_id', p_approval_id,
                'request_hash', v_row.request_hash,
                'expires_at', v_row.expires_at,
                'status', v_row.status
            );
        end if;
        return jsonb_build_object('ok', false, 'code', 'SUMMARY_SEND_ALREADY_RECORDED');
    end if;

    if v_row.status not in ('PREPARED', 'APPROVAL_CANDIDATE') then
        return jsonb_build_object('ok', false, 'code', 'APPROVAL_NOT_PREPARED');
    end if;

    update private.booking_customer_approvals
       set summary_provider_message_ref = p_provider_message_ref,
           summary_provider_timestamp = p_provider_message_timestamp,
           summary_send_accepted_at = pg_catalog.to_timestamp(p_provider_message_timestamp::double precision),
           expires_at = v_expiry,
           status = case when status = 'APPROVAL_CANDIDATE'
                         then 'APPROVAL_CANDIDATE' else 'AWAITING_APPROVAL' end,
           updated_at = pg_catalog.clock_timestamp()
     where approval_id = p_approval_id;

    select *
      into v_row
      from private.booking_customer_approvals
     where approval_id = p_approval_id;

    if v_row.status = 'APPROVAL_CANDIDATE' then
        v_final := private.kdj_rt04_finalize_booking_approval(p_approval_id);
        if v_final->>'code' = 'APPROVAL_PRECEDES_SUMMARY' then
            return v_final || jsonb_build_object('expires_at', v_expiry);
        end if;
        return v_final || jsonb_build_object('expires_at', v_expiry);
    end if;

    return jsonb_build_object(
        'ok', true,
        'code', 'AWAITING_APPROVAL',
        'approval_id', p_approval_id,
        'request_id', p_request_id,
        'request_version', p_request_version,
        'request_hash', p_request_hash,
        'expires_at', v_expiry,
        'status', 'AWAITING_APPROVAL'
    );
end;
$$;

create or replace function public.kdj_submit_booking_approval(
    p_key_id text,
    p_approval_id uuid,
    p_request_id uuid,
    p_request_version integer,
    p_request_hash text,
    p_customer_phone text,
    p_identity_ref text,
    p_approval_message_ref text,
    p_approval_message_timestamp bigint,
    p_command text,
    p_nonce uuid,
    p_signature text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_action text;
    v_fields text[];
    v_row private.booking_customer_approvals%rowtype;
    v_existing private.booking_customer_approvals%rowtype;
    v_result jsonb;
begin
    if p_approval_message_ref is null or p_approval_message_timestamp is null
       or p_approval_message_ref !~ '^[a-f0-9]{64}$'
       or p_approval_message_timestamp <= 0 then
        return jsonb_build_object('ok', false, 'code', 'INVALID_APPROVAL_MESSAGE_EVIDENCE');
    end if;

    if p_command in ('SETUJU', 'YA, SETUJU', 'SAYA SETUJU') then
        v_action := 'APPROVE';
    elsif p_command = 'BATAL' then
        v_action := 'CANCEL';
    else
        return jsonb_build_object('ok', false, 'code', 'APPROVAL_COMMAND_NOT_ALLOWED');
    end if;

    v_fields := array[
        p_approval_id::text,
        p_request_id::text,
        p_request_version::text,
        p_request_hash,
        p_customer_phone,
        p_identity_ref,
        p_approval_message_ref,
        p_approval_message_timestamp::text,
        p_command
    ];

    if not private.kdj_rt04_consume_nonce(
        p_key_id, v_action, p_nonce, p_approval_id, v_fields, p_signature
    ) then
        return jsonb_build_object('ok', false, 'code', 'INVALID_ATTESTATION_OR_REPLAY');
    end if;

    -- A provider message ID may be delivered again. Exact replay returns the
    -- existing outcome; the same ID with a different approval is rejected.
    select *
      into v_existing
      from private.booking_customer_approvals
     where approval_message_ref = p_approval_message_ref
     for update;

    if found then
        if v_existing.approval_id <> p_approval_id
           or v_existing.request_hash <> p_request_hash
           or v_existing.identity_ref <> p_identity_ref
           or v_existing.approval_message_timestamp <> p_approval_message_timestamp
           or v_existing.approval_command <> p_command then
            return jsonb_build_object('ok', false, 'code', 'APPROVAL_MESSAGE_REPLAY_MISMATCH');
        end if;
        if v_existing.status = 'CONSUMED' then
            return coalesce(
                v_existing.booking_result || pg_catalog.jsonb_build_object('code', 'IDEMPOTENT_REPLAY'),
                jsonb_build_object('ok', false, 'code', 'BOOKING_RESULT_MISSING')
            );
        end if;
        if v_existing.status = 'APPROVAL_CANDIDATE'
           and v_existing.summary_send_accepted_at is null then
            return jsonb_build_object('ok', true, 'code', 'WAITING_FOR_SEND_ACCEPTANCE',
                'approval_id', p_approval_id, 'expires_at', v_existing.expires_at);
        end if;
    end if;

    select *
      into v_row
      from private.booking_customer_approvals
     where approval_id = p_approval_id
     for update;

    if not found
       or v_row.request_id <> p_request_id
       or v_row.request_version <> p_request_version
       or v_row.request_hash <> p_request_hash
       or v_row.customer_phone <> p_customer_phone
       or v_row.identity_ref <> p_identity_ref then
        return jsonb_build_object('ok', false, 'code', 'APPROVAL_BINDING_MISMATCH');
    end if;

    if v_action = 'CANCEL' then
        if v_row.status not in ('PREPARED', 'AWAITING_APPROVAL', 'APPROVAL_CANDIDATE') then
            return jsonb_build_object('ok', false, 'code', 'APPROVAL_NOT_CANCELLABLE');
        end if;
        update private.booking_customer_approvals
           set status = 'CANCELLED',
               cancellation_message_ref = p_approval_message_ref,
               cancelled_at = pg_catalog.clock_timestamp(),
               updated_at = pg_catalog.clock_timestamp()
         where approval_id = p_approval_id;
        return jsonb_build_object('ok', true, 'code', 'CANCELLED', 'approval_id', p_approval_id);
    end if;

    if pg_catalog.to_timestamp(p_approval_message_timestamp::double precision)
            <= pg_catalog.to_timestamp(v_row.source_message_timestamp::double precision) then
        return jsonb_build_object('ok', false, 'code', 'APPROVAL_PRECEDES_SUMMARY');
    end if;

    if v_row.status = 'CONSUMED' then
        return jsonb_build_object('ok', false, 'code', 'APPROVAL_ALREADY_CONSUMED');
    end if;
    if v_row.status not in ('PREPARED', 'AWAITING_APPROVAL', 'APPROVAL_CANDIDATE') then
        return jsonb_build_object('ok', false, 'code', 'APPROVAL_NOT_PENDING');
    end if;

    if v_row.expires_at is not null
       and pg_catalog.to_timestamp(p_approval_message_timestamp::double precision) >= v_row.expires_at then
        update private.booking_customer_approvals
           set status = 'EXPIRED',
               failure_code = 'APPROVAL_EXPIRED',
               updated_at = pg_catalog.clock_timestamp()
         where approval_id = p_approval_id;
        return jsonb_build_object('ok', false, 'code', 'APPROVAL_EXPIRED');
    end if;

    if v_row.approval_message_ref is not null
       and v_row.approval_message_ref <> p_approval_message_ref then
        return jsonb_build_object('ok', false, 'code', 'ANOTHER_APPROVAL_CANDIDATE_EXISTS');
    end if;

    update private.booking_customer_approvals
       set status = 'APPROVAL_CANDIDATE',
           approval_message_ref = p_approval_message_ref,
           approval_message_timestamp = p_approval_message_timestamp,
           approval_sender_ref = p_identity_ref,
           approval_command = p_command,
           approval_nonce = p_nonce,
           approved_at = pg_catalog.clock_timestamp(),
           updated_at = pg_catalog.clock_timestamp()
     where approval_id = p_approval_id;

    if v_row.summary_send_accepted_at is null then
        return jsonb_build_object(
            'ok', true,
            'code', 'WAITING_FOR_SEND_ACCEPTANCE',
            'approval_id', p_approval_id,
            'request_id', p_request_id,
            'request_version', p_request_version
        );
    end if;

    if pg_catalog.to_timestamp(p_approval_message_timestamp::double precision)
            <= v_row.summary_send_accepted_at then
        update private.booking_customer_approvals
           set status = 'AWAITING_APPROVAL',
               approval_message_ref = null,
               approval_message_timestamp = null,
               approval_sender_ref = null,
               approval_command = null,
               approval_nonce = null,
               approved_at = null,
               failure_code = 'APPROVAL_ORDER_UNPROVEN',
               updated_at = pg_catalog.clock_timestamp()
         where approval_id = p_approval_id;
        return jsonb_build_object('ok', false, 'code', 'APPROVAL_PRECEDES_SUMMARY');
    end if;

    if pg_catalog.to_timestamp(p_approval_message_timestamp::double precision) >= v_row.expires_at then
        update private.booking_customer_approvals
           set status = 'EXPIRED',
               failure_code = 'APPROVAL_EXPIRED',
               updated_at = pg_catalog.clock_timestamp()
         where approval_id = p_approval_id;
        return jsonb_build_object('ok', false, 'code', 'APPROVAL_EXPIRED');
    end if;

    v_result := private.kdj_rt04_finalize_booking_approval(p_approval_id);
    return v_result;
end;
$$;

create or replace function public.kdj_get_pending_booking_approval(
    p_key_id text,
    p_customer_phone text,
    p_identity_ref text,
    p_source_message_ref text,
    p_source_message_timestamp bigint,
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
    v_row private.booking_customer_approvals%rowtype;
begin
    if p_customer_phone is null or p_identity_ref is null or p_source_message_ref is null
       or p_customer_phone !~ '^08[0-9]{8,13}$'
       or p_identity_ref !~ '^[a-f0-9]{64}$'
       or p_source_message_ref !~ '^[a-f0-9]{64}$'
       or p_source_message_timestamp is null or p_source_message_timestamp <= 0 then
        return jsonb_build_object('ok', false, 'code', 'INVALID_VERIFIED_IDENTITY');
    end if;

    v_fields := array[
        p_customer_phone,
        p_identity_ref,
        p_source_message_ref,
        p_source_message_timestamp::text
    ];

    if not private.kdj_rt04_consume_nonce(
        p_key_id, 'RECOVER', p_nonce, null, v_fields, p_signature
    ) then
        return jsonb_build_object('ok', false, 'code', 'INVALID_ATTESTATION_OR_REPLAY');
    end if;

    select *
      into v_row
      from private.booking_customer_approvals
     where customer_phone = p_customer_phone
       and identity_ref = p_identity_ref
       and status in ('PREPARED', 'AWAITING_APPROVAL', 'APPROVAL_CANDIDATE')
     order by created_at desc
     limit 1;

    if found then
        if v_row.status = 'PREPARED' then
            return jsonb_build_object(
                'ok', true,
                'code', 'PREPARED',
                'approval_id', v_row.approval_id,
                'request_id', v_row.request_id,
                'request_version', v_row.request_version,
                'request_hash', v_row.request_hash,
                'customer_phone', v_row.customer_phone,
                'idempotency_key', v_row.idempotency_key,
                'customer_name', v_row.customer_name,
                'metode', v_row.metode,
                'jadwal_pilihan', v_row.jadwal_pilihan,
                'timezone', v_row.timezone,
                'duration_minutes', v_row.duration_minutes,
                'offline_address', v_row.offline_address,
                'expires_at', null,
                'status', 'PREPARED'
            );
        end if;

        if v_row.expires_at is not null and pg_catalog.clock_timestamp() >= v_row.expires_at then
            update private.booking_customer_approvals
               set status = 'EXPIRED',
                   failure_code = 'APPROVAL_EXPIRED',
                   updated_at = pg_catalog.clock_timestamp()
             where approval_id = v_row.approval_id;
            return jsonb_build_object('ok', false, 'code', 'APPROVAL_EXPIRED');
        end if;

        return jsonb_build_object(
            'ok', true,
            'code', 'PENDING_APPROVAL',
            'approval_id', v_row.approval_id,
            'request_id', v_row.request_id,
            'request_version', v_row.request_version,
            'request_hash', v_row.request_hash,
            'customer_phone', v_row.customer_phone,
            'idempotency_key', v_row.idempotency_key,
            'customer_name', v_row.customer_name,
            'metode', v_row.metode,
            'jadwal_pilihan', v_row.jadwal_pilihan,
            'timezone', v_row.timezone,
            'duration_minutes', v_row.duration_minutes,
            'offline_address', v_row.offline_address,
            'expires_at', v_row.expires_at,
            'status', v_row.status
        );
    end if;

    select *
      into v_row
      from private.booking_customer_approvals
     where customer_phone = p_customer_phone
       and identity_ref = p_identity_ref
       and status = 'CONSUMED'
       and created_at >= pg_catalog.clock_timestamp() - interval '24 hours'
     order by created_at desc
     limit 1;

    if found then
        return jsonb_build_object(
            'ok', true,
            'code', 'ALREADY_CONSUMED',
            'approval_id', v_row.approval_id,
            'booking_result', v_row.booking_result
        );
    end if;

    return jsonb_build_object('ok', true, 'code', 'NO_PENDING_APPROVAL');
end;
$$;

alter function private.kdj_rt04_canonical_payload(text[]) owner to postgres;
alter function private.kdj_rt04_verify_attestation(text, text, text[], uuid, text) owner to postgres;
alter function private.kdj_rt04_consume_nonce(text, text, uuid, uuid, text[], text) owner to postgres;
alter function private.kdj_rt04_finalize_booking_approval(uuid) owner to postgres;

alter function public.kdj_prepare_booking_approval(
    text, uuid, uuid, integer, text, text, text, bigint, text, text, text,
    text, smallint, smallint, text, uuid, text
) owner to postgres;

alter function public.kdj_record_booking_summary_sent(
    text, uuid, uuid, integer, text, text, text, bigint, uuid, text
) owner to postgres;

alter function public.kdj_submit_booking_approval(
    text, uuid, uuid, integer, text, text, text, text, bigint, text, uuid, text
) owner to postgres;

alter function public.kdj_get_pending_booking_approval(
    text, text, text, text, bigint, uuid, text
) owner to postgres;

revoke all on function private.kdj_rt04_canonical_payload(text[]) from public, anon, authenticated, service_role;
revoke all on function private.kdj_rt04_verify_attestation(text, text, text[], uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.kdj_rt04_consume_nonce(text, text, uuid, uuid, text[], text) from public, anon, authenticated, service_role;
revoke all on function private.kdj_rt04_finalize_booking_approval(uuid) from public, anon, authenticated, service_role;
grant execute on function private.kdj_rt04_canonical_payload(text[]) to postgres;
grant execute on function private.kdj_rt04_verify_attestation(text, text, text[], uuid, text) to postgres;
grant execute on function private.kdj_rt04_consume_nonce(text, text, uuid, uuid, text[], text) to postgres;
grant execute on function private.kdj_rt04_finalize_booking_approval(uuid) to postgres;

revoke all on function public.kdj_prepare_booking_approval(
    text, uuid, uuid, integer, text, text, text, bigint, text, text, text,
    text, smallint, smallint, text, uuid, text
) from public, anon, authenticated;

revoke all on function public.kdj_record_booking_summary_sent(
    text, uuid, uuid, integer, text, text, text, bigint, uuid, text
) from public, anon, authenticated;

revoke all on function public.kdj_submit_booking_approval(
    text, uuid, uuid, integer, text, text, text, text, bigint, text, uuid, text
) from public, anon, authenticated;

revoke all on function public.kdj_get_pending_booking_approval(
    text, text, text, text, bigint, uuid, text
) from public, anon, authenticated;

grant execute on function public.kdj_prepare_booking_approval(
    text, uuid, uuid, integer, text, text, text, bigint, text, text, text,
    text, smallint, smallint, text, uuid, text
) to service_role;

grant execute on function public.kdj_record_booking_summary_sent(
    text, uuid, uuid, integer, text, text, text, bigint, uuid, text
) to service_role;

grant execute on function public.kdj_submit_booking_approval(
    text, uuid, uuid, integer, text, text, text, text, bigint, text, uuid, text
) to service_role;

grant execute on function public.kdj_get_pending_booking_approval(
    text, text, text, text, bigint, uuid, text
) to service_role;

comment on table private.booking_customer_approvals is
'RT-04 private durable customer booking approval evidence. Raw WhatsApp JIDs and message bodies are not stored.';

comment on table private.kdj_bot_attestation_keys is
'RT-04 Bot-only HMAC key custody. Owner/DB-operator provision and rotate keys; service_role has no table/schema access.';

comment on function public.kdj_prepare_booking_approval(
    text, uuid, uuid, integer, text, text, text, bigint, text, text, text,
    text, smallint, smallint, text, uuid, text
) is
'RT-04 Bot-attested prepare. Computes canonical summary hash in PostgreSQL and creates 10-minute approval request; no booking is created.';

comment on function public.kdj_submit_booking_approval(
    text, uuid, uuid, integer, text, text, text, text, bigint, text, uuid, text
) is
'RT-04 Bot-attested explicit customer approval/cancel. Persists candidate-before-send-acceptance and creates booking only from the frozen approved snapshot.';

commit;

-- OPERATOR KEY PROVISIONING (run separately as postgres after reviewing this migration):
-- 1. Generate 32+ random bytes; never reuse KDJ_DAILY_REPORT_HMAC_KEY.
-- 2. Insert only the Bot-specific key into private.kdj_bot_attestation_keys.
-- 3. Store the identical hex key only in the Bot runtime env KDJ_BOOKING_APPROVAL_HMAC_KEY.
-- 4. Do not use Supabase Vault while service_role retains broad Vault access.
-- Example (replace key material out-of-band; do NOT commit the literal):
-- insert into private.kdj_bot_attestation_keys (key_id, key_bytes, status)
-- values ('rt04-v1', decode('<64+ HEX CHARACTERS>', 'hex'), 'ACTIVE');
--
-- CUTOVER BLOCKERS intentionally untouched by this additive migration: