import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/account";
import { leadErrorResponse, leadService } from "@/lib/leads/http";

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireRole("viewer");
    const includeInactive = request.nextUrl.searchParams.get("include_inactive") === "true" && (ctx.role === "admin" || ctx.role === "owner");
    return NextResponse.json({ data: await leadService(ctx).listDiscardReasons(ctx.accountId, includeInactive) });
  } catch (error) { return leadErrorResponse(error); }
}
