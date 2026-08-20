import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/account";
import { parseLeadSettings } from "@/lib/leads/contracts";
import { leadErrorResponse, leadService, readJson } from "@/lib/leads/http";

export async function GET() {
  try {
    const ctx = await requireRole("viewer");
    return NextResponse.json({ data: await leadService(ctx).getSettings(ctx.accountId) });
  } catch (error) { return leadErrorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole("admin");
    return NextResponse.json({ data: await leadService(ctx).updateSettings(ctx.accountId, parseLeadSettings(await readJson(request))) });
  } catch (error) { return leadErrorResponse(error); }
}
