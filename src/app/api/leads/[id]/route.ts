import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/account";
import { assertUuid, leadErrorResponse, leadService } from "@/lib/leads/http";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params; assertUuid(id);
    const ctx = await requireRole("viewer");
    return NextResponse.json({ data: await leadService(ctx).get(ctx.accountId, id) });
  } catch (error) { return leadErrorResponse(error); }
}
