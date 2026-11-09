import { NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAdminSession } from '@/lib/security';



function jsonError(message, status = 500) {
  return NextResponse.json({ success: false, message }, { status });
}

function heartbeatStatus(row, nowMs) {
  if (!row) return { status: 'UNKNOWN', age_seconds: null, stale: true };
  const age = Math.max(0, Math.floor((nowMs - new Date(row.observed_at).getTime()) / 1000));
  const staleAfter = row.component === 'portal' ? 300 : 180;
  const stale = !Number.isFinite(age) || age > staleAfter;
  return {
    status: stale ? 'DOWN' : row.status,
    age_seconds: Number.isFinite(age) ? age : null,
    stale
  };
}

async function requireOwner(req) {
  const auth = await requireAdminSession(req);
  if (!auth.authorized) return { ok: false, response: auth.response };
  if (auth.admin.role !== 'Super Admin') {
    return {
      ok: false,
      response: NextResponse.json({
        success: false,
        code: 'FORBIDDEN_OWNER_CONTROL',
        message: 'Monitoring sistem hanya dapat diakses oleh Super Admin.'
      }, { status: 403 })
    };
  }
  return { ok: true, admin: auth.admin };
}

export async function GET(req) {
  const startedAt = Date.now();
  const owner = await requireOwner(req);
  if (!owner.ok) return owner.response;

  try {
    const supabase = getSupabaseAdmin();
    const generatedAt = new Date();
    const instanceId = String(process.env.KDJ_PORTAL_INSTANCE_ID || process.env.VERCEL_REGION || 'portal-web').slice(0, 120);
    const selfHeartbeat = await supabase.rpc('kdj_record_system_heartbeat', {
      p_component: 'portal',
      p_instance_id: instanceId,
      p_status: 'OK',
      p_latency_ms: Date.now() - startedAt,
      p_details: { runtime: 'nextjs', checked_by: 'admin_monitoring' }
    });
    if (selfHeartbeat.error) throw selfHeartbeat.error;
    const databaseHeartbeat = await supabase.rpc('kdj_record_system_heartbeat', {
      p_component: 'supabase',
      p_instance_id: instanceId,
      p_status: 'OK',
      p_latency_ms: Date.now() - startedAt,
      p_details: { checked_by: 'portal_monitoring_rpc' }
    });
    if (databaseHeartbeat.error) throw databaseHeartbeat.error;
    const [heartbeatResult, incidentResult, controlResult] = await Promise.all([
      supabase.from('kdj_system_heartbeats')
        .select('component, instance_id, status, observed_at, latency_ms, details')
        .order('component', { ascending: true }),
      supabase.from('kdj_system_incidents')
        .select('id, fingerprint, severity, module, title, evidence, status, owner_admin_id, occurrence_count, first_seen_at, last_seen_at, acknowledged_at, resolved_at, resolution_notes')
        .order('last_seen_at', { ascending: false })
        .limit(50),
      supabase.from('kdj_system_controls')
        .select('global_safe_mode, paused_modules, updated_at')
        .eq('id', 1)
        .maybeSingle()
    ]);

    if (heartbeatResult.error) throw heartbeatResult.error;
    if (incidentResult.error) throw incidentResult.error;
    if (controlResult.error) throw controlResult.error;

    const nowMs = Date.now();
    const heartbeatRows = heartbeatResult.data || [];
    const preferred = new Map();
    for (const row of heartbeatRows) {
      const current = preferred.get(row.component);
      if (!current || new Date(row.observed_at).getTime() > new Date(current.observed_at).getTime()) {
        preferred.set(row.component, row);
      }
    }

    const componentNames = ['portal', 'bot_process', 'whatsapp', 'gemini', 'supabase', 'external_watchdog'];
    const components = componentNames.map((component) => {
      const row = preferred.get(component) || null;
      const age = heartbeatStatus(row, nowMs);
      const componentStatus = component === 'external_watchdog' && !row
        ? 'NOT_CONFIGURED'
        : component === 'gemini' && age.stale
          ? 'UNKNOWN'
          : age.status;

      return {
        component,
        instance_id: row?.instance_id || null,
        status: componentStatus,
        observed_at: row?.observed_at || null,
        age_seconds: age.age_seconds,
        latency_ms: row?.latency_ms ?? null,
        details: row?.details || {},
        stale: age.stale
      };
    });

    // Open/update durable incidents for monitored components with stale or DOWN heartbeats.
    for (const component of components) {
      if (!['portal', 'bot_process', 'whatsapp', 'supabase'].includes(component.component)) continue;
      if (component.status !== 'DOWN') continue;

      const severity = component.component === 'supabase' ? 'P0' : 'P1';
      const { error: incidentError } = await supabase.rpc('kdj_open_system_incident', {
        p_fingerprint: `HEARTBEAT:${component.component}`,
        p_severity: severity,
        p_module: component.component,
        p_title: `${component.component} heartbeat DOWN / stale`,
        p_evidence: {
          component: component.component,
          observed_at: component.observed_at,
          age_seconds: component.age_seconds,
          last_status: preferred.get(component.component)?.status || 'NO_HEARTBEAT'
        },
        p_correlation_id: null,
        p_affected_entity: component.instance_id
      });
      if (incidentError) throw incidentError;
    }

    return NextResponse.json({
      success: true,
      generated_at: generatedAt.toISOString(),
      monitoring_level: 'PARTIAL',
      components,
      incidents: incidentResult.data || [],
      controls: controlResult.data || { global_safe_mode: false, paused_modules: [] },
      limitations: [
        'External watchdog dan kanal alert independen belum dikonfigurasi.',
        'Gemini adalah komponen berbasis permintaan; status UNKNOWN berarti belum ada panggilan model baru-baru ini, bukan bukti layanan DOWN.',
        'CPU/memory dan queue depth memerlukan agent/worker telemetry tambahan.'
      ]
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[-] /api/admin/system GET:', error?.message || error);
    return jsonError('Gagal memuat monitoring sistem. Pastikan migration monitoring sudah diterapkan.', 503);
  }
}

export async function POST(req) {
  const owner = await requireOwner(req);
  if (!owner.ok) return owner.response;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return jsonError('Payload incident tidak valid.', 400);
  }

  const action = String(body.action || '').toUpperCase();
  const incidentId = String(body.incident_id || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(incidentId)) {
    return jsonError('ID incident tidak valid.', 400);
  }

  if (!['ACKNOWLEDGE', 'RESOLVE'].includes(action)) {
    return jsonError('Aksi incident tidak dikenal.', 400);
  }

  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  if (action === 'RESOLVE' && (notes.length < 5 || notes.length > 2000)) {
    return jsonError('Catatan penyelesaian wajib 5–2000 karakter.', 422);
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc('kdj_update_system_incident', {
      p_incident_id: incidentId,
      p_action: action,
      p_actor_admin_id: owner.admin.id,
      p_notes: action === 'RESOLVE' ? notes : null
    });

    if (error) {
      if (error.code === 'P0002' || error.message?.includes('INCIDENT_NOT_OPEN')) {
        return jsonError('Incident tidak ditemukan atau sudah ditutup.', 409);
      }
      if (error.message?.includes('INCIDENT_ALREADY_ACKNOWLEDGED')) {
        return jsonError('Incident sudah di-acknowledge.', 409);
      }
      throw error;
    }

    return NextResponse.json({ success: true, incident: data });
  } catch (error) {
    console.error('[-] /api/admin/system POST:', error?.message || error);
    return jsonError('Gagal memperbarui incident.', 500);
  }
}
