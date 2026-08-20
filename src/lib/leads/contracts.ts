import type {
  LeadActivityChannel,
  LeadActivityResult,
  LeadPriority,
  LeadStatus,
} from './types';
import { validationError } from './errors';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES: LeadStatus[] = [
  'new',
  'in_progress',
  'follow_up',
  'won',
  'discarded',
];
const PRIORITIES: LeadPriority[] = ['low', 'normal', 'high', 'urgent'];
const CHANNELS: LeadActivityChannel[] = [
  'whatsapp',
  'phone',
  'email',
  'other',
  'system',
];
const RESULTS: LeadActivityResult[] = [
  'no_answer',
  'contacted',
  'qualified',
  'won',
  'discarded',
  'rescheduled',
  'note',
  'assigned',
];

export interface LeadListFilters {
  status?: LeadStatus;
  priority?: LeadPriority;
  assignedToUserId?: string | null;
  search?: string;
  dueBefore?: string;
  dueAfter?: string;
  page: number;
  limit: number;
}

export interface CreateLeadCommand {
  contactId: string;
  source: string;
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
  priority: LeadPriority;
  opportunityTypeId?: string;
  catalogItemId?: string;
  fieldValues?: Record<string, unknown>;
}

export interface RecordLeadResultCommand {
  channel: LeadActivityChannel;
  result: LeadActivityResult;
  note?: string;
  nextFollowUpAt?: string;
  discardReasonId?: string;
  assignedToUserId?: string;
  reasonCode?: string;
  soldProduct?: string;
  wonAmount?: number;
  wonCurrency?: string;
}

export interface UpdateLeadSettingsCommand {
  closeNoResponseAfter?: number;
  suggestFollowUp?: boolean;
  requireNextStep?: boolean;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw validationError('Request body must be a JSON object');
  return value as Record<string, unknown>;
}

function optionalText(
  value: unknown,
  field: string,
  max = 500
): string | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string')
    throw validationError(`${field} must be a string`, {
      [field]: 'invalid_type',
    });
  const result = value.trim();
  if (!result || result.length > max)
    throw validationError(
      `${field} must contain between 1 and ${max} characters`,
      { [field]: 'invalid_length' }
    );
  return result;
}

function uuid(
  value: unknown,
  field: string,
  optional = false
): string | undefined {
  if (optional && (value == null || value === '')) return undefined;
  if (typeof value !== 'string' || !UUID.test(value))
    throw validationError(`${field} must be a valid UUID`, {
      [field]: 'invalid_uuid',
    });
  return value;
}

function date(
  value: unknown,
  field: string,
  optional = false
): string | undefined {
  if (optional && (value == null || value === '')) return undefined;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    throw validationError(`${field} must be an ISO date`, {
      [field]: 'invalid_date',
    });
  return new Date(value).toISOString();
}

function optionalAmount(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0)
    throw validationError('won_amount must be a non-negative number', {
      won_amount: 'invalid_value',
    });
  return amount;
}

function enumValue<T extends string>(
  value: unknown,
  field: string,
  values: readonly T[],
  fallback?: T
): T {
  if ((value == null || value === '') && fallback) return fallback;
  if (typeof value !== 'string' || !values.includes(value as T))
    throw validationError(`${field} has an unsupported value`, {
      [field]: 'invalid_value',
    });
  return value as T;
}

export function parseLeadListFilters(params: URLSearchParams): LeadListFilters {
  const page = Number(params.get('page') ?? '1');
  const limit = Number(params.get('limit') ?? '25');
  if (!Number.isInteger(page) || page < 1)
    throw validationError('page must be a positive integer', {
      page: 'invalid_value',
    });
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw validationError('limit must be between 1 and 100', {
      limit: 'invalid_value',
    });
  const assigned = params.get('assigned_to');
  return {
    status: params.has('status')
      ? enumValue(params.get('status'), 'status', STATUSES)
      : undefined,
    priority: params.has('priority')
      ? enumValue(params.get('priority'), 'priority', PRIORITIES)
      : undefined,
    assignedToUserId:
      assigned === 'unassigned' ? null : uuid(assigned, 'assigned_to', true),
    search: optionalText(params.get('search'), 'search', 100),
    dueBefore: date(params.get('due_before'), 'due_before', true),
    dueAfter: date(params.get('due_after'), 'due_after', true),
    page,
    limit,
  };
}

