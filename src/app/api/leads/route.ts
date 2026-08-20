import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/account";
import { parseCreateLead, parseLeadListFilters } from "@/lib/leads/contracts";
import { leadErrorResponse, leadService, readJson } from "@/lib/leads/http";

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireRole("viewer");
    return NextResponse.json(await leadService(ctx).list(ctx.accountId, parseLeadListFilters(request.nextUrl.searchParams)));
  } catch (error) { return leadErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const lead = await leadService(ctx).create(ctx.accountId, parseCreateLead(await readJson(request)));
    return NextResponse.json({ data: lead }, { status: 201 });
  } catch (error) { return leadErrorResponse(error); }
}
