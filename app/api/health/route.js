import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/security';



export async function GET() {
  const startedAt = Date.now();
  const instanceId = process.env.KDJ_PORTAL_INSTANCE_ID || process.env.VERCEL_REGION || 'portal-web';

  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.rpc('kdj_record_system_heartbeat', {
      p_component: 'portal',
      p_instance_id: String(instanceId).slice(0, 120),
      p_status: 'OK',
      p_latency_ms: Date.now() - startedAt,
      p_details: { runtime: 'nextjs', node_env: process.env.NODE_ENV || 'unknown' }
    });

    if (error) throw error;

    return NextResponse.json({
      success: true,
      status: 'OK',
      component: 'portal',
      checked_at: new Date().toISOString(),
      latency_ms: Date.now() - startedAt
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({
      success: false,
      status: 'DOWN',
      component: 'portal',
      checked_at: new Date().toISOString(),
      latency_ms: Date.now() - startedAt,
      dependency: 'supabase',
      error_code: error?.code || 'HEALTH_CHECK_FAILED'
    }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
