import { NextResponse, type NextRequest } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

const STATUSES = new Set(['received', 'processing', 'processed', 'failed']);
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireRole('admin');
    const status = request.nextUrl.searchParams.get('status');
    const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get('limit') ?? 50) || 50));
    let query = ctx.supabase.from('inbound_events').select('id, provider, external_event_id, status, payload_redacted, attempt_count, last_error_code, last_error_message, lead_id, received_at, processed_at, updated_at', { count: 'exact' }).eq('account_id', ctx.accountId);
    if (status && STATUSES.has(status)) query = query.eq('status', status);
    const { data, error, count } = await query.order('received_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return NextResponse.json({ data: data ?? [], meta: { total: count ?? 0 } });
  } catch (error) { return toErrorResponse(error); }
}
