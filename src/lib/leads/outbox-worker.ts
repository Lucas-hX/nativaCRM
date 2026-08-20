import type { SupabaseClient } from '@supabase/supabase-js';
import { dispatchWebhookEventDurable } from '@/lib/webhooks/deliver';
import { isWebhookEvent } from '@/lib/webhooks/events';

interface DomainEventRow {
  id: string; account_id: string; event_type: string; payload: Record<string, unknown>;
  attempt_count: number; created_at: string;
}
export interface OutboxRunResult { claimed: number; published: number; failed: number }

export async function runOutboxBatch(db: SupabaseClient, limit = 20): Promise<OutboxRunResult> {
  const { data, error } = await db.rpc('claim_domain_events', { p_limit: limit, p_lease_seconds: 60 });
  if (error) throw new Error(`Could not claim domain events (${error.code ?? 'unknown'})`);
  const rows = (data ?? []) as DomainEventRow[];
  let published = 0; let failed = 0;
  for (const event of rows) {
    try {
      if (!isWebhookEvent(event.event_type)) throw new Error('unsupported_event_type');
      const outcome = await dispatchWebhookEventDurable(db, event.account_id, event.event_type, event.payload, { id: event.id, occurredAt: event.created_at });
      if (outcome.failed > 0) throw new Error('webhook_delivery_failed');
      const { error: completeError } = await db.rpc('complete_domain_event', { p_event_id: event.id });
      if (completeError) throw new Error('completion_failed');
      published += 1;
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : 'delivery_failed';
      const backoff = Math.min(3600, 30 * 2 ** Math.min(event.attempt_count - 1, 7));
      await db.rpc('fail_domain_event', { p_event_id: event.id, p_error_code: code, p_backoff_seconds: backoff });
      failed += 1;
    }
  }
  return { claimed: rows.length, published, failed };
}
