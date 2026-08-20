import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { LeadOperationError, retryInboundEvent } from '@/lib/leads/admin-operations';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin');
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Invalid event id' }, { status: 400 });
    return NextResponse.json({ data: await retryInboundEvent(ctx.accountId, id) });
  } catch (error) {
    if (error instanceof LeadOperationError) return NextResponse.json({ error: error.message }, { status: error.status });
    return toErrorResponse(error);
  }
}
