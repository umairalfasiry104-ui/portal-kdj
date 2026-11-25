import { NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAdminSession } from '@/lib/security';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req, context) {
    const auth = await requireAdminSession(req);
    if (!auth.authorized) return auth.response;
    if (auth.admin?.role !== 'Super Admin') {
        return NextResponse.json({ success: false, message: 'Akses hanya tersedia untuk Super Admin.' }, { status: 403 });
    }

    try {
        const { id: documentId } = await context.params;
        if (!UUID_PATTERN.test(String(documentId || ''))) {
            return NextResponse.json({ success: false, message: 'ID dokumen tidak valid.' }, { status: 400 });
        }

        const body = await req.json().catch(() => null);
        const action = typeof body?.action === 'string' ? body.action : '';
        const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 1000) : '';
        const outboxId = typeof body?.outbox_id === 'string' ? body.outbox_id : '';

        if (!UUID_PATTERN.test(outboxId) || reason.length < 3) {
            return NextResponse.json({ success: false, message: 'Data tindakan pengiriman tidak valid.' }, { status: 400 });
        }

        const supabase = getSupabaseAdmin();
        const { data: outbox, error: lookupError } = await supabase
            .from('kdj_financial_document_outbox')
            .select('id, document_id, status')
            .eq('id', outboxId)
            .eq('document_id', documentId)
            .maybeSingle();

        if (lookupError) throw lookupError;
        if (!outbox) return NextResponse.json({ success: false, message: 'Antrean dokumen tidak ditemukan.' }, { status: 404 });

        let rpcName;
        let params;
        if (action === 'RESEND') {
            rpcName = 'kdj_admin_resend_financial_document';
            params = {
                p_outbox_id: outbox.id,
                p_actor_admin_id: auth.admin.id,
                p_reason: reason
            };
        } else if (action === 'RECONCILE_SENT' || action === 'RECONCILE_NOT_SENT') {
            rpcName = 'kdj_admin_reconcile_financial_document_unknown';
            params = {
                p_outbox_id: outbox.id,
                p_resolution: action === 'RECONCILE_SENT' ? 'CONFIRMED_SENT' : 'CONFIRMED_NOT_SENT',
                p_provider_message_id: typeof body?.provider_message_id === 'string' ? body.provider_message_id.trim().slice(0, 255) : null,
                p_reason: reason,
                p_actor_admin_id: auth.admin.id
            };
        } else {
            return NextResponse.json({ success: false, message: 'Aksi tidak dikenal.' }, { status: 400 });
        }

        const { data, error } = await supabase.rpc(rpcName, params);
        if (error) {
            if (error.code === '42501') {
                return NextResponse.json({ success: false, message: 'Akses ditolak.' }, { status: 403 });
            }
            if (error.code === '22023' || error.code === '40001') {
                return NextResponse.json({ success: false, message: error.message }, { status: 409 });
            }
            throw error;
        }

        return NextResponse.json({ success: data?.success === true, result: data });
    } catch (error) {
        console.error('[-] Admin financial document delivery action failed:', error?.message || error);
        return NextResponse.json({ success: false, message: 'Gagal memproses tindakan pengiriman dokumen.' }, { status: 500 });
    }
}
