import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/account";
import { parseRecordResult } from "@/lib/leads/contracts";
import { assertUuid, leadErrorResponse, leadService, readJson } from "@/lib/leads/http";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params; assertUuid(id);
    const ctx = await requireRole("agent");
    return NextResponse.json({ data: await leadService(ctx).recordResult(ctx.accountId, id, parseRecordResult(await readJson(request))) });
  } catch (error) { return leadErrorResponse(error); }
}
