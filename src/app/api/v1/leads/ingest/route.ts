import { requireApiKey } from '@/lib/auth/api-context';
import { fail, ok, toApiErrorResponse } from '@/lib/api/v1/respond';
import { IngestionValidationError, parseCanonicalLeadIntake } from '@/lib/leads/ingestion-contract';
import { LeadIngestionError, LeadIngestionService } from '@/lib/leads/ingestion';

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'leads:write');
    const body = await request.json().catch(() => null);
    const result = await new LeadIngestionService(ctx.supabase).ingest(ctx.accountId, parseCanonicalLeadIntake(body));
    return ok(result, result.duplicate ? 200 : 201);
  } catch (error) {
    if (error instanceof IngestionValidationError) return fail('bad_request', error.message, 400);
    if (error instanceof LeadIngestionError) return fail(error.code, error.message, error.code === 'registration_failed' ? 500 : 503);
    return toApiErrorResponse(error);
  }
}
