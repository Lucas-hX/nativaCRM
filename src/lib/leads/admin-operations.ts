import { decrypt } from '@/lib/whatsapp/encryption';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import type { CanonicalLeadIntake } from './ingestion-contract';
import type { LeadIngestionResult } from './ingestion';

export class LeadOperationError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = 'LeadOperationError'; }
}

export async function retryInboundEvent(accountId: string, eventId: string): Promise<LeadIngestionResult> {
  const db = supabaseAdmin();
  const { data: event, error } = await db.from('inbound_events').select('id, status, payload_ciphertext').eq('account_id', accountId).eq('id', eventId).maybeSingle();
  if (error || !event) throw new LeadOperationError(404, 'Inbound event not found');
  if (event.status === 'processed') throw new LeadOperationError(409, 'Inbound event is already processed');
  if (!event.payload_ciphertext) throw new LeadOperationError(409, 'Inbound event has no replay payload');
  let input: CanonicalLeadIntake;
  try { input = JSON.parse(decrypt(event.payload_ciphertext)) as CanonicalLeadIntake; }
  catch { throw new LeadOperationError(409, 'Inbound event replay payload is unavailable'); }
  const { data, error: processError } = await db.rpc('process_inbound_lead_event', {
    p_account_id: accountId, p_event_id: eventId, p_contact: input.contact,
    p_opportunity: {
      source: input.opportunity.source, external_id: input.opportunity.externalId,
      received_at: input.opportunity.receivedAt, next_follow_up_at: input.opportunity.nextFollowUpAt,
      assigned_to_user_id: input.opportunity.assignedToUserId, campaign_id: input.opportunity.campaignId,
      campaign_name: input.opportunity.campaignName, form_id: input.opportunity.formId,
      form_name: input.opportunity.formName, company: input.opportunity.company,
      plan: input.opportunity.plan, priority: input.opportunity.priority,
    },
  });
  if (processError || !data) {
    await db.rpc('fail_inbound_lead_event', { p_account_id: accountId, p_event_id: eventId, p_error_code: processError?.code ?? 'retry_failed', p_error_message: 'Lead ingestion retry failed' });
    throw new LeadOperationError(503, 'Retry failed; the event remains available for inspection');
  }
  return data as LeadIngestionResult;
}
