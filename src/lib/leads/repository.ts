import type { SupabaseClient } from "@supabase/supabase-js";
import type { CreateLeadCommand, LeadListFilters, RecordLeadResultCommand, UpdateLeadSettingsCommand } from "./contracts";
import { LeadDomainError } from "./errors";

const LEAD_FIELDS = "id, contact_id, source, external_id, campaign_id, campaign_name, form_id, form_name, company, plan, status, priority, assigned_to_user_id, received_at, attempt_count, dni_last4, discard_reason_id, closed_at, created_at, updated_at, contact:contacts(id, name, phone, email, company, avatar_url), pending_tasks:lead_tasks(id, assigned_to_user_id, status, due_at, created_at)";

export interface LeadRepository {
  list(accountId: string, filters: LeadListFilters): Promise<{ data: unknown[]; total: number }>;
  findById(accountId: string, leadId: string): Promise<unknown | null>;
  create(accountId: string, command: CreateLeadCommand): Promise<string>;
  recordResult(accountId: string, leadId: string, command: RecordLeadResultCommand): Promise<unknown>;
  listDiscardReasons(accountId: string, includeInactive: boolean): Promise<unknown[]>;
  getSettings(accountId: string): Promise<unknown>;
  updateSettings(accountId: string, command: UpdateLeadSettingsCommand): Promise<unknown>;
}

function fail(operation: string, error: { code?: string; message?: string } | null): never {
  if (error?.code === "P0002") throw new LeadDomainError("NOT_FOUND", "Lead not found");
  if (error?.code === "23514" || error?.code === "23505") throw new LeadDomainError("CONFLICT", "The lead operation conflicts with its current state");
  if (error?.code === "42501") throw new LeadDomainError("FORBIDDEN", "Insufficient lead permissions");
  console.error(`[leads:${operation}] database error`, { code: error?.code });
  throw new LeadDomainError("DATA_ACCESS_ERROR", "Could not complete the lead operation");
}

export class SupabaseLeadRepository implements LeadRepository {
  constructor(private readonly db: SupabaseClient) {}

  async list(accountId: string, filters: LeadListFilters) {
    let contactIds: string[] | undefined;
    let leadIds: string[] | undefined;
    if (filters.search) {
      const escaped = filters.search.replace(/[%_,()]/g, "");
      const { data, error } = await this.db.from("contacts").select("id").eq("account_id", accountId).or(`name.ilike.%${escaped}%,phone.ilike.%${escaped}%,email.ilike.%${escaped}%`).limit(500);
      if (error) fail("search_contacts", error);
      contactIds = (data ?? []).map((row: { id: string }) => row.id);
      if (!contactIds.length) return { data: [], total: 0 };
    }
    if (filters.dueBefore || filters.dueAfter) {
      let tasks = this.db.from("lead_tasks").select("lead_id").eq("account_id", accountId).eq("status", "pending");
      if (filters.dueBefore) tasks = tasks.lte("due_at", filters.dueBefore);
      if (filters.dueAfter) tasks = tasks.gte("due_at", filters.dueAfter);
      const { data, error } = await tasks.limit(5000);
      if (error) fail("filter_tasks", error);
      leadIds = (data ?? []).map((row: { lead_id: string }) => row.lead_id);
      if (!leadIds.length) return { data: [], total: 0 };
    }
    const from = (filters.page - 1) * filters.limit;
    let query = this.db.from("leads").select(LEAD_FIELDS, { count: "exact" }).eq("account_id", accountId);
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.priority) query = query.eq("priority", filters.priority);
    if (filters.assignedToUserId === null) query = query.is("assigned_to_user_id", null);
    else if (filters.assignedToUserId) query = query.eq("assigned_to_user_id", filters.assignedToUserId);
    if (contactIds) query = query.in("contact_id", contactIds);
    if (leadIds) query = query.in("id", leadIds);
    const { data, error, count } = await query.order("received_at", { ascending: false }).range(from, from + filters.limit - 1);
    if (error) fail("list", error);
    return { data: data ?? [], total: count ?? 0 };
  }

  async findById(accountId: string, leadId: string) {
    const { data, error } = await this.db.from("leads").select(`${LEAD_FIELDS}, activities:lead_activities(id, channel, result, attempt_number, note, metadata, actor_user_id, occurred_at, created_at), duplicate_matches:lead_duplicate_matches(id, matched_lead_id, matched_contact_id, match_type, confidence, reviewed_at, created_at)`).eq("account_id", accountId).eq("id", leadId).maybeSingle();
    if (error) fail("detail", error);
    return data;
  }

  async create(accountId: string, command: CreateLeadCommand) {
    const { data, error } = await this.db.rpc("create_lead_with_initial_task", {
      p_account_id: accountId, p_contact_id: command.contactId, p_source: command.source,
      p_external_id: command.externalId ?? null, p_received_at: command.receivedAt ?? new Date().toISOString(),
      p_assigned_to_user_id: command.assignedToUserId ?? null, p_next_follow_up_at: command.nextFollowUpAt,
      p_campaign_id: command.campaignId ?? null, p_campaign_name: command.campaignName ?? null,
      p_form_id: command.formId ?? null, p_form_name: command.formName ?? null,
      p_company: command.company ?? null, p_plan: command.plan ?? null, p_priority: command.priority,
    });
    if (error) fail("create", error);
    return data as string;
  }

  async recordResult(accountId: string, leadId: string, command: RecordLeadResultCommand) {
    const current = await this.findById(accountId, leadId);
    if (!current) throw new LeadDomainError("NOT_FOUND", "Lead not found");
    const { data, error } = await this.db.rpc("record_lead_result", {
      p_lead_id: leadId, p_channel: command.channel, p_result: command.result,
      p_note: command.note ?? null, p_next_follow_up_at: command.nextFollowUpAt ?? null,
      p_discard_reason_id: command.discardReasonId ?? null, p_assigned_to_user_id: command.assignedToUserId ?? null,
    });
    if (error) fail("record_result", error);
    return data;
  }

  async listDiscardReasons(accountId: string, includeInactive: boolean) {
    let query = this.db.from("discard_reasons").select("id, name, code, is_active, sort_order").eq("account_id", accountId);
    if (!includeInactive) query = query.eq("is_active", true);
    const { data, error } = await query.order("sort_order").order("name");
    if (error) fail("discard_reasons", error);
    return data ?? [];
  }

  async getSettings(accountId: string) {
    const { data, error } = await this.db.from("account_settings").select("lead_config, feature_flags").eq("account_id", accountId).maybeSingle();
    if (error) fail("get_settings", error);
    if (!data) throw new LeadDomainError("NOT_FOUND", "Lead settings not found");
    return data;
  }

  async updateSettings(accountId: string, command: UpdateLeadSettingsCommand) {
    const current = await this.getSettings(accountId) as { lead_config?: Record<string, unknown>; feature_flags?: Record<string, boolean> };
    const leadConfig = { ...(current.lead_config ?? {}) };
    if (command.closeNoResponseAfter !== undefined) leadConfig.close_no_response_after = command.closeNoResponseAfter;
    if (command.suggestFollowUp !== undefined) leadConfig.suggest_follow_up = command.suggestFollowUp;
    if (command.requireNextStep !== undefined) leadConfig.require_next_step = command.requireNextStep;
    const { data, error } = await this.db.from("account_settings").update({ lead_config: leadConfig }).eq("account_id", accountId).select("lead_config, feature_flags").single();
    if (error) fail("update_settings", error);
    return data;
  }
}
