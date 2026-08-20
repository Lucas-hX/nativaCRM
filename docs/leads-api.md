# Leads application API

This document covers the session-authenticated API used by the current CRM UI and the API-key ingestion boundary. Both remain intentionally independent from Meta, Make, WhatsApp providers, and presentation concerns.

## Boundaries

- `src/lib/leads/contracts.ts`: validates and normalizes HTTP inputs.
- `src/lib/leads/service.ts`: provider-neutral application use cases.
- `src/lib/leads/repository.ts`: Supabase/Postgres adapter. Transactional writes use the database RPCs from migration 041.
- `src/app/api/leads/`: thin Next.js route adapters.

The authenticated account is always derived from the server session. Callers cannot select an `account_id`. PostgreSQL RLS remains the final isolation boundary. List and detail responses never expose encrypted DNI, its hash, or raw provider payloads.

## Endpoints

| Method | Path | Minimum role | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/leads` | viewer | Paginated list and filters |
| `POST` | `/api/leads` | agent | Create a lead and its initial next action |
| `GET` | `/api/leads/:id` | viewer | Lead, contact, pending task, history, and duplicate candidates |
| `POST` | `/api/leads/:id/results` | agent | Atomically record a seller result and next action |
| `PUT` | `/api/leads/:id/assignment` | admin | Assign the lead and pending task |
| `GET` | `/api/leads/discard-reasons` | viewer | Structured tenant discard reasons |
| `GET` | `/api/leads/settings` | viewer | Tenant lead behavior and feature flags |
| `PATCH` | `/api/leads/settings` | admin | Update supported lead behavior |
| `GET` | `/api/leads/workspace` | viewer | Current role, operational timezone, and seller-workflow defaults |
| `GET` | `/api/leads/commercial-schema` | viewer | Active opportunity types, catalog items and lead fields |
| `POST/PATCH/DELETE` | `/api/leads/commercial-schema` | admin | Configure the tenant commercial model |
| `PATCH` | `/api/leads/:id/commercial-data` | agent | Set type, catalog item and custom values on an accessible lead |
| `POST` | `/api/v1/leads/ingest` | API key: `leads:write` | Idempotently ingest a provider-neutral lead event |

List filters are `status`, `priority`, `assigned_to` (UUID or `unassigned`), `search`, `due_before`, `due_after`, `page`, and `limit` (maximum 100).

For lead reads, `owner`, `admin`, and `viewer` can see the complete account. An `agent` can only see leads assigned to their own user ID. Viewers cannot mutate leads. Assignment is intentionally restricted to `owner` and `admin` during the manual-assignment pilot.

Seller results keep open leads atomic with exactly one pending next action. `rescheduled` additionally requires a structured `reason_code`; `won` requires `sold_product`, with optional `won_amount` and ISO currency. A discard using the tenant reason `no_response` is rejected until the configured attempt threshold is reached.

Errors use `{ "error": { "code", "message", "details?" } }` with stable codes: `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `DATA_ACCESS_ERROR`, and `INTERNAL_ERROR`.

## Extension rule

Provider adapters should translate their payload into the canonical ingestion command; provider-specific fields and credentials must not enter the domain service. `/api/v1/leads/ingest` authenticates an API key with explicit account scope and persists an idempotent `inbound_events` record before creating a lead.

### Canonical ingestion example

```json
{
  "provider": "make",
  "event_id": "meta-leadgen-123",
  "contact": {
    "phone": "+541155551234",
    "name": "Example",
    "email": "example@example.test"
  },
  "opportunity": {
    "source": "meta_lead_ads",
    "external_id": "123",
    "received_at": "2026-08-20T10:00:00Z",
    "next_follow_up_at": "2026-08-20T10:05:00Z",
    "campaign_id": "campaign-1",
    "form_id": "form-1",
    "priority": "normal",
    "opportunity_type_code": "new_sale",
    "catalog_sku": "PLAN-10GB",
    "fields": {
      "current_provider": "other",
      "line_count": 2
    }
  },
  "metadata": {
    "adapter_version": "1"
  }
}
```

The response identifies the durable inbound event, contact, and lead, plus `duplicate` and `contact_created`. Replaying the same `(account, provider, event_id)` returns the original lead. Audit payloads store only a phone suffix, presence flags, and metadata key names; direct contact fields and metadata values are processed but not copied into diagnostic JSON.

The commercial extensions are tenant-defined and provider-neutral. Opportunity types are goals such as a new sale or renewal; catalog items are lightweight sales references rather than inventory; field codes carry opportunity-specific data. Unknown codes do not create schema implicitly: administrators define the schema first, then provider mappings send stable codes.

## Administrative operations API

These cookie-session routes require `admin` or `owner` and power the current `/lead-operations` screen:

- `GET /api/admin/lead-operations/inbound-events` — inspect redacted ingestion state and failures.
- `POST /api/admin/lead-operations/inbound-events/:id/retry` — retry using the temporary encrypted canonical payload.
- `GET /api/admin/lead-operations/domain-events` — inspect pending, leased, published, and failed outbox events.

Processed ingestions automatically erase their encrypted replay payload. The outbox worker runs separately under PM2, claims rows with a lease, and applies exponential retry backoff for failed outbound deliveries.
