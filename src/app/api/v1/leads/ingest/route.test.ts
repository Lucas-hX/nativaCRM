import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ requireApiKey: vi.fn() }));
vi.mock('@/lib/auth/api-context', () => ({ requireApiKey: mocks.requireApiKey }));

import { LeadIngestionService } from '@/lib/leads/ingestion';
import { POST } from './route';

const context = { accountId: 'account-1', supabase: { rpc: vi.fn() }, keyId: 'key-1', scopes: ['leads:write'] };
const valid = { provider: 'make', event_id: 'evt-1', contact: { phone: '+541155551234' } };
function request(body: unknown) {
  return new Request('https://crm.example/api/v1/leads/ingest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

beforeEach(() => { vi.restoreAllMocks(); mocks.requireApiKey.mockReset().mockResolvedValue(context); });

describe('POST /api/v1/leads/ingest', () => {
  it('requires the dedicated write scope and returns 201 for a new lead', async () => {
    vi.spyOn(LeadIngestionService.prototype, 'ingest').mockResolvedValue({ event_id: 'event', lead_id: 'lead', contact_id: 'contact', duplicate: false, contact_created: true });
    const response = await POST(request(valid));
    expect(response.status).toBe(201);
    expect(mocks.requireApiKey).toHaveBeenCalledWith(expect.any(Request), 'leads:write');
    await expect(response.json()).resolves.toMatchObject({ data: { lead_id: 'lead' } });
  });
  it('returns 200 for an idempotent replay', async () => {
    vi.spyOn(LeadIngestionService.prototype, 'ingest').mockResolvedValue({ event_id: 'event', lead_id: 'lead', contact_id: 'contact', duplicate: true, contact_created: false });
    expect((await POST(request(valid))).status).toBe(200);
  });
  it('rejects malformed canonical input before calling the engine', async () => {
    const ingest = vi.spyOn(LeadIngestionService.prototype, 'ingest');
    const response = await POST(request({ provider: 'make', event_id: 'evt', contact: { phone: '12' } }));
    expect(response.status).toBe(400);
    expect(ingest).not.toHaveBeenCalled();
  });
});
