-- Close the temporary staging key-bootstrap window immediately after key provisioning.
begin;

revoke all on function public.kdj_bootstrap_admin_booking_attestation_key(text, text)
    from public, anon, authenticated, service_role;
revoke all on function public.kdj_bootstrap_rt04_bot_attestation_key(text, text)
    from public, anon, authenticated, service_role;

grant execute on function public.kdj_bootstrap_admin_booking_attestation_key(text, text)
    to postgres;
grant execute on function public.kdj_bootstrap_rt04_bot_attestation_key(text, text)
    to postgres;

commit;
