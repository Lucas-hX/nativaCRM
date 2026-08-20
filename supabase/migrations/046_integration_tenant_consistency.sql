-- ============================================================
-- 046 — Enforce tenant consistency on Integration Center children.
--
-- RLS authorizes the row account_id. These composite foreign keys also
-- guarantee that the referenced connection belongs to that same account,
-- preventing cross-tenant references even if an integration UUID is known.
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS integration_connections_account_id_id_uq
  ON public.integration_connections(account_id, id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'integration_samples_account_connection_fk') THEN
    ALTER TABLE public.integration_samples
      ADD CONSTRAINT integration_samples_account_connection_fk
      FOREIGN KEY (account_id, integration_id)
      REFERENCES public.integration_connections(account_id, id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'integration_mappings_account_connection_fk') THEN
    ALTER TABLE public.integration_mappings
      ADD CONSTRAINT integration_mappings_account_connection_fk
      FOREIGN KEY (account_id, integration_id)
      REFERENCES public.integration_connections(account_id, id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'integration_runs_account_connection_fk') THEN
    ALTER TABLE public.integration_runs
      ADD CONSTRAINT integration_runs_account_connection_fk
      FOREIGN KEY (account_id, integration_id)
      REFERENCES public.integration_connections(account_id, id)
      ON DELETE CASCADE;
  END IF;
END
$$;
