import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { parseSecrets } from '@/lib/integrations/contracts';
import { integrationDefinition } from '@/lib/integrations/catalog';
import { storeIntegrationSecrets } from '@/lib/integrations/service';

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin');
    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Invalid integration id' }, { status: 400 });
    const { data } = await ctx.supabase.from('integration_connections').select('provider').eq('account_id', ctx.accountId).eq('id', id).maybeSingle();
    if (!data || !integrationDefinition(data.provider)) return NextResponse.json({ error: 'Integration not found' }, { status: 404 });
    let body: unknown;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    try {
      const result = await storeIntegrationSecrets(ctx, id, parseSecrets(data.provider, body));
      return result ? NextResponse.json({ data: result }) : NextResponse.json({ error: 'Integration not found' }, { status: 404 });
    } catch (error) {
      if (error instanceof Error && /credential|required|accept/.test(error.message)) return NextResponse.json({ error: error.message }, { status: 400 });
      throw error;
    }
  } catch (error) { return toErrorResponse(error); }
}
