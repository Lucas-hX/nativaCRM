import { NextResponse } from "next/server";
import type { AccountContext } from "@/lib/auth/account";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth/account";
import { LeadDomainError } from "./errors";
import { SupabaseLeadRepository } from "./repository";
import { LeadService } from "./service";

export function leadService(ctx: AccountContext) {
  return new LeadService(new SupabaseLeadRepository(ctx.supabase));
}

export async function readJson(request: Request): Promise<unknown> {
  try { return await request.json(); }
  catch { throw new LeadDomainError("VALIDATION_ERROR", "Request body must contain valid JSON"); }
}

export function leadErrorResponse(error: unknown) {
  if (error instanceof UnauthorizedError || error instanceof ForbiddenError) return NextResponse.json({ error: { code: error.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN", message: error.message } }, { status: error.status });
  if (error instanceof LeadDomainError) {
    const status = { VALIDATION_ERROR: 400, NOT_FOUND: 404, CONFLICT: 409, FORBIDDEN: 403, DATA_ACCESS_ERROR: 500 }[error.code];
    return NextResponse.json({ error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } }, { status });
  }
  console.error("[leads:http] unexpected error", error);
  return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } }, { status: 500 });
}

export function assertUuid(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new LeadDomainError("VALIDATION_ERROR", "Lead id must be a valid UUID", { id: "invalid_uuid" });
}
