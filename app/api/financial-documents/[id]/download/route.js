import { NextResponse } from 'next/server';
import { getSupabaseAdmin, getUserSession, requireAdminSession } from '@/lib/security';
import { ensureFinancialDocumentPdf } from '@/lib/financial-document-storage.mjs';
import { createHash } from 'node:crypto';


const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req, context) {
    try {
        const { id } = await context.params;
        if (!UUID_PATTERN.test(String(id || ''))) {
            return NextResponse.json({ success: false, message: 'ID dokumen tidak valid.' }, { status: 400 });
        }

        const supabase = getSupabaseAdmin();
        const adminAuth = await requireAdminSession(req);
        let ownerId = null;

        if (adminAuth.authorized) {
            if (adminAuth.admin?.role !== 'Super Admin') {
                return NextResponse.json({ success: false, message: 'Akses dokumen keuangan hanya tersedia untuk Super Admin.' }, { status: 403 });
            }
        } else {
            const session = await getUserSession(req);
            if (!session?.sub) {
                return NextResponse.json({ success: false, message: 'Sesi tidak valid.' }, { status: 401 });
            }
            ownerId = session.sub;
        }

        let query = supabase
            .from('kdj_financial_documents')
            .select('id, pendaftar_id, document_type, document_number, amount_idr, status, issued_at, due_at, paid_at, document_snapshot, storage_path, sha256')
            .eq('id', id);
        if (ownerId) query = query.eq('pendaftar_id', ownerId);

        const { data: document, error } = await query.maybeSingle();
        if (error) throw error;
        if (!document) {
            return NextResponse.json({ success: false, message: 'Dokumen tidak ditemukan.' }, { status: 404 });
        }

        const rendered = await ensureFinancialDocumentPdf(supabase, document);
        const { data: file, error: downloadError } = await supabase.storage
            .from('kdj-financial-documents')
            .download(rendered.storagePath);

        if (downloadError || !file) throw downloadError || new Error('PDF object not available.');
        const buffer = Buffer.from(await file.arrayBuffer());
        if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
            throw new Error('Stored document is not a valid PDF.');
        }
        const actualHash = createHash('sha256').update(buffer).digest('hex');
        if (actualHash !== rendered.sha256) {
            throw new Error('Downloaded PDF checksum does not match the financial document ledger.');
        }

        const safeName = document.document_number.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 100);
        return new Response(buffer, {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Length': String(buffer.length),
                'Content-Disposition': 'attachment; filename="' + safeName + '.pdf"',
                'Cache-Control': 'private, no-store, max-age=0',
                'X-Content-Type-Options': 'nosniff'
            }
        });
    } catch (error) {
        console.error('[-] Financial document download failed:', error?.message || error);
        return NextResponse.json({ success: false, message: 'Dokumen belum dapat diunduh.' }, { status: 500 });
    }
}
