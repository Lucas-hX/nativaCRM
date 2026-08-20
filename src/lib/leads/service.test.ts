import { describe, expect, it, vi } from "vitest";
import type { LeadRepository } from "./repository";
import { LeadService } from "./service";

function repository(overrides: Partial<LeadRepository> = {}): LeadRepository {
  return {
    list: vi.fn(), findById: vi.fn(), create: vi.fn(), recordResult: vi.fn(),
    listDiscardReasons: vi.fn(), getSettings: vi.fn(), updateSettings: vi.fn(),
    ...overrides,
  } as LeadRepository;
}

describe("LeadService", () => {
  it("removes internal account and sensitive DNI fields from responses", async () => {
    const repo = repository({ list: vi.fn().mockResolvedValue({ data: [{ id: "lead", account_id: "tenant", dni_ciphertext: "secret", dni_hash: "hash", dni_last4: "1234" }], total: 1 }) });
    const result = await new LeadService(repo).list("tenant", { page: 1, limit: 25 });
    expect(result.data).toEqual([{ id: "lead", dni_last4: "1234" }]);
    expect(result.pagination).toEqual({ page: 1, limit: 25, total: 1, pages: 1 });
  });

  it("reads the canonical record after an idempotent create", async () => {
    const command = { contactId: "contact", source: "meta", nextFollowUpAt: "date", priority: "normal" as const };
    const repo = repository({ create: vi.fn().mockResolvedValue("lead"), findById: vi.fn().mockResolvedValue({ id: "lead" }) });
    await expect(new LeadService(repo).create("tenant", command)).resolves.toEqual({ id: "lead" });
    expect(repo.create).toHaveBeenCalledWith("tenant", command);
    expect(repo.findById).toHaveBeenCalledWith("tenant", "lead");
  });

  it("refreshes detail after a transactional result", async () => {
    const command = { channel: "system" as const, result: "note" as const, note: "ok" };
    const repo = repository({ recordResult: vi.fn().mockResolvedValue({}), findById: vi.fn().mockResolvedValue({ id: "lead", activities: [] }) });
    await new LeadService(repo).recordResult("tenant", "lead", command);
    expect(repo.recordResult).toHaveBeenCalledWith("tenant", "lead", command);
  });
});
