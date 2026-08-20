import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/account";
import { parseAssignment } from "@/lib/leads/contracts";
import { assertUuid, leadErrorResponse, leadService, readJson } from "@/lib/leads/http";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params; assertUuid(id);
    const ctx = await requireRole("admin");
    return NextResponse.json({ data: await leadService(ctx).recordResult(ctx.accountId, id, parseAssignment(await readJson(request))) });
  } catch (error) { return leadErrorResponse(error); }
}
