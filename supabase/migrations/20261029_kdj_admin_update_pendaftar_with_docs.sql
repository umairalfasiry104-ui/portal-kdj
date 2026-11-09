-- Migration: atomic admin update for applicant and document statuses.
-- Function definition captured from the existing Supabase database.
-- Execution is restricted to the service_role.

CREATE OR REPLACE FUNCTION public.kdj_admin_update_pendaftar_with_docs(
    p_pendaftar_id uuid,
    p_status_pendaftaran text,
    p_status_pembayaran text,
    p_catatan_admin text,
    p_doc_updates jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
    v_pendaftar public.pendaftar%ROWTYPE;
    v_doc jsonb;
    v_doc_id_text text;
    v_doc_id uuid;
    v_doc_status text;
    v_doc_row public.dokumen_pendaftar%ROWTYPE;
    v_seen_doc_ids uuid[] := ARRAY[]::uuid[];
BEGIN
    -- Validasi status pendaftaran.
    IF p_status_pendaftaran IS NULL
       OR p_status_pendaftaran NOT IN (
           'Draft',
           'draft_berkas',
           'Submitted',
           'Revisi Diajukan',
           'Approved',
           'Rejected'
       )
    THEN
        RAISE EXCEPTION USING
            ERRCODE = '22023',
            MESSAGE = 'INVALID_STATUS_PENDAFTARAN';
    END IF;

    -- Validasi status pembayaran.
    IF p_status_pembayaran IS NULL
       OR p_status_pembayaran NOT IN (
           'Belum Bayar',
           'Menunggu Verifikasi',
           'Lunas',
           'Ditolak'
       )
    THEN
        RAISE EXCEPTION USING
            ERRCODE = '22023',
            MESSAGE = 'INVALID_STATUS_PEMBAYARAN';
    END IF;

    p_doc_updates := COALESCE(p_doc_updates, '[]'::jsonb);

    IF pg_catalog.jsonb_typeof(p_doc_updates)
       IS DISTINCT FROM 'array'
    THEN
        RAISE EXCEPTION USING
            ERRCODE = '22023',
            MESSAGE = 'INVALID_DOC_UPDATES';
    END IF;

    -- Kunci baris pendaftar agar update bersamaan terserialisasi.
    SELECT p.*
    INTO v_pendaftar
    FROM public.pendaftar AS p
    WHERE p.id = p_pendaftar_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P0002',
            MESSAGE = 'PENDAFTAR_NOT_FOUND';
    END IF;

    -- Validasi SEMUA dokumen dan kepemilikannya sebelum menulis data.
    FOR v_doc IN
        SELECT e.value
        FROM pg_catalog.jsonb_array_elements(p_doc_updates) AS e(value)
    LOOP
        IF pg_catalog.jsonb_typeof(v_doc)
           IS DISTINCT FROM 'object'
        THEN
            RAISE EXCEPTION USING
                ERRCODE = '22023',
                MESSAGE = 'INVALID_DOC_ITEM';
        END IF;

        v_doc_id_text := v_doc->>'id';
        v_doc_status := v_doc->>'status_dokumen';

        IF v_doc_id_text IS NULL
           OR v_doc_id_text !~*
              '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN
            RAISE EXCEPTION USING
                ERRCODE = '22023',
                MESSAGE = 'INVALID_DOC_ID';
        END IF;

        v_doc_id := v_doc_id_text::uuid;

        IF v_doc_status IS NULL
           OR v_doc_status NOT IN (
               'pending',
               'approved',
               'rejected'
           )
        THEN
            RAISE EXCEPTION USING
                ERRCODE = '22023',
                MESSAGE = 'INVALID_DOC_STATUS';
        END IF;

        IF v_doc_id = ANY(v_seen_doc_ids) THEN
            RAISE EXCEPTION USING
                ERRCODE = '22023',
                MESSAGE = 'DUPLICATE_DOC_ID';
        END IF;

        v_seen_doc_ids :=
            pg_catalog.array_append(v_seen_doc_ids, v_doc_id);

        SELECT d.*
        INTO v_doc_row
        FROM public.dokumen_pendaftar AS d
        WHERE d.id = v_doc_id
          AND d.pendaftar_id = p_pendaftar_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION USING
                ERRCODE = '22023',
                MESSAGE = 'DOC_NOT_FOUND_OR_NOT_OWNED';
        END IF;
    END LOOP;

    -- Update status utama setelah seluruh validasi selesai.
    UPDATE public.pendaftar
    SET
        status_pendaftaran = p_status_pendaftaran,
        status_pembayaran = p_status_pembayaran,
        catatan_admin = COALESCE(p_catatan_admin, ''),
        updated_at = pg_catalog.now()
    WHERE id = p_pendaftar_id
    RETURNING * INTO v_pendaftar;

    -- Setiap dokumen diproses satu kali.
    FOR v_doc IN
        SELECT e.value
        FROM pg_catalog.jsonb_array_elements(p_doc_updates) AS e(value)
    LOOP
        v_doc_id := (v_doc->>'id')::uuid;
        v_doc_status := v_doc->>'status_dokumen';

        UPDATE public.dokumen_pendaftar
        SET
            status_dokumen = v_doc_status,
            updated_at = pg_catalog.now()
        WHERE id = v_doc_id
          AND pendaftar_id = p_pendaftar_id;
    END LOOP;

    RETURN pg_catalog.to_jsonb(v_pendaftar);
END;
$function$;

-- Keep execution limited to the API's service-role client.
REVOKE ALL ON FUNCTION public.kdj_admin_update_pendaftar_with_docs(uuid, text, text, text, jsonb)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kdj_admin_update_pendaftar_with_docs(uuid, text, text, text, jsonb)
    TO service_role;
