import { NextResponse, connection } from 'next/server';
import { getSupabaseAdmin, getUserSession, requireAdminSession } from '@/lib/security';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req) {
    await connection();
    try {
        const supabase = getSupabaseAdmin();
        const adminAuth = await requireAdminSession(req);
        let pendaftarId = null;
        let isAdmin = false;

        if (adminAuth.authorized) {
            if (adminAuth.admin?.role !== 'Super Admin') {
                return NextResponse.json({ success: false, message: 'Akses dokumen keuangan hanya tersedia untuk Super Admin.' }, { status: 403 });
            }
            isAdmin = true;
            pendaftarId = new URL(req.url).searchParams.get('pendaftar_id');
        } else {
            const session = await getUserSession(req);
            if (!session?.sub) {
                return NextResponse.json({ success: false, message: 'Sesi tidak valid.' }, { status: 401 });
            }
            pendaftarId = session.sub;
        }

        if (!pendaftarId || !UUID_PATTERN.test(pendaftarId)) {
            return NextResponse.json({ success: false, message: 'ID pendaftar tidak valid.' }, { status: 400 });
        }

        const { data: documents, error } = await supabase
            .from('kdj_financial_documents')
            .select('id, document_type, document_number, amount_idr, currency, status, issued_at, due_at, paid_at, supersedes_document_id, rendered_at')
            .eq('pendaftar_id', pendaftarId)
            .order('issued_at', { ascending: false })
            .limit(100);

        if (error) throw error;

        const documentIds = (documents || []).map((item) => item.id);
        let deliveryRows = [];
        if (isAdmin && documentIds.length > 0) {
            const { data, error: deliveryError } = await supabase
                .from('kdj_financial_document_outbox')
                .select('id, document_id, status, attempts, provider_message_id, last_error_code, last_error_message, queued_at, sent_at, recipient_phone')
                .in('document_id', documentIds)
                .order('queued_at', { ascending: false });
            if (deliveryError) throw deliveryError;
            deliveryRows = data || [];
        }

        const deliveryByDocument = new Map();
        for (const row of deliveryRows) {
            const current = deliveryByDocument.get(row.document_id) || [];
            current.push({
                id: row.id,
                status: row.status,
                attempts: row.attempts,
                provider_message_id: row.provider_message_id,
                last_error_code: row.last_error_code,
                last_error_message: row.last_error_message,
                queued_at: row.queued_at,
                sent_at: row.sent_at,
                recipient_phone_masked: row.recipient_phone
                    ? row.recipient_phone.slice(0, 4) + '******' + row.recipient_phone.slice(-3)
                    : null
            });
            deliveryByDocument.set(row.document_id, current);
        }

        return NextResponse.json({
            success: true,
            documents: (documents || []).map((item) => ({
                ...item,
                delivery: deliveryByDocument.get(item.id) || []
            }))
        }, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error) {
        console.error('[-] GET /api/financial-documents failed:', error?.message || error);
        return NextResponse.json({ success: false, message: 'Gagal mengambil dokumen keuangan.' }, { status: 500 });
    }
}
