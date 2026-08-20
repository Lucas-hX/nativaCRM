import type { CreateLeadCommand, LeadListFilters, RecordLeadResultCommand, UpdateLeadSettingsCommand } from "./contracts";
import { LeadDomainError } from "./errors";
import type { LeadRepository } from "./repository";

function sanitizeLead(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const safe = { ...(value as Record<string, unknown>) };
  delete safe.account_id;
  delete safe.dni_ciphertext;
  delete safe.dni_hash;
  if (Array.isArray(safe.pending_tasks)) safe.pending_tasks = safe.pending_tasks.filter((task) => (task as { status?: string }).status === "pending");
  if (Array.isArray(safe.activities)) safe.activities = [...safe.activities].sort((a, b) => String((b as Record<string, unknown>).occurred_at).localeCompare(String((a as Record<string, unknown>).occurred_at)));
  return safe;
}

export class LeadService {
  constructor(private readonly repository: LeadRepository) {}

  async list(accountId: string, filters: LeadListFilters) {
    const result = await this.repository.list(accountId, filters);
    return { data: result.data.map(sanitizeLead), pagination: { page: filters.page, limit: filters.limit, total: result.total, pages: Math.ceil(result.total / filters.limit) } };
  }

  async get(accountId: string, leadId: string) {
    const lead = await this.repository.findById(accountId, leadId);
    if (!lead) throw new LeadDomainError("NOT_FOUND", "Lead not found");
    return sanitizeLead(lead);
  }

  async create(accountId: string, command: CreateLeadCommand) {
    const id = await this.repository.create(accountId, command);
    return this.get(accountId, id);
  }

  async recordResult(accountId: string, leadId: string, command: RecordLeadResultCommand) {
    await this.repository.recordResult(accountId, leadId, command);
    return this.get(accountId, leadId);
  }

  listDiscardReasons(accountId: string, includeInactive = false) { return this.repository.listDiscardReasons(accountId, includeInactive); }
  getSettings(accountId: string) { return this.repository.getSettings(accountId); }
  updateSettings(accountId: string, command: UpdateLeadSettingsCommand) { return this.repository.updateSettings(accountId, command); }
}
