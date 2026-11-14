/**
 * Utilitas format tanggal/jam Dashboard Admin (zona waktu Asia/Jakarta).
 */

export function formatJakartaDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Waktu tidak valid';

    return new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        dateStyle: 'full',
        timeStyle: 'short',
        hourCycle: 'h23'
    }).format(date) + ' WIB';
}

export function getJakartaDateTimeParts(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return { date: '', time: '' };
    }

    const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Jakarta',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23'
        }).formatToParts(date).map((part) => [part.type, part.value])
    );

    return {
        date: `${parts.year}-${parts.month}-${parts.day}`,
        time: `${parts.hour}:${parts.minute}`
    };
}

export function normalizeScheduleMethodForForm(value) {
    const normalized = String(value || '').trim().toUpperCase();
    return normalized === 'ZOOM' ? 'Zoom' : 'Offline';
}