export function parseCreateLead(value: unknown): CreateLeadCommand {
  const body = object(value);
  const fieldValues =
    body.field_values == null ? {} : object(body.field_values);
  return {
    contactId: uuid(body.contact_id, 'contact_id')!,
    source: optionalText(body.source, 'source', 80) ?? 'manual',
    externalId: optionalText(body.external_id, 'external_id', 255),
    receivedAt: date(body.received_at, 'received_at', true),
    assignedToUserId: uuid(
      body.assigned_to_user_id,
      'assigned_to_user_id',
      true
    ),
    nextFollowUpAt: date(body.next_follow_up_at, 'next_follow_up_at')!,
    campaignId: optionalText(body.campaign_id, 'campaign_id', 255),
    campaignName: optionalText(body.campaign_name, 'campaign_name', 255),
    formId: optionalText(body.form_id, 'form_id', 255),
    formName: optionalText(body.form_name, 'form_name', 255),
    company: optionalText(body.company, 'company', 255),
    plan: optionalText(body.plan, 'plan', 255),
    priority: enumValue(body.priority, 'priority', PRIORITIES, 'normal'),
    opportunityTypeId: uuid(
      body.opportunity_type_id,
      'opportunity_type_id',
      true
    ),
    catalogItemId: uuid(body.catalog_item_id, 'catalog_item_id', true),
    fieldValues,
  };
}

export function parseRecordResult(value: unknown): RecordLeadResultCommand {
  const body = object(value);
  const result = enumValue(body.result, 'result', RESULTS);
  const command: RecordLeadResultCommand = {
    channel: enumValue(body.channel, 'channel', CHANNELS),
    result,
    note: optionalText(body.note, 'note', 4000),
    nextFollowUpAt: date(body.next_follow_up_at, 'next_follow_up_at', true),
    discardReasonId: uuid(body.discard_reason_id, 'discard_reason_id', true),
    assignedToUserId: uuid(
      body.assigned_to_user_id,
      'assigned_to_user_id',
      true
    ),
    reasonCode: optionalText(body.reason_code, 'reason_code', 80),
    soldProduct: optionalText(body.sold_product, 'sold_product', 255),
    wonAmount: optionalAmount(body.won_amount),
    wonCurrency: optionalText(
      body.won_currency,
      'won_currency',
      3
    )?.toUpperCase(),
  };
  if (
    ['no_answer', 'contacted', 'qualified', 'rescheduled'].includes(result) &&
    !command.nextFollowUpAt
  )
    throw validationError('This result requires next_follow_up_at', {
      next_follow_up_at: 'required',
    });
  if (result === 'discarded' && !command.discardReasonId)
    throw validationError('Discarding a lead requires discard_reason_id', {
      discard_reason_id: 'required',
    });
  if (result === 'assigned' && !command.assignedToUserId)
    throw validationError('Assignment requires assigned_to_user_id', {
      assigned_to_user_id: 'required',
    });
  if (result === 'rescheduled' && !command.reasonCode)
    throw validationError('Rescheduling requires reason_code', {
      reason_code: 'required',
    });
  if (result === 'won' && !command.soldProduct)
    throw validationError('A sale requires sold_product', {
      sold_product: 'required',
    });
  if (
    command.wonAmount !== undefined &&
    command.wonCurrency &&
    !/^[A-Z]{3}$/.test(command.wonCurrency)
  )
    throw validationError('won_currency must be an ISO 4217 code', {
      won_currency: 'invalid_value',
    });
  return command;
}

export function parseAssignment(value: unknown): RecordLeadResultCommand {
  const body = object(value);
  return {
    channel: 'system',
    result: 'assigned',
    assignedToUserId: uuid(body.assigned_to_user_id, 'assigned_to_user_id')!,
    note: optionalText(body.note, 'note', 4000),
  };
}

export function parseLeadSettings(value: unknown): UpdateLeadSettingsCommand {
  const body = object(value);
  const result: UpdateLeadSettingsCommand = {};
  if (body.close_no_response_after !== undefined) {
    const count = Number(body.close_no_response_after);
    if (!Number.isInteger(count) || count < 1 || count > 100)
      throw validationError(
        'close_no_response_after must be between 1 and 100'
      );
    result.closeNoResponseAfter = count;
  }
  if (body.suggest_follow_up !== undefined) {
    if (typeof body.suggest_follow_up !== 'boolean')
      throw validationError('suggest_follow_up must be boolean');
    result.suggestFollowUp = body.suggest_follow_up;
  }
  if (body.require_next_step !== undefined) {
    if (typeof body.require_next_step !== 'boolean')
      throw validationError('require_next_step must be boolean');
    result.requireNextStep = body.require_next_step;
  }
  if (!Object.keys(result).length)
    throw validationError('At least one lead setting is required');
  return result;
}
