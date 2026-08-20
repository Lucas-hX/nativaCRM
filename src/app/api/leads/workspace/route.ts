import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/account";
import { leadErrorResponse, leadService } from "@/lib/leads/http";

export async function GET() {
  try {
    const ctx = await requireRole("viewer");
    const settings = await leadService(ctx).getSettings(ctx.accountId) as { lead_config?: Record<string, unknown> };
    return NextResponse.json({ data: {
      user_id: ctx.userId,
      role: ctx.role,
      timezone: settings.lead_config?.timezone ?? "America/Argentina/Buenos_Aires",
      close_no_response_after: settings.lead_config?.close_no_response_after ?? 5,
    } });
  } catch (error) { return leadErrorResponse(error); }
}
