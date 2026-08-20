import { beforeEach, describe, expect, it, vi } from 'vitest';
const dispatch = vi.hoisted(() => vi.fn());
vi.mock('@/lib/webhooks/deliver', () => ({ dispatchWebhookEventDurable: dispatch }));
import { runOutboxBatch } from './outbox-worker';

function client(events: unknown[]) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  return { calls, rpc: vi.fn((name: string, args: Record<string, unknown>) => {
    calls.push([name, args]);
    if (name === 'claim_domain_events') return Promise.resolve({ data: events, error: null });
    return Promise.resolve({ data: null, error: null });
  }) };
}
const event = { id: 'event-1', account_id: 'account-1', event_type: 'lead.created', payload: { lead_id: 'lead-1' }, attempt_count: 1, created_at: '2026-08-20T00:00:00Z' };

beforeEach(() => dispatch.mockReset());
describe('runOutboxBatch', () => {
  it('claims and completes a successful delivery with a stable id', async () => {
    dispatch.mockResolvedValue({ matched: 1, succeeded: 1, failed: 0 });
    const db = client([event]);
    await expect(runOutboxBatch(db as never)).resolves.toEqual({ claimed: 1, published: 1, failed: 0 });
    expect(dispatch).toHaveBeenCalledWith(db, 'account-1', 'lead.created', event.payload, { id: 'event-1', occurredAt: event.created_at });
    expect(db.calls.at(-1)?.[0]).toBe('complete_domain_event');
  });
  it('schedules exponential retry when any endpoint fails', async () => {
    dispatch.mockResolvedValue({ matched: 2, succeeded: 1, failed: 1 });
    const db = client([{ ...event, attempt_count: 3 }]);
    await expect(runOutboxBatch(db as never)).resolves.toMatchObject({ failed: 1 });
    expect(db.calls.at(-1)).toEqual(['fail_domain_event', { p_event_id: 'event-1', p_error_code: 'webhook_delivery_failed', p_backoff_seconds: 120 }]);
  });
  it('publishes immediately when no endpoint subscribes', async () => {
    dispatch.mockResolvedValue({ matched: 0, succeeded: 0, failed: 0 });
    const db = client([event]);
    await expect(runOutboxBatch(db as never)).resolves.toMatchObject({ published: 1 });
  });
});
