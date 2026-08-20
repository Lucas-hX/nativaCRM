/** Database contract introduced by migrations 040 and 041. */

export type LeadStatus =
  | "new"
  | "in_progress"
  | "follow_up"
  | "won"
  | "discarded";

export type LeadPriority = "low" | "normal" | "high" | "urgent";

export type LeadActivityChannel =
  | "whatsapp"
  | "phone"
  | "email"
  | "other"
  | "system";

export type LeadActivityResult =
  | "no_answer"
  | "contacted"
  | "qualified"
  | "won"
  | "discarded"
  | "rescheduled"
  | "note"
  | "assigned";

export type LeadTaskStatus = "pending" | "completed" | "cancelled";

export interface AccountSettings {
  account_id: string;
  branding: Record<string, unknown>;
  feature_flags: Record<string, boolean>;
  lead_config: {
    close_no_response_after?: number;
    suggest_follow_up?: boolean;
    require_next_step?: boolean;
    [key: string]: unknown;
  };
  created_at: string;
  updated_at: string;
}

export interface Lead {
  id: string;
  account_id: string;
  contact_id: string;
  source: string;
  external_id: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  form_id: string | null;
  form_name: string | null;
  company: string | null;
  plan: string | null;
  status: LeadStatus;
  priority: LeadPriority;
  assigned_to_user_id: string | null;
  received_at: string;
  attempt_count: number;
  /** Encrypted application payload; never expose it in list responses. */
  dni_ciphertext: string | null;
  dni_hash: string | null;
  dni_last4: string | null;
  discard_reason_id: string | null;
  closed_at: string | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadActivity {
  id: string;
  account_id: string;
  lead_id: string;
  channel: LeadActivityChannel;
  result: LeadActivityResult;
  attempt_number: number | null;
  note: string | null;
  metadata: Record<string, unknown>;
  actor_user_id: string | null;
  occurred_at: string;
  created_at: string;
}

export interface LeadTask {
  id: string;
  account_id: string;
  lead_id: string;
  assigned_to_user_id: string | null;
  status: LeadTaskStatus;
  due_at: string;
  completed_at: string | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DiscardReason {
  id: string;
  account_id: string;
  name: string;
  code: string;
  is_active: boolean;
  sort_order: number;
}

export interface CreateLeadInput {
  accountId: string;
  contactId: string;
  source?: string;
  externalId?: string;
  receivedAt?: string;
  assignedToUserId?: string;
  nextFollowUpAt: string;
  campaignId?: string;
  campaignName?: string;
  formId?: string;
  formName?: string;
  company?: string;
  plan?: string;
  priority?: LeadPriority;
}

export interface RecordLeadResultInput {
  leadId: string;
  channel: LeadActivityChannel;
  result: LeadActivityResult;
  note?: string;
  nextFollowUpAt?: string;
  discardReasonId?: string;
  assignedToUserId?: string;
}
