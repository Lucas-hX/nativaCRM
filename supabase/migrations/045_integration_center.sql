-- ============================================================
-- 045 — Tenant-scoped Integration Center foundation.
--
-- Public connection metadata is deliberately separated from encrypted
-- credentials. Authenticated users never receive table privileges or RLS
-- policies for integration_secrets; secrets are write-only through a
-- server-authorized API and decrypted only inside provider adapters.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.integration_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_configured',
  external_ref TEXT,
  settings JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  last_tested_at TIMESTAMPTZ,
  last_event_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT integration_connections_provider_format CHECK (provider ~ '^[a-z][a-z0-9_]{1,63}$'),
  CONSTRAINT integration_connections_category_check CHECK (category IN ('channel','lead_source','automation','data','ai')),
  CONSTRAINT integration_connections_status_check CHECK (status IN ('not_configured','awaiting_sample','mapping_required','ready','active','degraded','paused')),
  CONSTRAINT integration_connections_settings_object CHECK (jsonb_typeof(settings) = 'object'),
  CONSTRAINT integration_connections_error_code_length CHECK (last_error_code IS NULL OR length(last_error_code) <= 100)
);

CREATE INDEX IF NOT EXISTS integration_connections_account_idx
  ON public.integration_connections(account_id, category, provider);
CREATE UNIQUE INDEX IF NOT EXISTS integration_connections_external_ref_uq
  ON public.integration_connections(account_id, provider, external_ref)
  WHERE external_ref IS NOT NULL;

DROP TRIGGER IF EXISTS set_updated_at ON public.integration_connections;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.integration_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.integration_secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID NOT NULL REFERENCES public.integration_connections(id) ON DELETE CASCADE,
  secret_key TEXT NOT NULL,
  encrypted_value TEXT NOT NULL,
  value_hint TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  rotated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT integration_secrets_key_format CHECK (secret_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  CONSTRAINT integration_secrets_hint_length CHECK (value_hint IS NULL OR length(value_hint) <= 32),
  UNIQUE(integration_id, secret_key)
);

CREATE TABLE IF NOT EXISTS public.integration_samples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  integration_id UUID NOT NULL REFERENCES public.integration_connections(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  detected_schema JSONB NOT NULL DEFAULT '{}'::JSONB,
  redacted_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  CONSTRAINT integration_samples_schema_object CHECK (jsonb_typeof(detected_schema) = 'object'),
  CONSTRAINT integration_samples_payload_object CHECK (jsonb_typeof(redacted_payload) = 'object')
);
CREATE INDEX IF NOT EXISTS integration_samples_connection_idx
  ON public.integration_samples(integration_id, received_at DESC);

