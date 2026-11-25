import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migration = fs.readFileSync(
    path.join(root, 'supabase', 'migrations', '20261125040000_kdj_financial_documents_v1.sql'),
    'utf8'
);

const db = new PGlite();

async function rows(sql, params = []) {
    const result = await db.query(sql, params);
    return result.rows;
}

async function scalar(sql, params = []) {
    const result = await rows(sql, params);
    return result[0]?.value;
}

const bootstrap = `
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA storage;

CREATE TABLE storage.buckets (
    id text PRIMARY KEY,
    name text NOT NULL,
    public boolean NOT NULL DEFAULT false,
    file_size_limit bigint,
    allowed_mime_types text[]
);

CREATE TABLE public.admins (
    id uuid PRIMARY KEY,
    role text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    disabled_at timestamptz
);

CREATE TABLE public.pendaftar (
    id uuid PRIMARY KEY,
    nama_lengkap text,
    no_wa text
);

CREATE TABLE public.kdj_registration_payments (
    id uuid PRIMARY KEY,
    pendaftar_id uuid NOT NULL REFERENCES public.pendaftar(id),
    invoice_ref text NOT NULL,
    amount_idr integer NOT NULL,
    status text NOT NULL,
    initial_submission_at timestamptz NOT NULL,
    deadline_at timestamptz NOT NULL,
    paid_at timestamptz
);

CREATE TABLE public.kdj_registration_payment_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id uuid NOT NULL REFERENCES public.kdj_registration_payments(id),
    pendaftar_id uuid NOT NULL REFERENCES public.pendaftar(id),
    event_type text NOT NULL,
    previous_status text,
    new_status text NOT NULL,
    proof_id uuid,
    actor_type text NOT NULL,
    actor_admin_id uuid,
    reason text,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.kdj_departure_orders (
    id uuid PRIMARY KEY,
    pendaftar_id uuid NOT NULL REFERENCES public.pendaftar(id),
    package_id text NOT NULL,
    package_name text NOT NULL,
    total_amount_idr integer NOT NULL,
    paid_amount_idr integer NOT NULL,
    remaining_amount_idr integer NOT NULL,
    payment_status text NOT NULL,
    fully_paid_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.kdj_departure_installments (
    id uuid PRIMARY KEY,
    order_id uuid NOT NULL REFERENCES public.kdj_departure_orders(id),
    pendaftar_id uuid NOT NULL REFERENCES public.pendaftar(id),
    installment_no integer NOT NULL,
    amount_idr integer NOT NULL,
    status text NOT NULL,
    verified_at timestamptz
);

CREATE TABLE public.kdj_departure_payment_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL REFERENCES public.kdj_departure_orders(id),
    installment_id uuid REFERENCES public.kdj_departure_installments(id),
    pendaftar_id uuid NOT NULL REFERENCES public.pendaftar(id),
    event_type text NOT NULL,
    amount_idr integer,
    previous_paid_amount_idr integer,
    new_paid_amount_idr integer,
    remaining_amount_idr integer,
    actor_type text NOT NULL,
    actor_admin_id uuid,
    note text,
    created_at timestamptz NOT NULL DEFAULT now()
);
`;

