const UNCLASSIFIED = {
  category: 'UNCLASSIFIED',
  operational_status: 'NORMAL',
  actor_type: null,
  actor_label: 'Belum ada keputusan',
  status_note: 'Menunggu rekomendasi Bot. Belum ada keputusan Admin yang berlaku.',
};

export function getQualificationSnapshot(row) {
  if (row?.qualification_status === 'CONFIRMED' && row?.confirmed_category) {
    return {
      category: row.confirmed_category,
      operational_status: row.confirmed_operational_status || 'NORMAL',
      actor_type: 'ADMIN',
      actor_label: 'Keputusan Admin',
      status_note: 'Status final saat ini ditetapkan oleh Admin.',
      status_at: row.confirmed_at || row.updated_at || null,
    };
  }

  if (row?.recommended_at) {
    return {
      category: row.recommendation_category || 'UNCLASSIFIED',
      operational_status: row.recommendation_operational_status || 'NORMAL',
      actor_type: 'BOT',
      actor_label: 'Rekomendasi Bot',
      status_note: 'Rekomendasi Bot belum menjadi keputusan final Admin.',
      status_at: row.recommended_at,
    };
  }

  return {
    ...UNCLASSIFIED,
    status_at: row?.updated_at || null,
  };
}

export function groupQualificationEvents(events = []) {
  const grouped = new Map();

  for (const event of events) {
    const qualificationId = event?.qualification_id;
    if (!qualificationId) continue;

    if (!grouped.has(qualificationId)) grouped.set(qualificationId, []);
    grouped.get(qualificationId).push(event);
  }

  for (const accountEvents of grouped.values()) {
    accountEvents.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  return grouped;
}
