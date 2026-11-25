import { createHash } from 'node:crypto';
import { renderFinancialDocumentPdf } from './financial-document-pdf.mjs';

const BUCKET = 'kdj-financial-documents';

function sha256(buffer) {
    return createHash('sha256').update(buffer).digest('hex');
}

function createObjectPath(document) {
    const prefix = document.document_type === 'INVOICE' ? 'INV' : 'KWT';
    const issuedAt = new Date(document.issued_at || Date.now());
    if (Number.isNaN(issuedAt.getTime())) {
        throw new TypeError('Document issue date is invalid.');
    }
    const year = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric'
    }).format(issuedAt);
    const safeNumber = String(document.document_number || '')
        .replace(/[^A-Z0-9_-]/gi, '-')
        .slice(0, 100);
    if (!/^[0-9a-f-]{36}$/i.test(String(document.pendaftar_id || '')) || !safeNumber) {
        throw new TypeError('Document owner or document number is invalid.');
    }
    return `${document.pendaftar_id}/${prefix}/${year}/${safeNumber}.pdf`;
}

async function readStorageObject(supabase, objectPath) {
    const { data, error } = await supabase.storage.from(BUCKET).download(objectPath);
    if (error || !data) return null;
    const buffer = Buffer.from(await data.arrayBuffer());
    return buffer.subarray(0, 5).toString('ascii') === '%PDF-' ? buffer : null;
}

/**
 * Renders once and stores an immutable PDF object in the private financial-documents bucket.
 * If an upload succeeded but the metadata RPC did not, an identical existing PDF is recovered.
 */
export async function ensureFinancialDocumentPdf(supabase, document) {
    if (!document?.id || !document?.pendaftar_id || !document?.document_number) {
        throw new TypeError('Financial document metadata is incomplete.');
    }

    if (document.storage_path && document.sha256) {
        const existing = await readStorageObject(supabase, document.storage_path);
        if (!existing || sha256(existing) !== document.sha256) {
            throw new Error('Stored financial PDF is missing or its checksum does not match.');
        }
        return {
            storagePath: document.storage_path,
            sha256: document.sha256,
            buffer: existing,
            created: false
        };
    }

    if (!process.env.KDJ_ISSUER_SIGNATURE_BASE64) {
        throw new Error('KDJ_ISSUER_SIGNATURE_NOT_CONFIGURED');
    }

    const pdfBuffer = await renderFinancialDocumentPdf(document);
    if (pdfBuffer.length > 10 * 1024 * 1024) {
        throw new Error('FINANCIAL_DOCUMENT_PDF_TOO_LARGE');
    }
    if (pdfBuffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
        throw new Error('PDF renderer returned an invalid PDF payload.');
    }

    const objectPath = createObjectPath(document);
    const digest = sha256(pdfBuffer);
    const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(objectPath, pdfBuffer, {
            contentType: 'application/pdf',
            cacheControl: '0',
            upsert: false
        });

    if (uploadError) {
        const existing = await readStorageObject(supabase, objectPath);
        if (!existing || sha256(existing) !== digest) {
            throw new Error('Financial PDF upload failed: ' + uploadError.message);
        }
    }

    const { data, error } = await supabase.rpc('kdj_financial_document_mark_rendered', {
        p_document_id: document.id,
        p_storage_path: objectPath,
        p_sha256: digest
    });
    if (error || data?.success !== true) {
        throw new Error('Failed to persist financial PDF metadata: ' + (error?.message || 'RPC rejected the render'));
    }

    return {
        storagePath: objectPath,
        sha256: digest,
        buffer: pdfBuffer,
        created: true
    };
}

export async function createFinancialDocumentSignedUrl(supabase, objectPath, expiresInSeconds = 300) {
    if (typeof objectPath !== 'string' || !/^[0-9a-f-]{36}\/[A-Z]{3}\/[0-9]{4}\/[A-Z0-9_-]+[.]pdf$/i.test(objectPath)) {
        throw new TypeError('Financial PDF storage path is invalid.');
    }
    const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(objectPath, expiresInSeconds);
    if (error || !data?.signedUrl) {
        throw new Error('Failed to create private financial PDF URL.');
    }
    return data.signedUrl;
}
