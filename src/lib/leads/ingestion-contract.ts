import type { LeadPriority } from './types';

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/;
const PROVIDER = /^[a-z0-9][a-z0-9_-]{0,49}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIORITIES: LeadPriority[] = ['low', 'normal', 'high', 'urgent'];

export class IngestionValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'IngestionValidationError'; }
}

export interface CanonicalLeadIntake {
  provider: string;
  eventId: string;
  contact: { phone: string; name?: string; email?: string; company?: string };
  opportunity: {
    source: string; externalId?: string; receivedAt?: string; nextFollowUpAt?: string;
    assignedToUserId?: string; campaignId?: string; campaignName?: string;
    formId?: string; formName?: string; company?: string; plan?: string; priority: LeadPriority;
  };
  metadata: Record<string, string | number | boolean | null>;
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new IngestionValidationError(`${name} must be an object`);
  return value as Record<string, unknown>;
}
function text(value: unknown, name: string, required = false, max = 255): string | undefined {
  if (value == null || value === '') { if (required) throw new IngestionValidationError(`${name} is required`); return undefined; }
  if (typeof value !== 'string') throw new IngestionValidationError(`${name} must be a string`);
  const clean = value.trim();
  if (!clean || clean.length > max) throw new IngestionValidationError(`${name} has an invalid length`);
  return clean;
}
function isoDate(value: unknown, name: string) {
  const raw = text(value, name);
  if (!raw) return undefined;
  if (!Number.isFinite(Date.parse(raw))) throw new IngestionValidationError(`${name} must be an ISO date`);
  return new Date(raw).toISOString();
}
function uuid(value: unknown, name: string) {
  const raw = text(value, name);
  if (raw && !UUID.test(raw)) throw new IngestionValidationError(`${name} must be a UUID`);
  return raw;
}

export function parseCanonicalLeadIntake(value: unknown): CanonicalLeadIntake {
  const body = record(value, 'body');
  const contact = record(body.contact, 'contact');
  const opportunity = body.opportunity == null ? {} : record(body.opportunity, 'opportunity');
  const provider = text(body.provider, 'provider', true, 50)!.toLowerCase();
  const eventId = text(body.event_id, 'event_id', true)!;
  if (!PROVIDER.test(provider)) throw new IngestionValidationError('provider contains unsupported characters');
  if (!ID.test(eventId)) throw new IngestionValidationError('event_id contains unsupported characters');
  const phone = text(contact.phone, 'contact.phone', true, 40)!;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) throw new IngestionValidationError('contact.phone must contain 8 to 15 digits');
  const priority = (text(opportunity.priority, 'opportunity.priority', false, 20) ?? 'normal') as LeadPriority;
  if (!PRIORITIES.includes(priority)) throw new IngestionValidationError('opportunity.priority is unsupported');
  const metadataRaw = body.metadata == null ? {} : record(body.metadata, 'metadata');
  const metadata: CanonicalLeadIntake['metadata'] = {};
  for (const [key, item] of Object.entries(metadataRaw)) {
    if (!/^[A-Za-z0-9_.-]{1,80}$/.test(key) || !['string', 'number', 'boolean'].includes(typeof item) && item !== null) throw new IngestionValidationError('metadata must contain only scalar values');
    if (typeof item === 'string' && item.length > 500) throw new IngestionValidationError(`metadata.${key} is too long`);
    metadata[key] = item as string | number | boolean | null;
  }
  return {
    provider, eventId,
    contact: { phone, name: text(contact.name, 'contact.name'), email: text(contact.email, 'contact.email', false, 320), company: text(contact.company, 'contact.company') },
    opportunity: {
      source: text(opportunity.source, 'opportunity.source', false, 80) ?? provider,
      externalId: text(opportunity.external_id, 'opportunity.external_id'), receivedAt: isoDate(opportunity.received_at, 'opportunity.received_at'),
      nextFollowUpAt: isoDate(opportunity.next_follow_up_at, 'opportunity.next_follow_up_at'), assignedToUserId: uuid(opportunity.assigned_to_user_id, 'opportunity.assigned_to_user_id'),
      campaignId: text(opportunity.campaign_id, 'opportunity.campaign_id'), campaignName: text(opportunity.campaign_name, 'opportunity.campaign_name'),
      formId: text(opportunity.form_id, 'opportunity.form_id'), formName: text(opportunity.form_name, 'opportunity.form_name'),
      company: text(opportunity.company, 'opportunity.company'), plan: text(opportunity.plan, 'opportunity.plan'), priority,
    }, metadata,
  };
}

export function redactedIntakePayload(input: CanonicalLeadIntake) {
  const digits = input.contact.phone.replace(/\D/g, '');
  return {
    schema_version: 1, provider: input.provider, event_id: input.eventId,
    contact: { phone_last4: digits.slice(-4), has_name: Boolean(input.contact.name), has_email: Boolean(input.contact.email), has_company: Boolean(input.contact.company) },
    opportunity: { source: input.opportunity.source, campaign_id: input.opportunity.campaignId ?? null, form_id: input.opportunity.formId ?? null },
    metadata_keys: Object.keys(input.metadata).sort(),
  };
}
