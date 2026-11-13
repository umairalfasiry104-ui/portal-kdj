-- RT04 PREPARE preflight: enforce unchanged Scheduling V2 policy before WhatsApp summary.
-- The final kdj_create_booking transaction remains the authoritative race-safe check.

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
    v_local_start timestamp without time zone;
    v_local_now timestamp without time zone;
    v_alternatives jsonb := '[]'::jsonb;
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

    -- Enforce the existing Scheduling V2 policy before the customer sees a
    -- summary. Keep the same H-1/date, weekday, and working-hours predicates
    -- used by public.kdj_create_booking.
    v_local_start := v_schedule AT TIME ZONE 'Asia/Jakarta';
    v_local_now := pg_catalog.now() AT TIME ZONE 'Asia/Jakarta';

    if v_local_start::date <= v_local_now::date then
        return jsonb_build_object(
            'ok', false,
            'code', 'BOOKING_REQUIRES_PREVIOUS_DAY',
            'message', 'Booking WhatsApp harus dibuat paling lambat sehari sebelum tanggal konsultasi.'
        );
    end if;

    if extract(isodow from v_local_start)::integer not between 1 and 5 then
        return jsonb_build_object(
            'ok', false,
            'code', 'CLOSED_DAY',
            'message', 'Konsultasi hanya tersedia Senin sampai Jumat.'
        );
    end if;

    if v_local_start < (v_local_start::date + time '09:00')
       or v_local_start + interval '120 minutes' > (v_local_start::date + time '17:00') then
        return jsonb_build_object(
            'ok', false,
            'code', 'OUTSIDE_WORKING_HOURS',
            'message', 'Jam konsultasi adalah 09.00–17.00 WIB. Waktu mulai terakhir untuk sesi 120 menit adalah 15.00 WIB.'
        );
    end if;

    -- Preflight against already-active bookings using the same 150-minute
    -- exclusion window as Scheduling V2. The final create RPC remains
    -- authoritative and rechecks this inside its transaction (race safety).
    if exists (
        select 1
        from public.jadwal_konsultasi as booking
        where coalesce(booking.status, 'Terjadwal') = 'Terjadwal'
          and pg_catalog.tstzrange(
                booking.jadwal_pilihan,
                booking.blokir_sampai,
                '[)'
              )
              &&
              pg_catalog.tstzrange(
                v_schedule,
                v_schedule + interval '150 minutes',
                '[)'
              )
    ) then
        select coalesce(
            pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object('jadwal_pilihan', alternatives.jadwal_pilihan)
                order by alternatives.jadwal_pilihan
            ),
            '[]'::jsonb
        )
        into v_alternatives
        from public.kdj_find_booking_alternatives(v_schedule, 3, 45) as alternatives;

        return jsonb_build_object(
            'ok', false,
            'code', 'SLOT_UNAVAILABLE',
            'alternatives', v_alternatives
        );
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

revoke all on function public.kdj_prepare_booking_approval(text, uuid, uuid, integer, text, text, text, bigint, text, text, text, text, smallint, smallint, text, uuid, text)
    from public, anon, authenticated;
grant execute on function public.kdj_prepare_booking_approval(text, uuid, uuid, integer, text, text, text, bigint, text, text, text, text, smallint, smallint, text, uuid, text)
    to service_role;
