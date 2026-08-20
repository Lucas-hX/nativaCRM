<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Leads Nativa project rules

## Purpose

This repository is the first CRM implementation for Comunicacion Nativa, a digital marketing agency. It is based on the upstream `ArnasDon/wacrm` project and will be adapted into a lead-management product focused on WhatsApp, Meta Lead Ads, Make integrations, and AI-assisted sales workflows.

The seller-facing experience must remain intentionally simple. The operational complexity belongs in administrator-only configuration, automations, integrations, AI agents, tools, and knowledge management.

Read these project sources before making product or domain changes:

- `docs/Plan de implementación — Mini CRM de Leads Nativa.docx`
- `docs/leadito1.PNG` through `docs/leadito4.PNG`

The images are conceptual MVP references, not pixel-perfect specifications. Preserve their core interaction principle: a normal lead action should take no more than three primary user actions.

## Current deployment

- Operating system: Debian 13 (`trixie`), 4 vCPU, approximately 8 GB RAM, 2 GB swap.
- Application: WA-CRM 0.8.0, Next.js 16.2.12, React 19, TypeScript, Tailwind.
- Runtime: Node.js 20 and npm 10.
- Database platform: self-hosted Supabase `self-hosted/v0.8.0` on Docker Compose.
- Database: PostgreSQL 17 with RLS and pgvector.
- Public application: `https://crm.bism.fun`.
- Public Supabase gateway: `https://api.bism.fun`.
- Process manager: PM2.
- Edge ingress: Cloudflare Tunnel named `bism2`.
- The host does not intentionally expose application, Supabase, or database ports. Ports 3000, 8000, 5432, and 6543 must remain bound to `127.0.0.1`.

Important paths:

- Application environment: `.env.local` (secret, ignored by Git).
- Test credentials: `.env.test.local` (secret, ignored by Git).
- PM2 definition: `ecosystem.config.cjs`.
- Supabase deployment: `infra/supabase/`.
- Supabase secrets: `infra/supabase/.env` (secret, ignored by Git).
- Local-only port override: `infra/supabase/docker-compose.local.yml`.
- Cloudflare configuration: `/root/.cloudflared/config.yml`.

## Architecture and tenancy

Keep `account_id` and the existing Supabase RLS model on every tenant-owned table. The first deployment serves one customer, but the data model must remain compatible with a future shared multitenant deployment.

Do not hard-code customer branding, business rules, Meta credentials, Make credentials, WhatsApp configuration, provider keys, or feature availability. Put tenant-specific behavior behind account configuration or feature flags.

WA-CRM already supplies accounts, roles, invitations, WhatsApp conversations, pipelines, automations, flows, an AI assistant, and an account-scoped knowledge base. Extend these foundations instead of replacing them unless there is a documented technical reason.

The planned lead domain includes contacts, leads, lead activities, follow-up tasks, inbound events, discard reasons, and duplicate matches. Contacts represent people; leads represent individual commercial opportunities. Preserve the invariant that every open lead has exactly one pending next action.

The internal lead API and its extension boundaries are documented in `docs/leads-api.md`. Keep routes thin and provider-neutral; add business use cases to the service and isolate storage/provider details in adapters.

## Development rules

- Preserve upstream behavior while the base installation is being adapted incrementally.
- Read the relevant Next.js 16 documentation under `node_modules/next/dist/docs/` before changing framework-sensitive code.
- Implement database changes as ordered, idempotent SQL migrations under `supabase/migrations/`.
- Every new tenant-owned table must have `account_id`, suitable indexes, RLS enabled, and explicit policies.
- Keep service-role keys server-only. Never expose them through `NEXT_PUBLIC_*`, logs, API responses, or browser bundles.
- Never log complete DNI values, access tokens, provider keys, webhook payload secrets, or passwords.
- Normalize phone numbers and scope uniqueness/deduplication by `account_id`.
- Webhook ingestion must authenticate requests, persist the inbound event first, and enforce idempotency.
- Do not remove the WhatsApp or AI modules. Seller navigation may hide complexity, while administrators retain access.
- Do not create per-customer branches or divergent copies of the product. Maintain one codebase.
- Keep infrastructure source directories excluded from application TypeScript and ESLint traversal.

## Commands and verification

Use npm because the repository lockfile and package metadata are npm-based.

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

The current upstream baseline has 825 passing tests. ESLint currently reports upstream warnings but no errors. Do not introduce new errors or silently reduce test coverage.

After a production build, the PM2 process uses the standalone server. Copy static assets before restarting it:

```bash
mkdir -p .next/standalone/.next
cp -a .next/static .next/standalone/.next/
cp -a public .next/standalone/
pm2 restart ecosystem.config.cjs --only leadsnativa-web --update-env
pm2 save
```

Operational checks:

```bash
pm2 list
pm2 logs leadsnativa-web --nostream --lines 100
cd infra/supabase && docker compose ps
docker stats --no-stream
ss -lntp
```

All Supabase containers should report healthy. Verify that published service ports remain on `127.0.0.1` after Compose changes.

## Database migrations

The WA-CRM migrations 001 through 039 and Leads Nativa migrations 040 through 046 have been applied. Migration 045 adds the tenant-scoped Integration Center; its credential table is service-role-only and must never be exposed through browser queries. Migration 046 enforces tenant-consistent child references. For new migrations, execute only unapplied files and use `ON_ERROR_STOP` during verification. Do not reinitialize or delete the database volume to apply schema changes.

Back up the database before risky schema operations. Production-grade external backups are still pending and must be completed before storing irreplaceable customer data.

## Test account

Local test credentials are stored in `.env.test.local` as `E2E_TEST_EMAIL` and `E2E_TEST_PASSWORD`. Load them without printing their values. They may be used for API or browser smoke tests.

Do not place these credentials in committed files, screenshots, command output, issue text, or final responses. Avoid destructive tests against this account. Prefer disposable synthetic users for signup/account-provisioning tests and clean up only data created by the test.

## Current operational caveats

- Email auto-confirmation is enabled because production SMTP is not configured yet.
- Public signup remains enabled for initial setup; close it after account onboarding is established.
- `META_APP_SECRET` is a development placeholder until the real Meta application is connected.
- Cloudflare may challenge non-browser clients. Before enabling Meta or Make webhooks, configure narrowly scoped Cloudflare skip rules for the exact webhook endpoints while retaining application-level authentication and signature validation.
- Supabase Studio is reachable through the API gateway and protected by its generated dashboard credentials. Do not publish or weaken those credentials.
- `api.bism.fun` is the canonical Supabase endpoint. Do not use the obsolete `api.crm.bism.fun` hostname.

## Definition of done for changes

A change is complete only when its relevant tests pass, the production build succeeds when applicable, migrations and RLS are verified, no secret is exposed, PM2/Docker remain healthy, and the public route still works through Cloudflare. Report any skipped verification explicitly.
