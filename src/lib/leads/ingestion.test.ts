import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/whatsapp/encryption', () => ({ encrypt: () => 'encrypted-fixture' }));
import { LeadIngestionError, LeadIngestionService } from './ingestion';
import type { CanonicalLeadIntake } from './ingestion-contract';

const input: CanonicalLeadIntake = { provider: 'make', eventId: 'evt', contact: { phone: '+541155551234' }, opportunity: { source: 'make', priority: 'normal' }, metadata: {} };
function db(responses: Array<{ data: unknown; error: unknown }>) {
  const rpc = vi.fn().mockImplementation(() => Promise.resolve(responses.shift()));
  return { rpc };
}
describe('LeadIngestionService', () => {
  it('registers before processing and returns the canonical result', async () => {
    const client = db([{ data: { id: 'event' }, error: null }, { data: { event_id: 'event', lead_id: 'lead', contact_id: 'contact', duplicate: false, contact_created: true }, error: null }]);
    await expect(new LeadIngestionService(client as never).ingest('account', input)).resolves.toMatchObject({ lead_id: 'lead' });
    expect(client.rpc.mock.calls.map((call) => call[0])).toEqual(['register_inbound_lead_event', 'process_inbound_lead_event']);
  });
  it('persists a safe failure marker after processing fails', async () => {
    const client = db([{ data: { id: 'event' }, error: null }, { data: null, error: { code: '22023' } }, { data: null, error: null }]);
    await expect(new LeadIngestionService(client as never).ingest('account', input)).rejects.toMatchObject({ code: 'processing_failed' });
    expect(client.rpc.mock.calls[2][0]).toBe('fail_inbound_lead_event');
    expect(client.rpc.mock.calls[2][1].p_error_message).not.toContain('22023');
  });
  it('does not attempt processing when durable registration fails', async () => {
    const client = db([{ data: null, error: { code: 'failure' } }]);
    await expect(new LeadIngestionService(client as never).ingest('account', input)).rejects.toBeInstanceOf(LeadIngestionError);
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });
});
