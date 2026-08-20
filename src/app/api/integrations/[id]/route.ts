import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { parseIntegrationSettings } from '@/lib/integrations/contracts';
import { updateIntegration } from '@/lib/integrations/service';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin');
    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Invalid integration id' }, { status: 400 });
    let body: unknown;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    try {
      const data = await updateIntegration(ctx, id, parseIntegrationSettings(body));
      return data ? NextResponse.json({ data }) : NextResponse.json({ error: 'Integration not found' }, { status: 404 });
    } catch (error) {
      if (error instanceof Error && /must|required|Secret-like/.test(error.message)) return NextResponse.json({ error: error.message }, { status: 400 });
      throw error;
    }
  } catch (error) { return toErrorResponse(error); }
}
