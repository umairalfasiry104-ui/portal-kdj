import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET() {
    try {
        const { data, error } = await supabase
            .from('jadwal_konsultasi')
            .select('*')
            .order('jadwal_pilihan', { ascending: false }); // Urutkan dari yang terbaru

        if (error) throw error;
        return NextResponse.json({ success: true, data });
    } catch (error) {
        return NextResponse.json({ success: false, message: error.message }, { status: 500 });
    }
}

export async function POST(req) {
    try {
        const { id, status } = await req.json();
        
        const { error } = await supabase
            .from('jadwal_konsultasi')
            .update({ status })
            .eq('id', id);

        if (error) throw error;
        return NextResponse.json({ success: true, message: 'Status jadwal berhasil diperbarui' });
    } catch (error) {
        return NextResponse.json({ success: false, message: error.message }, { status: 500 });
    }
}