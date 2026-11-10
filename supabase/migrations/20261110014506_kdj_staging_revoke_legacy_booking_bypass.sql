-- Close the Staging legacy booking bypass after OD-08 inventory.
-- The Admin and RT-04 SECURITY DEFINER wrappers remain able to call the
-- postgres-owned Scheduling V2 core. This migration is Staging-only.

begin;

revoke execute on function public.kdj_create_booking(
    text, text, text, timestamptz, text
) from service_role;

revoke insert, update, delete, truncate
    on table public.jadwal_konsultasi
    from service_role;

do $verify$
begin
    if pg_catalog.has_function_privilege(
        'service_role',
        'public.kdj_create_booking(text,text,text,timestamp with time zone,text)',
        'EXECUTE'
    ) then
        raise exception 'STAGING_CUTOVER_FAILED: service_role can still execute legacy booking RPC';
    end if;

    if pg_catalog.has_table_privilege('service_role', 'public.jadwal_konsultasi', 'INSERT')
       or pg_catalog.has_table_privilege('service_role', 'public.jadwal_konsultasi', 'UPDATE')
       or pg_catalog.has_table_privilege('service_role', 'public.jadwal_konsultasi', 'DELETE')
       or pg_catalog.has_table_privilege('service_role', 'public.jadwal_konsultasi', 'TRUNCATE') then
        raise exception 'STAGING_CUTOVER_FAILED: service_role retains direct booking-table DML';
    end if;

    if not pg_catalog.has_table_privilege(
        'service_role', 'public.jadwal_konsultasi', 'SELECT'
    ) then
        raise exception 'STAGING_CUTOVER_FAILED: service_role booking SELECT was unexpectedly removed';
    end if;

    if not pg_catalog.has_function_privilege(
        'postgres',
        'public.kdj_create_booking(text,text,text,timestamp with time zone,text)',
        'EXECUTE'
    ) then
        raise exception 'STAGING_CUTOVER_FAILED: postgres lost Scheduling V2 booking core EXECUTE';
    end if;

    if not pg_catalog.has_function_privilege(
        'service_role',
        'public.kdj_admin_create_booking_attested(text,uuid,integer,text,text,text,timestamp with time zone,text,bigint,uuid,text)',
        'EXECUTE'
    ) then
        raise exception 'STAGING_CUTOVER_FAILED: Admin attested RPC is not executable by service_role';
    end if;

    if not pg_catalog.has_function_privilege(
        'service_role',
        'public.kdj_submit_booking_approval(text,uuid,uuid,integer,text,text,text,text,bigint,text,uuid,text)',
        'EXECUTE'
    ) then
        raise exception 'STAGING_CUTOVER_FAILED: RT-04 approval RPC is not executable by service_role';
    end if;
end;
$verify$;

comment on function public.kdj_create_booking(
    text, text, text, timestamptz, text
) is
'Scheduling V2 + Outbox transactional core. On Staging, service_role direct EXECUTE is revoked; call through the attested Admin or RT-04 customer approval wrapper only.';

commit;
