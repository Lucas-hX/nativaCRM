import { NextResponse, type NextRequest } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

const STATUSES = new Set(['pending', 'processing', 'published', 'failed']);
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireRole('admin');
    const status = request.nextUrl.searchParams.get('status');
    const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get('limit') ?? 50) || 50));
    let query = ctx.supabase.from('domain_events').select('id, event_type, aggregate_type, aggregate_id, payload, status, attempt_count, available_at, published_at, last_error_code, created_at, updated_at', { count: 'exact' }).eq('account_id', ctx.accountId);
    if (status && STATUSES.has(status)) query = query.eq('status', status);
    const { data, error, count } = await query.order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return NextResponse.json({ data: data ?? [], meta: { total: count ?? 0 } });
  } catch (error) { return toErrorResponse(error); }
}
