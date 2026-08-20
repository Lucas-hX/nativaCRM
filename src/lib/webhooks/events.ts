// ============================================================
// Outbound webhook event vocabulary — pure, no I/O.
//
// An endpoint subscribes to one or more of these. Adding an event is
// one entry here plus a `dispatchWebhookEvent` call at the source of
// the event (the DB stores subscriptions as a free `text[]`, so no
// migration is needed — same model as API scopes).
// ============================================================

export const WEBHOOK_EVENTS = [
  'message.received', // an inbound WhatsApp message landed
  'message.status_updated', // a sent message advanced (sent/delivered/read)
  'conversation.created', // a new conversation was opened for a contact
  'lead.created',
  'lead.result_recorded',
  'lead.assigned',
  'lead.follow_up_scheduled',
  'lead.won',
  'lead.discarded',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** Human-readable descriptions (surfaced in docs / a future UI). */
export const WEBHOOK_EVENT_DESCRIPTIONS: Record<WebhookEvent, string> = {
  'message.received': 'An inbound message was received from a contact',
  'message.status_updated':
    'A message you sent changed delivery status (sent/delivered/read/failed)',
  'conversation.created': 'A new conversation was opened',
  'lead.created': 'A commercial opportunity was created',
  'lead.result_recorded': 'A seller result was recorded',
  'lead.assigned': 'A lead was assigned to an operator',
  'lead.follow_up_scheduled': 'A new lead follow-up was scheduled',
  'lead.won': 'A lead was marked as won',
  'lead.discarded': 'A lead was discarded',
};

/** Type-narrow an unknown value into a valid `WebhookEvent`. */
export function isWebhookEvent(value: unknown): value is WebhookEvent {
  return (
    typeof value === 'string' &&
    (WEBHOOK_EVENTS as readonly string[]).includes(value)
  );
}

/**
 * Validate + de-duplicate a caller-supplied event list. Returns the
 * cleaned list, or `null` if any entry is unknown (callers turn that
 * into a 400). An empty list is rejected as `null` too — an endpoint
 * subscribed to nothing is almost certainly a mistake.
 */
export function normalizeEvents(input: unknown): WebhookEvent[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const out: WebhookEvent[] = [];
  for (const entry of input) {
    if (!isWebhookEvent(entry)) return null;
    if (!out.includes(entry)) out.push(entry);
  }
  return out;
}
