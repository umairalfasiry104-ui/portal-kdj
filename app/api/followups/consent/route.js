import { NextResponse } from 'next/server';
import {
  getSupabaseAdmin,
  getUserSession,
  normalizePhoneLocal
} from '@/lib/security';



const CONSENT_TEXT_VERSION = 'KDJ-WA-FU-1.0';
const CONSENT_TEXT = 'Saya bersedia menerima pesan tindak lanjut terkait pertanyaan, konsultasi, atau proses pendaftaran KDJ melalui WhatsApp. Saya dapat menarik persetujuan kapan saja.';

export async function GET(req) {
  const session = await getUserSession(req);
  if (!session) return NextResponse.json({ success: false, message: 'Sesi pengguna tidak valid.' }, { status: 401 });

  const phoneLocal = normalizePhoneLocal(session.no_wa);
  if (!phoneLocal) return NextResponse.json({ success: false, message: 'Nomor WhatsApp sesi tidak valid.' }, { status: 403 });

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('kdj_followup_profiles')
      .select('consent_granted, consented_at, opted_out_at, consent_text_version')
      .eq('phone_local', phoneLocal)
      .maybeSingle();
    if (error) throw error;

    return NextResponse.json({
      success: true,
      consented: Boolean(data?.consent_granted && !data?.opted_out_at),
      consented_at: data?.consented_at || null,
      text_version: data?.consent_text_version || null
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[-] /api/followups/consent GET:', error?.message || error);
    return NextResponse.json({ success: false, message: 'Status persetujuan belum dapat dibaca.' }, { status: 503 });
  }
}

export async function POST(req) {
  const session = await getUserSession(req);
  if (!session) return NextResponse.json({ success: false, message: 'Sesi pengguna tidak valid.' }, { status: 401 });

  const phoneLocal = normalizePhoneLocal(session.no_wa);
  if (!phoneLocal) return NextResponse.json({ success: false, message: 'Nomor WhatsApp sesi tidak valid.' }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.consented !== 'boolean') {
    return NextResponse.json({ success: false, message: 'Nilai persetujuan harus berupa boolean.' }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc('kdj_set_followup_consent', {
      p_phone_local: phoneLocal,
      p_consented: body.consented,
      p_source: 'PORTAL',
      p_text_version: CONSENT_TEXT_VERSION,
      p_consent_text: CONSENT_TEXT,
      p_evidence: {
        channel: 'PORTAL',
        user_id: session.sub,
        captured_at: new Date().toISOString()
      }
    });
    if (error) throw error;

    return NextResponse.json({
      success: true,
      consented: body.consented,
      result: data,
      message: body.consented
        ? 'Persetujuan pesan tindak lanjut berhasil dicatat.'
        : 'Persetujuan pesan tindak lanjut telah ditarik.'
    });
  } catch (error) {
    console.error('[-] /api/followups/consent POST:', error?.message || error);
    return NextResponse.json({ success: false, message: 'Persetujuan belum dapat disimpan.' }, { status: 503 });
  }
}
