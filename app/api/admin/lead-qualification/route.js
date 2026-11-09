import { NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAdminSession } from '@/lib/security';

const ALLOWED_ROLES = ['Super Admin', 'Admin Konsultan'];
const CATEGORIES = ['PROSPEK', 'DINGIN', 'BIMBANG'];
const OPERATIONAL = ['NORMAL', 'MASIH_BERTANYA'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function maskPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length < 8 ? '***' : `${digits.slice(0, 4)}${'*'.repeat(Math.max(2, digits.length - 7))}${digits.slice(-3)}`;
}

async function authorize(req) {
  const auth = await requireAdminSession(req);
  if (!auth.authorized) return { ok: false, response: auth.response };
  if (!ALLOWED_ROLES.includes(auth.admin.role)) {
    return { ok: false, response: NextResponse.json({ success: false, message: 'Akses klasifikasi lead ditolak.' }, { status: 403 }) };
  }
  return { ok: true, admin: auth.admin };
}

export async function GET(req) {
  const auth = await authorize(req);
  if (!auth.ok) return auth.response;
  try {
    const supabase = getSupabaseAdmin();
    const { data: qualifications, error } = await supabase
      .from('kdj_lead_qualifications')
      .select('id, phone_local, recommendation_category, recommendation_operational_status, recommendation_rationale, recommended_at, qualification_status, confirmed_category, confirmed_operational_status, confirmed_by, confirmed_at, decision_reason, updated_at')
      .order('updated_at', { ascending: false }).limit(300);
    if (error) throw error;
    const phones = (qualifications || []).map((q) => q.phone_local);
    const [profilesResult, eventsResult] = await Promise.all([
      phones.length ? supabase.from('kdj_followup_profiles')
        .select('phone_local, consent_granted, opted_out_at, last_inbound_at, sequence_id, sequence_status, stop_reason')
        .in('phone_local', phones) : Promise.resolve({ data: [], error: null }),
      supabase.from('kdj_lead_qualification_events')
        .select('id, qualification_id, phone_local, actor_type, actor_admin_id, action, category, operational_status, rationale, created_at')
        .order('created_at', { ascending: false }).limit(100)
    ]);
    if (profilesResult.error) throw profilesResult.error;
    if (eventsResult.error) throw eventsResult.error;
    const profileMap = new Map((profilesResult.data || []).map((p) => [p.phone_local, p]));
    return NextResponse.json({
      success: true,
      qualifications: (qualifications || []).map((q) => {
        const p = profileMap.get(q.phone_local) || {};
        return {
          ...q,
          phone_masked: maskPhone(q.phone_local),
          phone_local: undefined,
          consent_granted: p.consent_granted === true && !p.opted_out_at,
          opted_out: Boolean(p.opted_out_at),
          last_inbound_at: p.last_inbound_at || null,
          sequence_id: p.sequence_id || null,
          sequence_status: p.sequence_status || null,
          sequence_stop_reason: p.stop_reason || null
        };
      }),
      events: (eventsResult.data || []).map((event) => ({ ...event, phone_masked: maskPhone(event.phone_local), phone_local: undefined }))
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[-] /api/admin/lead-qualification GET:', error?.message || error);
    return NextResponse.json({ success: false, message: 'Gagal memuat klasifikasi lead. Pastikan migration qualification sudah diterapkan.' }, { status: 503 });
  }
}

export async function POST(req) {
  const auth = await authorize(req);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => null);
  const qualificationId = String(body?.qualification_id || '');
  const category = String(body?.category || '').toUpperCase();
  const operationalStatus = String(body?.operational_status || 'NORMAL').toUpperCase();
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  const expectedSequenceId = body?.expected_sequence_id == null ? null : String(body.expected_sequence_id);
  if (expectedSequenceId !== null && !UUID.test(expectedSequenceId)) return NextResponse.json({ success: false, message: 'Cycle lead tidak valid. Refresh daftar.' }, { status: 400 });
  if (!UUID.test(qualificationId)) return NextResponse.json({ success: false, message: 'ID klasifikasi tidak valid.' }, { status: 400 });
  if (!CATEGORIES.includes(category) || !OPERATIONAL.includes(operationalStatus)) return NextResponse.json({ success: false, message: 'Kategori/status operasional tidak valid.' }, { status: 422 });
  if (reason.length < 5 || reason.length > 500) return NextResponse.json({ success: false, message: 'Alasan keputusan wajib 5–500 karakter.' }, { status: 422 });
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc('kdj_admin_set_lead_qualification', {
      p_qualification_id: qualificationId,
      p_actor_admin_id: auth.admin.id,
      p_expected_sequence_id: expectedSequenceId,
      p_category: category,
      p_operational_status: operationalStatus,
      p_reason: reason
    });
    if (error) {
      if (error.message?.includes('LEAD_QUALIFICATION_STALE_INBOUND')) return NextResponse.json({ success: false, message: 'Cycle lead berubah sejak data dibuka. Refresh daftar sebelum menyimpan keputusan.' }, { status: 409 });
      if (error.code === 'P0002' || error.message?.includes('LEAD_QUALIFICATION_NOT_FOUND')) return NextResponse.json({ success: false, message: 'Lead tidak ditemukan.' }, { status: 404 });
      if (error.code === '42501') return NextResponse.json({ success: false, message: 'Role Admin tidak berwenang.' }, { status: 403 });
      throw error;
    }
    return NextResponse.json({ success: true, result: data, message: 'Klasifikasi lead tersimpan. Eligibility FU akan dievaluasi oleh scheduler.' });
  } catch (error) {
    console.error('[-] /api/admin/lead-qualification POST:', error?.message || error);
    return NextResponse.json({ success: false, message: 'Keputusan klasifikasi gagal disimpan.' }, { status: 503 });
  }
}