try {
    await db.exec(bootstrap);
await db.exec(migration);

    assert.equal(await scalar("SELECT public.kdj_normalize_financial_document_phone('+62 812-3456-7890') AS value"), '+6281234567890');
    assert.equal(await scalar("SELECT public.kdj_normalize_financial_document_phone('08 1234 567890') AS value"), '+6281234567890');
    assert.equal(await scalar("SELECT public.kdj_normalize_financial_document_phone('+962 7 9000 1234') AS value"), '+962790001234');
    assert.equal(await scalar("SELECT public.kdj_normalize_financial_document_phone('+967 7 1234 5678') AS value"), '+967712345678');
    assert.equal(await scalar("SELECT public.kdj_normalize_financial_document_phone('+971 50 123 4567') AS value"), null);

    const adminId = '10000000-0000-4000-8000-000000000001';
    const applicantId = '20000000-0000-4000-8000-000000000001';
    const registrationPaymentId = '30000000-0000-4000-8000-000000000001';
    const orderId = '40000000-0000-4000-8000-000000000001';
    const installmentOneId = '50000000-0000-4000-8000-000000000001';
    const installmentTwoId = '50000000-0000-4000-8000-000000000002';

    await db.query(
        `INSERT INTO public.admins (id, role, is_active)
         VALUES ($1, 'Super Admin', true)`,
        [adminId]
    );
    await db.query(
        `INSERT INTO public.pendaftar (id, nama_lengkap, no_wa)
         VALUES ($1, 'Umair Test', '+62 812-3456-7890')`,
        [applicantId]
    );

    // Registration invoice: generated when the server-side payment event is recorded.
    await db.query(
        `INSERT INTO public.kdj_registration_payments
         (id, pendaftar_id, invoice_ref, amount_idr, status, initial_submission_at, deadline_at)
         VALUES ($1, $2, 'REG-TEST-001', 2500000, 'PENDING_PAYMENT',
                 '2026-11-18T03:00:00Z', '2026-11-19T03:00:00Z')`,
        [registrationPaymentId, applicantId]
    );

    const insertRegistrationEvent = async (eventType, previousStatus, newStatus, actorAdminId = null) => {
        return db.query(
            `INSERT INTO public.kdj_registration_payment_events
             (payment_id, pendaftar_id, event_type, previous_status, new_status, actor_type, actor_admin_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [registrationPaymentId, applicantId, eventType, previousStatus, newStatus,
                actorAdminId ? 'ADMIN' : 'CUSTOMER', actorAdminId]
        );
    };

    await insertRegistrationEvent('INITIAL_FORM_SUBMITTED', null, 'PENDING_PAYMENT');
    let docs = await rows(
        `SELECT id, document_type, amount_idr, due_at, status, document_snapshot
         FROM public.kdj_financial_documents
         WHERE registration_payment_id = $1`,
        [registrationPaymentId]
    );
    assert.equal(docs.length, 1);
    assert.equal(docs[0].document_type, 'INVOICE');
    assert.equal(docs[0].amount_idr, 2500000);
    assert.equal(docs[0].status, 'ISSUED');
    assert.ok(docs[0].due_at);
    assert.equal(docs[0].document_snapshot.issuer.bank_account_number, '7169735128');

    await insertRegistrationEvent('INITIAL_FORM_SUBMITTED', null, 'PENDING_PAYMENT');
    assert.equal(Number(await scalar(
        `SELECT count(*)::integer AS value FROM public.kdj_financial_documents WHERE registration_payment_id = $1`,
        [registrationPaymentId]
    )), 1, 'Repeated registration submission must not duplicate its invoice');

    // Reopen the registration deadline: retain the prior invoice and link a replacement.
    await db.query(
        `UPDATE public.kdj_registration_payments
         SET status = 'REOPENED', deadline_at = '2026-11-20T03:00:00Z'
         WHERE id = $1`,
        [registrationPaymentId]
    );
    await insertRegistrationEvent('PAYMENT_REOPENED', 'EXPIRED', 'REOPENED', adminId);
    docs = await rows(
        `SELECT id, status, due_at, supersedes_document_id
         FROM public.kdj_financial_documents
         WHERE registration_payment_id = $1 AND document_type = 'INVOICE'
         ORDER BY issued_at`,
        [registrationPaymentId]
    );
    assert.equal(docs.length, 2);
    assert.equal(docs[0].status, 'SUPERSEDED');
    assert.equal(docs[1].status, 'ISSUED');
    assert.equal(docs[1].supersedes_document_id, docs[0].id);
    assert.equal(new Date(docs[1].due_at).toISOString(), '2026-11-20T03:00:00.000Z');

    // A confirmed registration payment atomically settles the active invoice and issues one receipt.
    await db.query(
        `UPDATE public.kdj_registration_payments
         SET status = 'PAID', paid_at = '2026-11-18T04:00:00Z'
         WHERE id = $1`,
        [registrationPaymentId]
    );
    await insertRegistrationEvent('PAYMENT_VERIFIED_PAID', 'PROOF_SUBMITTED', 'PAID', adminId);
    await insertRegistrationEvent('PAYMENT_VERIFIED_PAID', 'PROOF_SUBMITTED', 'PAID', adminId);
    docs = await rows(
        `SELECT document_type, amount_idr, status, paid_at, source_key
         FROM public.kdj_financial_documents
         WHERE registration_payment_id = $1`,
        [registrationPaymentId]
    );
    assert.equal(docs.filter((d) => d.document_type === 'RECEIPT').length, 1,
        'One confirmed registration payment must produce exactly one receipt');
    assert.equal(docs.find((d) => d.document_type === 'RECEIPT').amount_idr, 2500000);
    const registrationReceiptSnapshot = (await rows(
        'SELECT document_snapshot FROM public.kdj_financial_documents WHERE registration_payment_id = $1 AND document_type = $2',
        [registrationPaymentId, 'RECEIPT']
    ))[0].document_snapshot;
    assert.equal(registrationReceiptSnapshot.payment_entries[0].amount_idr, 2500000);
    assert.equal(registrationReceiptSnapshot.package_total_amount_idr, 2500000);
    assert.equal(registrationReceiptSnapshot.remaining_amount_idr, 0);
    assert.equal(registrationReceiptSnapshot.issuer.legal_name, 'Yayasan Generasi Cerdas Akhlakul Karimah');
    assert.equal(registrationReceiptSnapshot.issuer.logo_sha256, 'f767d1b60983722435769d59654b8693a4dbe4524f52249486e99bacbad15b6b');
    assert.equal(registrationReceiptSnapshot.issuer.signature_sha256, '82b765625730ec6ab70e9bc0f093ad1c40c3d0d4f643074e22596c9e07ba4c51');
    assert.equal(docs.filter((d) => d.document_type === 'INVOICE' && d.status === 'PAID').length, 1);

    // Departure package selection creates the initial package invoice.
    await db.query(
        `INSERT INTO public.kdj_departure_orders
         (id, pendaftar_id, package_id, package_name, total_amount_idr,
          paid_amount_idr, remaining_amount_idr, payment_status)
         VALUES ($1, $2, 'SIAP_KULIAH', 'Paket Siap Kuliah',
                 20000000, 0, 20000000, 'UNPAID')`,
        [orderId, applicantId]
    );

    const insertDepartureEvent = async (installmentId, amount, previousPaid, newPaid, remaining) => {
        await db.query(
            `INSERT INTO public.kdj_departure_payment_events
             (order_id, installment_id, pendaftar_id, event_type, amount_idr,
              previous_paid_amount_idr, new_paid_amount_idr, remaining_amount_idr, actor_type, actor_admin_id)
             VALUES ($1, $2, $3, 'INSTALLMENT_VERIFIED', $4, $5, $6, $7, 'ADMIN', $8)`,
            [orderId, installmentId, applicantId, amount, previousPaid, newPaid, remaining, adminId]
        );
    };

    await db.query(
        `INSERT INTO public.kdj_departure_payment_events
         (order_id, pendaftar_id, event_type, amount_idr,
          previous_paid_amount_idr, new_paid_amount_idr, remaining_amount_idr, actor_type)
         VALUES ($1, $2, 'PACKAGE_SELECTED', 20000000, 0, 0, 20000000, 'STUDENT')`,
        [orderId, applicantId]
    );
    let orderInvoices = await rows(
        `SELECT id, amount_idr, status, document_snapshot
         FROM public.kdj_financial_documents
         WHERE departure_order_id = $1 AND document_type = 'INVOICE'`,
        [orderId]
    );
    assert.equal(orderInvoices.length, 1);
    assert.equal(orderInvoices[0].amount_idr, 20000000);

    // Duplicate package selection (e.g. same request retried) does not issue another invoice.
    await db.query(
        `INSERT INTO public.kdj_departure_payment_events
         (order_id, pendaftar_id, event_type, amount_idr,
          previous_paid_amount_idr, new_paid_amount_idr, remaining_amount_idr, actor_type)
         VALUES ($1, $2, 'PACKAGE_SELECTED', 20000000, 0, 0, 20000000, 'STUDENT')`,
        [orderId, applicantId]
    );
    assert.equal(Number(await scalar(
        `SELECT count(*)::integer AS value FROM public.kdj_financial_documents
         WHERE departure_order_id = $1 AND document_type = 'INVOICE'`,
        [orderId]
    )), 1);

    // First verified installment: receipt uses the actual transaction amount, new invoice is all remaining balance.
    await db.query(
        `INSERT INTO public.kdj_departure_installments
         (id, order_id, pendaftar_id, installment_no, amount_idr, status, verified_at)
         VALUES ($1, $2, $3, 1, 5000000, 'VERIFIED', '2026-11-18T05:00:00Z')`,
        [installmentOneId, orderId, applicantId]
    );
    await db.query(
        `UPDATE public.kdj_departure_orders
         SET paid_amount_idr = 5000000, remaining_amount_idr = 15000000,
             payment_status = 'PARTIALLY_PAID'
         WHERE id = $1`,
        [orderId]
    );
    await insertDepartureEvent(installmentOneId, 5000000, 0, 5000000, 15000000);
    await insertDepartureEvent(installmentOneId, 5000000, 0, 5000000, 15000000);

    const departureDocsAfterFirst = await rows(
        `SELECT id, document_type, amount_idr, status, supersedes_document_id, source_key
         FROM public.kdj_financial_documents
         WHERE departure_order_id = $1
         ORDER BY issued_at, document_type`,
        [orderId]
    );
    assert.equal(departureDocsAfterFirst.filter((d) => d.document_type === 'RECEIPT').length, 1,
        'Duplicate installment event must not duplicate a receipt');
    const firstReceipt = departureDocsAfterFirst.find((d) => d.document_type === 'RECEIPT');
    assert.equal(firstReceipt.amount_idr, 5000000);
    const firstReceiptSnapshot = (await rows(
        'SELECT document_snapshot FROM public.kdj_financial_documents WHERE id = $1',
        [firstReceipt.id]
    ))[0].document_snapshot;
    assert.equal(firstReceiptSnapshot.payment_entries[0].amount_idr, 5000000);
    assert.equal(firstReceiptSnapshot.package_total_amount_idr, 20000000);
    assert.equal(firstReceiptSnapshot.total_paid_amount_idr, 5000000);
    assert.equal(firstReceiptSnapshot.remaining_amount_idr, 15000000);
    const firstInvoice = departureDocsAfterFirst.find((d) => d.document_type === 'INVOICE');
    const replacementInvoice = departureDocsAfterFirst
        .filter((d) => d.document_type === 'INVOICE')
        .find((d) => d.status === 'ISSUED');
    assert.equal(firstInvoice.status, 'SUPERSEDED');
    assert.equal(replacementInvoice.amount_idr, 15000000);
    assert.equal(replacementInvoice.supersedes_document_id, firstInvoice.id);

    // Final payment creates its own receipt, closes the current invoice, and never creates a zero-value invoice.
    await db.query(
        `INSERT INTO public.kdj_departure_installments
         (id, order_id, pendaftar_id, installment_no, amount_idr, status, verified_at)
         VALUES ($1, $2, $3, 2, 15000000, 'VERIFIED', '2026-11-18T06:00:00Z')`,
        [installmentTwoId, orderId, applicantId]
    );
    await db.query(
        `UPDATE public.kdj_departure_orders
         SET paid_amount_idr = 20000000, remaining_amount_idr = 0,
             payment_status = 'PAID', fully_paid_at = '2026-11-18T06:00:00Z'
         WHERE id = $1`,
        [orderId]
    );
    await insertDepartureEvent(installmentTwoId, 15000000, 5000000, 20000000, 0);

    const finalDepartureDocs = await rows(
        `SELECT document_type, amount_idr, status, paid_at
         FROM public.kdj_financial_documents
         WHERE departure_order_id = $1`,
        [orderId]
    );
    const departureReceipts = finalDepartureDocs.filter((d) => d.document_type === 'RECEIPT');
    const departureInvoices = finalDepartureDocs.filter((d) => d.document_type === 'INVOICE');
    assert.equal(departureReceipts.length, 2);
    assert.deepEqual(departureReceipts.map((d) => d.amount_idr).sort((a, b) => a - b), [5000000, 15000000]);
    assert.equal(departureInvoices.length, 2);
    assert.equal(departureInvoices.filter((d) => d.status === 'SUPERSEDED').length, 1);
    assert.equal(departureInvoices.filter((d) => d.status === 'PAID').length, 1);
    assert.ok(finalDepartureDocs.every((d) => d.amount_idr > 0), 'No zero-value invoice or receipt may be created');

    // H-45 is explicitly a follow-up note, never a payment restriction or due date.
    const finalInvoice = departureInvoices.find((d) => d.amount_idr === 15000000);
    const finalInvoiceSnapshot = (await rows(
        `SELECT document_snapshot FROM public.kdj_financial_documents
         WHERE departure_order_id = $1 AND document_type = 'INVOICE' AND amount_idr = 15000000`,
        [orderId]
    ))[0].document_snapshot;
    assert.equal(finalInvoiceSnapshot.due_at, undefined);
    assert.match(finalInvoiceSnapshot.notes, /H-45 hanya trigger follow-up/);

    // Private PDF metadata is immutable after first render.
    const documentToRender = (await rows(
        `SELECT id, pendaftar_id, document_type, document_number
         FROM public.kdj_financial_documents
         WHERE departure_order_id = $1 AND document_type = 'RECEIPT'
         LIMIT 1`,
        [orderId]
    ))[0];
    const storagePath = documentToRender.pendaftar_id + '/KWT/2026/' +
        documentToRender.document_number.replace(/[^A-Z0-9_-]/gi, '-') + '.pdf';
    const hash = 'a'.repeat(64);
    const rendered = await db.query(
        `SELECT public.kdj_financial_document_mark_rendered($1, $2, $3) AS result`,
        [documentToRender.id, storagePath, hash]
    );
    assert.equal(rendered.rows[0].result.success, true);
    await assert.rejects(
        () => db.query(
            "UPDATE public.kdj_financial_documents SET document_snapshot = document_snapshot || '{\"tampered\":true}'::jsonb WHERE id = $1",
            [documentToRender.id]
        ),
        /FINANCIAL_DOCUMENT_CONTENT_IS_IMMUTABLE/
    );
    await assert.rejects(
        () => db.query(
            "UPDATE public.kdj_financial_document_events SET reason = 'tampered' WHERE document_id = $1",
            [documentToRender.id]
        ),
        /FINANCIAL_DOCUMENT_EVENTS_APPEND_ONLY/
    );
    await assert.rejects(
        () => db.query(
            `SELECT public.kdj_financial_document_mark_rendered($1, $2, $3)`,
            [documentToRender.id, storagePath, 'b'.repeat(64)]
        ),
        /FINANCIAL_DOCUMENT_PDF_IS_IMMUTABLE/
    );

    // Durable outbox: UNKNOWN is not claimable until explicit reconciliation.
    const claims = await rows('SELECT * FROM public.kdj_financial_document_claim_outbox_batch(50)');
    assert.ok(claims.length >= 6);
    const claim = claims[0];
    await db.query(
        `SELECT public.kdj_financial_document_finish_outbox($1, $2, 'UNKNOWN', NULL, 'WA_TIMEOUT', 'Send outcome is uncertain')`,
        [claim.outbox_id, claim.claim_token]
    );
    assert.equal(
        await scalar(`SELECT status AS value FROM public.kdj_financial_document_outbox WHERE id = $1`, [claim.outbox_id]),
        'UNKNOWN'
    );
    const secondClaims = await rows('SELECT * FROM public.kdj_financial_document_claim_outbox_batch(50)');
    assert.ok(!secondClaims.some((row) => row.outbox_id === claim.outbox_id),
        'UNKNOWN delivery must never auto-retry');

    await db.query(
        `SELECT public.kdj_admin_reconcile_financial_document_unknown(
            $1, 'CONFIRMED_NOT_SENT', NULL, 'Provider check confirms no message was delivered.', $2
        )`,
        [claim.outbox_id, adminId]
    );
    assert.equal(
        await scalar(`SELECT status AS value FROM public.kdj_financial_document_outbox WHERE id = $1`, [claim.outbox_id]),
        'PENDING'
    );

    const retryClaims = await rows('SELECT * FROM public.kdj_financial_document_claim_outbox_batch(50)');
    const retryClaim = retryClaims.find((row) => row.outbox_id === claim.outbox_id);
    assert.ok(retryClaim);
    await db.query(
        `SELECT public.kdj_financial_document_finish_outbox($1, $2, 'SENT', 'wamid.test.123', NULL, NULL)`,
        [retryClaim.outbox_id, retryClaim.claim_token]
    );
    assert.equal(
        await scalar(`SELECT status AS value FROM public.kdj_financial_document_outbox WHERE id = $1`, [claim.outbox_id]),
        'SENT'
    );

    const resendResult = await rows(
        `SELECT public.kdj_admin_resend_financial_document($1, $2, 'Customer requested the same receipt again.') AS result`,
        [claim.outbox_id, adminId]
    );
    assert.equal(resendResult[0].result.success, true);
    assert.equal(
        await scalar(`SELECT status AS value FROM public.kdj_financial_document_outbox WHERE id = $1`, [claim.outbox_id]),
        'PENDING'
    );

    // RLS and grants: client roles get no direct document-table access.
    const privilegeRows = await rows(`
        SELECT
            has_table_privilege('anon', 'public.kdj_financial_documents', 'SELECT') AS anon_select,
            has_table_privilege('authenticated', 'public.kdj_financial_documents', 'SELECT') AS auth_select,
            has_table_privilege('service_role', 'public.kdj_financial_documents', 'SELECT') AS service_select,
            (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.kdj_financial_documents'::regclass) AS rls_enabled
    `);
    assert.equal(privilegeRows[0].anon_select, false);
    assert.equal(privilegeRows[0].auth_select, false);
    assert.equal(privilegeRows[0].service_select, true);
    assert.equal(privilegeRows[0].rls_enabled, true);

    // Static Portal checks: no public bucket or unsigned file URL is used by application routes.
    const pdfModule = fs.readFileSync(path.join(root, 'lib', 'financial-document-pdf.mjs'), 'utf8');
    const storageModule = fs.readFileSync(path.join(root, 'lib', 'financial-document-storage.mjs'), 'utf8');
    const customerRoute = fs.readFileSync(path.join(root, 'app', 'api', 'financial-documents', 'route.js'), 'utf8');
    const downloadRoute = fs.readFileSync(path.join(root, 'app', 'api', 'financial-documents', '[id]', 'download', 'route.js'), 'utf8');
    const internalRoute = fs.readFileSync(path.join(root, 'app', 'api', 'internal', 'financial-documents', 'render', 'route.js'), 'utf8');
    assert.match(pdfModule, /KWITANSI/);
    assert.match(pdfModule, /jatuh tempo/i);
    assert.match(pdfModule, /bank_account_number/);
    assert.match(storageModule, /upsert: false/);
    assert.match(customerRoute, /getUserSession/);
    assert.match(downloadRoute, /eq\('pendaftar_id', ownerId\)/);
    assert.match(internalRoute, /timingSafeEqual/);

    console.log('[PASS] Financial migration executed in isolated PostgreSQL (PGlite).');
    console.log('[PASS] Registration invoices, reopened invoices, verified receipts, and idempotency.');
    console.log('[PASS] Package invoices, all-remaining replacement invoices, per-installment receipts, and full settlement.');
    console.log('[PASS] Private PDF render metadata, immutable checksum, and secure Portal access contract.');
    console.log('[PASS] Durable WhatsApp Outbox claim/finish, UNKNOWN reconciliation, resend, RLS and ACL.');

} finally {
    await db.close();
}
