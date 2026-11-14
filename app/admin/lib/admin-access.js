/**
 * Aturan akses tab Dashboard Admin berbasis peran.
 * Dipisahkan dari komponen agar dapat diuji dan dipakai ulang.
 */

export function canAccessPendaftarTab(role) {
    return ['Super Admin', 'Admin Verifikator', 'Admin Viewer'].includes(role);
}

export function canAccessJadwalTab(role) {
    return ['Super Admin', 'Admin Konsultan', 'Admin Viewer'].includes(role);
}

export function canAccessAdminsTab(role) {
    return role === 'Super Admin';
}

export function canAccessLeadQualificationTab(role) {
    return ['Super Admin', 'Admin Konsultan', 'Admin Viewer'].includes(role);
}

/**
 * Peran yang boleh melihat modul cicilan paket keberangkatan.
 */
export function canViewDeparturePayments(role) {
    return ['Super Admin', 'Admin Verifikator', 'Admin Viewer'].includes(role);
}

/**
 * Peran yang boleh memutuskan (approve/reject) cicilan keberangkatan.
 */
export function canReviewDeparturePayments(role) {
    return ['Super Admin', 'Admin Verifikator'].includes(role);
}

export function getDefaultTabForRole(role) {
    if (canAccessPendaftarTab(role)) return 'pendaftar';
    if (canAccessJadwalTab(role)) return 'jadwal';
    return 'pendaftar';
}
