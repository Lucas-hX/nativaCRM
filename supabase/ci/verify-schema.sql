-- Post-migration assertions for the CI job in
-- `.github/workflows/migrations.yml`.
--
-- `supabase db reset` already fails on any statement Postgres rejects,
-- so this is not about syntax. It's about the quieter failure: a
-- migration that applies cleanly and does nothing. Every DDL statement
-- in this repo is guarded with IF NOT EXISTS / ON CONFLICT so the files
-- can be re-run safely, and that same guard turns a typo'd object name
-- into a silent no-op with a green checkmark.
--
-- Keep this thin. It is a smoke test for "did the migrations actually
-- build the schema", not a spec of it — asserting every column here
-- would just be the migrations restated in a second place, drifting.
DO $$
BEGIN
  -- The core tables, from 001.
  IF to_regclass('public.messages') IS NULL THEN
    RAISE EXCEPTION 'public.messages is missing — migrations did not apply';
  END IF;
  IF to_regclass('public.whatsapp_config') IS NULL THEN
    RAISE EXCEPTION 'public.whatsapp_config is missing — migrations did not apply';
  END IF;

  -- Supabase provides the storage schema; migrations 016/020/023 write
  -- to it. If it is absent the bucket migrations silently accomplish
  -- nothing, which is precisely the case a plain "no errors" run hides.
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE EXCEPTION
      'storage.buckets is missing — the storage schema was not available when the bucket migrations ran';
  END IF;

  -- Buckets are UPSERTed, so their absence means the INSERT never ran.
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'chat-media') THEN
    RAISE EXCEPTION 'the chat-media bucket row was not created (migration 023)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'flow-media') THEN
    RAISE EXCEPTION 'the flow-media bucket row was not created (migration 016)';
  END IF;

  -- Account scoping (017) is load-bearing for every RLS policy.
  IF to_regclass('public.accounts') IS NULL THEN
    RAISE EXCEPTION 'public.accounts is missing — migration 017 did not apply';
  END IF;

  -- Leads Nativa platform separation and lead-domain foundation.
  IF to_regclass('public.platform_admins') IS NULL THEN
    RAISE EXCEPTION 'public.platform_admins is missing — migration 040 did not apply';
  END IF;
  IF to_regclass('public.account_settings') IS NULL THEN
    RAISE EXCEPTION 'public.account_settings is missing — migration 040 did not apply';
  END IF;
  IF to_regclass('public.leads') IS NULL
     OR to_regclass('public.lead_tasks') IS NULL
     OR to_regclass('public.lead_activities') IS NULL
     OR to_regclass('public.inbound_events') IS NULL THEN
    RAISE EXCEPTION 'one or more Leads Nativa domain tables are missing — migration 041 did not apply';
  END IF;
  IF to_regprocedure('public.create_lead_with_initial_task(uuid,uuid,text,text,timestamptz,uuid,timestamptz,text,text,text,text,text,text,lead_priority_enum)') IS NULL THEN
    RAISE EXCEPTION 'create_lead_with_initial_task RPC is missing — migration 041 did not apply';
  END IF;
  IF to_regprocedure('public.record_lead_result(uuid,lead_activity_channel_enum,lead_activity_result_enum,text,timestamptz,uuid,uuid,text,text,numeric,text)') IS NULL THEN
    RAISE EXCEPTION 'record_lead_result RPC is missing — migration 041 did not apply';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'sold_product'
  ) THEN
    RAISE EXCEPTION 'seller workflow commercial fields are missing — migration 047 did not apply';
  END IF;
  IF to_regclass('public.domain_events') IS NULL THEN
    RAISE EXCEPTION 'public.domain_events is missing — migration 042 did not apply';
  END IF;
  IF to_regprocedure('public.register_inbound_lead_event(uuid,text,text,jsonb,text)') IS NULL
     OR to_regprocedure('public.process_inbound_lead_event(uuid,uuid,jsonb,jsonb)') IS NULL
     OR to_regprocedure('public.fail_inbound_lead_event(uuid,uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'one or more lead ingestion RPCs are missing — migration 042 did not apply';
  END IF;
  IF to_regprocedure('public.claim_domain_events(integer,integer)') IS NULL
     OR to_regprocedure('public.complete_domain_event(uuid)') IS NULL
     OR to_regprocedure('public.fail_domain_event(uuid,text,integer)') IS NULL THEN
    RAISE EXCEPTION 'one or more outbox worker RPCs are missing — migration 044 did not apply';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'emit_lead_activity_events' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'lead lifecycle outbox trigger is missing — migration 043 did not apply';
  END IF;
  IF to_regclass('public.integration_connections') IS NULL
     OR to_regclass('public.integration_secrets') IS NULL
     OR to_regclass('public.integration_samples') IS NULL
     OR to_regclass('public.integration_mappings') IS NULL
     OR to_regclass('public.integration_runs') IS NULL THEN
    RAISE EXCEPTION 'one or more Integration Center tables are missing — migration 045 did not apply';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'integration_mappings_account_connection_fk'
  ) THEN
    RAISE EXCEPTION 'Integration Center tenant-consistency constraints are missing — migration 046 did not apply';
  END IF;

  RAISE NOTICE 'schema verification passed';
END
$$;

-- Two things this file has already been burned by, both verified in CI
-- rather than assumed:
--
-- 1. It must contain EXACTLY ONE statement. `supabase db query --file`
--    sends the whole file as a prepared statement, and a second
--    top-level statement fails with the distinctly unhelpful "cannot
--    insert multiple commands into a prepared statement" (commit
--    f91a6c8). Add assertions INSIDE the DO block above; do not append
--    a second one.
--
-- 2. A RAISE in here really does fail the job. A deliberately false
--    assertion (commit 42c7db0, run 31579334056) surfaced as
--    `failed to execute query: error: ...` and exited 1. This is not a
--    decorative green tick.
