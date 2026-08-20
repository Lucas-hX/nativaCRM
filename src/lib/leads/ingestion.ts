import type { SupabaseClient } from '@supabase/supabase-js';
import type { CanonicalLeadIntake } from './ingestion-contract';
import { redactedIntakePayload } from './ingestion-contract';
import { encrypt } from '@/lib/whatsapp/encryption';

export interface LeadIngestionResult { event_id: string; lead_id: string; contact_id: string; duplicate: boolean; contact_created: boolean }
export class LeadIngestionError extends Error {
  constructor(readonly code: 'registration_failed' | 'processing_failed', message: string) { super(message); this.name = 'LeadIngestionError'; }
}

export class LeadIngestionService {
  constructor(private readonly db: SupabaseClient) {}

  async ingest(accountId: string, input: CanonicalLeadIntake): Promise<LeadIngestionResult> {
    const { data: event, error: registerError } = await this.db.rpc('register_inbound_lead_event', {
      p_account_id: accountId, p_provider: input.provider, p_external_event_id: input.eventId,
      p_payload_redacted: redactedIntakePayload(input),
      p_payload_ciphertext: encrypt(JSON.stringify(input)),
    });
    if (registerError || !event?.id) {
      console.error('[lead-ingestion] registration failed', { code: registerError?.code });
      throw new LeadIngestionError('registration_failed', 'Could not register inbound event');
    }
    const { data, error } = await this.db.rpc('process_inbound_lead_event', {
      p_account_id: accountId, p_event_id: event.id,
      p_contact: input.contact,
      p_opportunity: {
        source: input.opportunity.source, external_id: input.opportunity.externalId,
        received_at: input.opportunity.receivedAt, next_follow_up_at: input.opportunity.nextFollowUpAt,
        assigned_to_user_id: input.opportunity.assignedToUserId, campaign_id: input.opportunity.campaignId,
        campaign_name: input.opportunity.campaignName, form_id: input.opportunity.formId,
        form_name: input.opportunity.formName, company: input.opportunity.company,
        plan: input.opportunity.plan, priority: input.opportunity.priority,
      },
    });
    if (error || !data) {
      console.error('[lead-ingestion] processing failed', { eventId: event.id, code: error?.code });
      await this.db.rpc('fail_inbound_lead_event', {
        p_account_id: accountId, p_event_id: event.id,
        p_error_code: error?.code ?? 'processing_error', p_error_message: 'Lead ingestion failed',
      });
      throw new LeadIngestionError('processing_failed', 'Inbound event was saved but could not be processed');
    }
    return data as LeadIngestionResult;
  }
}
