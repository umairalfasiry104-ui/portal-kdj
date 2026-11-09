import { NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAdminSession } from '@/lib/security';



function maskPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length < 8) return '***';
  return `${digits.slice(0, 4)}${'*'.repeat(Math.max(2, digits.length - 7))}${digits.slice(-3)}`;
}

export async function GET(req) {
  const auth = await requireAdminSession(req);
  if (!auth.authorized) return auth.response;
  if (auth.admin.role !== 'Super Admin') {
    return NextResponse.json({ success: false, message: 'Data FU hanya dapat diakses Super Admin.' }, { status: 403 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const [gateResult, jobsResult, profilesResult, qualificationResult] = await Promise.all([
      supabase.from('kdj_followup_delivery_gate')
        .select('delivery_enabled, compliance_status, approved_channel, approved_at, review_reference')
        .eq('id', 1).maybeSingle(),
      supabase.from('kdj_followup_jobs')
        .select('id, phone_local, step, due_at, status, held_reason, attempt_count, stop_reason, created_at')
        .order('due_at', { ascending: true }).limit(150),
      supabase.from('kdj_followup_profiles')
        .select('profile_id, phone_local, consent_granted, opted_out_at, last_inbound_at, sequence_status, stop_reason, admin_stopped_at, admin_stop_reason')
        .order('updated_at', { ascending: false }).limit(500),
      supabase.from('kdj_lead_qualifications')
        .select('phone_local, recommendation_category, recommendation_operational_status, qualification_status, confirmed_category, confirmed_operational_status')
        .limit(500)
    ]);

    if (gateResult.error) throw gateResult.error;
    if (jobsResult.error) throw jobsResult.error;
    if (profilesResult.error) throw profilesResult.error;
    if (qualificationResult.error) throw qualificationResult.error;

    const jobs = jobsResult.data || [];
    const profiles = profilesResult.data || [];
    const qualificationByPhone = new Map((qualificationResult.data || []).map((row) => [row.phone_local, row]));
    const counts = Object.fromEntries(
      ['HELD_COMPLIANCE', 'SCHEDULED', 'PROCESSING', 'SENT', 'FAILED', 'UNKNOWN', 'CANCELLED']
        .map((status) => [status, jobs.filter((job) => job.status === status).length])
    );

    return NextResponse.json({
      success: true,
      gate: gateResult.data || { delivery_enabled: false, compliance_status: 'BLOCKED' },
      summary: {
        profiles: profiles.length,
        consented: profiles.filter((profile) => profile.consent_granted && !profile.opted_out_at).length,
        opted_out: profiles.filter((profile) => Boolean(profile.opted_out_at)).length,
        jobs: jobs.length,
        jobs_by_status: counts
      },
      jobs: jobs.map((job) => ({
        ...job,
        phone_masked: maskPhone(job.phone_local),
        phone_local: undefined
      })),
      profiles: profiles.slice(0, 100).map((profile) => ({
        profile_id: profile.profile_id,
        phone_masked: maskPhone(profile.phone_local),
        consent_granted: profile.consent_granted,
        opted_out: Boolean(profile.opted_out_at),
        last_inbound_at: profile.last_inbound_at,
        sequence_status: profile.sequence_status,
        stop_reason: profile.stop_reason,
        admin_stopped_at: profile.admin_stopped_at,
        admin_stop_reason: profile.admin_stop_reason,
        qualification: (() => { const q = qualificationByPhone.get(profile.phone_local); return q ? { recommendation_category: q.recommendation_category, recommendation_operational_status: q.recommendation_operational_status, qualification_status: q.qualification_status, confirmed_category: q.confirmed_category, confirmed_operational_status: q.confirmed_operational_status } : null; })()
      })),
      dispatch_enabled: false,
      note: 'Semua job FU tetap tertahan. Pengiriman otomatis dilarang sampai consent, channel-policy, dan kelayakan teknologi pengiriman disetujui melalui release gate.'
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[-] /api/admin/followups GET:', error?.message || error);
    return NextResponse.json({ success: false, message: 'Gagal memuat Follow Up. Pastikan migration FU sudah diterapkan.' }, { status: 503 });
  }
}


export async function POST(req) {
  const auth = await requireAdminSession(req);
  if (!auth.authorized) return auth.response;
  if (auth.admin.role !== 'Super Admin') {
    return NextResponse.json({ success: false, message: 'Kontrol FU hanya dapat dilakukan Super Admin.' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const profileId = String(body?.profile_id || '');
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(profileId)) {
    return NextResponse.json({ success: false, message: 'ID profil FU tidak valid.' }, { status: 400 });
  }
  if (reason.length < 5 || reason.length > 1000) {
    return NextResponse.json({ success: false, message: 'Alasan penghentian wajib 5–1000 karakter.' }, { status: 422 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc('kdj_admin_stop_followup', {
      p_profile_id: profileId,
      p_actor_admin_id: auth.admin.id,
      p_reason: reason
    });
    if (error) {
      if (error.code === 'P0002' || error.message?.includes('FOLLOWUP_PROFILE_NOT_FOUND')) {
        return NextResponse.json({ success: false, message: 'Profil FU tidak ditemukan.' }, { status: 404 });
      }
      throw error;
    }
    return NextResponse.json({ success: true, result: data, message: 'Sequence FU berhasil dihentikan oleh Super Admin.' });
  } catch (error) {
    console.error('[-] /api/admin/followups POST:', error?.message || error);
    return NextResponse.json({ success: false, message: 'Penghentian FU gagal disimpan.' }, { status: 503 });
  }
}