CREATE TABLE IF NOT EXISTS public.integration_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  integration_id UUID NOT NULL REFERENCES public.integration_connections(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  mapping JSONB NOT NULL DEFAULT '{}'::JSONB,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT integration_mappings_mapping_object CHECK (jsonb_typeof(mapping) = 'object'),
  UNIQUE(integration_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS integration_mappings_one_active_idx
  ON public.integration_mappings(integration_id) WHERE is_active;

CREATE TABLE IF NOT EXISTS public.integration_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  integration_id UUID NOT NULL REFERENCES public.integration_connections(id) ON DELETE CASCADE,
  correlation_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound','health_check','import')),
  status TEXT NOT NULL CHECK (status IN ('received','processing','succeeded','failed','ignored')),
  event_count INTEGER NOT NULL DEFAULT 1 CHECK (event_count >= 0),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  error_code TEXT,
  diagnostics JSONB NOT NULL DEFAULT '{}'::JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT integration_runs_diagnostics_object CHECK (jsonb_typeof(diagnostics) = 'object'),
  CONSTRAINT integration_runs_error_code_length CHECK (error_code IS NULL OR length(error_code) <= 100)
);
CREATE INDEX IF NOT EXISTS integration_runs_connection_idx
  ON public.integration_runs(integration_id, started_at DESC);
CREATE INDEX IF NOT EXISTS integration_runs_account_status_idx
  ON public.integration_runs(account_id, status, started_at DESC);

CREATE TABLE IF NOT EXISTS public.integration_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  integration_id UUID REFERENCES public.integration_connections(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT integration_audit_action_format CHECK (action ~ '^[a-z][a-z0-9_.]{1,79}$'),
  CONSTRAINT integration_audit_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX IF NOT EXISTS integration_audit_account_idx
  ON public.integration_audit_logs(account_id, created_at DESC);

ALTER TABLE public.integration_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS integration_connections_select ON public.integration_connections;
DROP POLICY IF EXISTS integration_connections_insert ON public.integration_connections;
DROP POLICY IF EXISTS integration_connections_update ON public.integration_connections;
DROP POLICY IF EXISTS integration_connections_delete ON public.integration_connections;
CREATE POLICY integration_connections_select ON public.integration_connections FOR SELECT
  USING (public.has_account_access(account_id, 'admin'));
CREATE POLICY integration_connections_insert ON public.integration_connections FOR INSERT
  WITH CHECK (public.has_account_access(account_id, 'admin'));
CREATE POLICY integration_connections_update ON public.integration_connections FOR UPDATE
  USING (public.has_account_access(account_id, 'admin'))
  WITH CHECK (public.has_account_access(account_id, 'admin'));
CREATE POLICY integration_connections_delete ON public.integration_connections FOR DELETE
  USING (public.has_account_access(account_id, 'owner'));

DROP POLICY IF EXISTS integration_samples_select ON public.integration_samples;
DROP POLICY IF EXISTS integration_samples_delete ON public.integration_samples;
CREATE POLICY integration_samples_select ON public.integration_samples FOR SELECT
  USING (public.has_account_access(account_id, 'admin'));
CREATE POLICY integration_samples_delete ON public.integration_samples FOR DELETE
  USING (public.has_account_access(account_id, 'admin'));

DROP POLICY IF EXISTS integration_mappings_select ON public.integration_mappings;
DROP POLICY IF EXISTS integration_mappings_insert ON public.integration_mappings;
DROP POLICY IF EXISTS integration_mappings_update ON public.integration_mappings;
DROP POLICY IF EXISTS integration_mappings_delete ON public.integration_mappings;
CREATE POLICY integration_mappings_select ON public.integration_mappings FOR SELECT
  USING (public.has_account_access(account_id, 'admin'));
CREATE POLICY integration_mappings_insert ON public.integration_mappings FOR INSERT
  WITH CHECK (public.has_account_access(account_id, 'admin'));
CREATE POLICY integration_mappings_update ON public.integration_mappings FOR UPDATE
  USING (public.has_account_access(account_id, 'admin'))
  WITH CHECK (public.has_account_access(account_id, 'admin'));
CREATE POLICY integration_mappings_delete ON public.integration_mappings FOR DELETE
  USING (public.has_account_access(account_id, 'admin'));

DROP POLICY IF EXISTS integration_runs_select ON public.integration_runs;
CREATE POLICY integration_runs_select ON public.integration_runs FOR SELECT
  USING (public.has_account_access(account_id, 'admin'));

DROP POLICY IF EXISTS integration_audit_select ON public.integration_audit_logs;
DROP POLICY IF EXISTS integration_audit_insert ON public.integration_audit_logs;
CREATE POLICY integration_audit_select ON public.integration_audit_logs FOR SELECT
  USING (public.has_account_access(account_id, 'admin'));
CREATE POLICY integration_audit_insert ON public.integration_audit_logs FOR INSERT
  WITH CHECK (public.has_account_access(account_id, 'admin') AND actor_user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE ON public.integration_connections TO authenticated;
GRANT DELETE ON public.integration_connections TO authenticated;
GRANT SELECT, DELETE ON public.integration_samples TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.integration_mappings TO authenticated;
GRANT SELECT ON public.integration_runs TO authenticated;
GRANT SELECT, INSERT ON public.integration_audit_logs TO authenticated;

-- No authenticated policy and no table privileges: even owner/admin cannot
-- query encrypted credential material through PostgREST.
REVOKE ALL ON public.integration_secrets FROM anon, authenticated;
GRANT ALL ON public.integration_secrets TO service_role;
GRANT ALL ON public.integration_connections, public.integration_samples,
  public.integration_mappings, public.integration_runs, public.integration_audit_logs TO service_role;

COMMENT ON TABLE public.integration_connections IS 'Non-secret tenant integration metadata and health state.';
COMMENT ON TABLE public.integration_secrets IS 'Encrypted provider credentials; service-role only and never returned to browsers.';
COMMENT ON TABLE public.integration_samples IS 'Short-lived, redacted samples used to infer provider schemas.';
COMMENT ON TABLE public.integration_mappings IS 'Versioned mappings from provider payload fields to canonical CRM fields.';
COMMENT ON TABLE public.integration_runs IS 'Sanitized integration execution and health diagnostics.';
