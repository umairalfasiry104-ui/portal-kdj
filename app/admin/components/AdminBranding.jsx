import Link from 'next/link';

/**
 * Logo header memanjang untuk Dashboard Admin.
 */
export function KDJLogoHeader() {
    return (
        <Link href="/" className="bg-white px-4 h-14 sm:h-16 w-52 sm:w-64 rounded-xl shadow-md flex items-center justify-center overflow-hidden border-2 border-amber-400/80">
            <img
                src="/logo-kdj-panjang.png"
                alt="Kuliah di Jordan"
                className="w-full h-auto object-cover scale-125"
            />
        </Link>
    );
}

/**
 * Logo kotak untuk kartu login Admin.
 */
export function KDJLogoSquare({ size = 'md' }) {
    const dim = size === 'lg' ? 'w-24 h-24' : 'w-14 h-14';
    return (
        <div className={`${dim} rounded-2xl bg-white p-1.5 shadow-md border-2 border-slate-100 flex items-center justify-center overflow-hidden`}>
            <img
                src="/logo-kdj-square.png"
                alt="Logo KDJ"
                className="w-full h-full object-contain scale-105"
            />
        </div>
    );
}
