import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getSupabaseAdmin } from '@/lib/security';
import {
    createFinancialDocumentSignedUrl,
    ensureFinancialDocumentPdf
} from '@/lib/financial-document-storage.mjs';

function matchesSecret(providedValue, expectedValue) {
    const provided = Buffer.from(String(providedValue || ''), 'utf8');
    const expected = Buffer.from(String(expectedValue || ''), 'utf8');
    if (!provided.length || !expected.length || provided.length !== expected.length) return false;
    return timingSafeEqual(provided, expected);
}

export async function POST(request) {
    const expectedKey = process.env.WA_BOT_API_KEY || process.env.INTERNAL_API_KEY || '';
    const providedKey =
        request.headers.get('x-kdj-bot-api-key') ||
        request.headers.get('x-api-key') ||
        '';

    if (!matchesSecret(providedKey, expectedKey)) {
        return NextResponse.json(
            { success: false, code: 'UNAUTHORIZED', message: 'Akses internal tidak diizinkan.' },
            { status: 401, headers: { 'Cache-Control': 'no-store' } }
        );
    }

    try {
        const body = await request.json().catch(() => null);
        const documentId = String(body?.document_id || '');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(documentId)) {
            return NextResponse.json(
                { success: false, code: 'INVALID_DOCUMENT_ID', message: 'ID dokumen tidak valid.' },
                { status: 400, headers: { 'Cache-Control': 'no-store' } }
            );
        }

        const supabase = getSupabaseAdmin();
        const { data: document, error: documentError } = await supabase
            .from('kdj_financial_documents')
            .select('id, pendaftar_id, document_type, document_number, amount_idr, currency, status, issued_at, due_at, paid_at, supersedes_document_id, document_snapshot, storage_bucket, storage_path, sha256, rendered_at')
            .eq('id', documentId)
            .maybeSingle();

        if (documentError) throw documentError;
        if (!document) {
            return NextResponse.json(
                { success: false, code: 'FINANCIAL_DOCUMENT_NOT_FOUND', message: 'Dokumen tidak ditemukan.' },
                { status: 404, headers: { 'Cache-Control': 'no-store' } }
            );
        }

        const rendered = await ensureFinancialDocumentPdf(supabase, document);
        const downloadUrl = await createFinancialDocumentSignedUrl(
            supabase,
            rendered.storagePath,
            180
        );

        return NextResponse.json({
            success: true,
            document_id: document.id,
            document_type: document.document_type,
            document_number: document.document_number,
            download_url: downloadUrl,
            sha256: rendered.sha256,
            expires_at: new Date(Date.now() + 180_000).toISOString()
        }, {
            status: 200,
            headers: { 'Cache-Control': 'no-store, private' }
        });
    } catch (error) {
        const message = String(error?.message || 'FINANCIAL_DOCUMENT_RENDER_FAILED');
        const signatureNotConfigured = message.includes('KDJ_ISSUER_SIGNATURE_NOT_CONFIGURED');
        const status = signatureNotConfigured ? 503 : 500;
        return NextResponse.json({
            success: false,
            code: message.split(/[\s:]/)[0].slice(0, 100),
            message: signatureNotConfigured
                ? 'Tanda tangan penerbit belum dikonfigurasi di server.'
                : 'Dokumen belum dapat disiapkan.'
        }, {
            status,
            headers: { 'Cache-Control': 'no-store, private' }
        });
    }
}
