import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { parseCreateIntegration } from '@/lib/integrations/contracts';
import { createIntegration, listIntegrations } from '@/lib/integrations/service';

export async function GET() {
  try {
    const ctx = await requireRole('admin');
    return NextResponse.json({ data: await listIntegrations(ctx) });
  } catch (error) { return toErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    let body: unknown;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    try { return NextResponse.json({ data: await createIntegration(ctx, parseCreateIntegration(body)) }, { status: 201 }); }
    catch (error) {
      if (error instanceof Error && /Unsupported|must|too long|dedicated|Secret-like/.test(error.message)) return NextResponse.json({ error: error.message }, { status: 400 });
      throw error;
    }
  } catch (error) { return toErrorResponse(error); }
}
