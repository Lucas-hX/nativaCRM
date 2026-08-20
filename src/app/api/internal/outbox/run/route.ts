import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { runOutboxBatch } from '@/lib/leads/outbox-worker';

function authorized(request: Request) {
  const expected = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const presented = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const a = Buffer.from(expected); const b = Buffer.from(presented);
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json({ data: await runOutboxBatch(supabaseAdmin()) });
  } catch (error) {
    console.error('[outbox-run] batch failed', error);
    return NextResponse.json({ error: 'Worker batch failed' }, { status: 500 });
  }
}
