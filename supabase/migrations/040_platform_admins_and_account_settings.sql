-- ============================================================
-- 040 — Comunicacion Nativa platform administration and
-- account-scoped product configuration.
--
-- Platform administration is deliberately separate from the existing
-- owner/admin/agent/viewer role hierarchy inside a customer account.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_platform_admin(
  target_user_id UUID DEFAULT auth.uid()
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT target_user_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.platform_admins pa
      WHERE pa.user_id = target_user_id
    );
$$;

ALTER FUNCTION public.is_platform_admin(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_platform_admin(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_admin(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.has_account_access(
  target_account_id UUID,
  min_role account_role_enum DEFAULT 'viewer'
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_admin(auth.uid())
    OR public.is_account_member(target_account_id, min_role);
$$;

ALTER FUNCTION public.has_account_access(UUID, account_role_enum) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.has_account_access(UUID, account_role_enum) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_account_access(UUID, account_role_enum) TO authenticated, service_role;

DROP POLICY IF EXISTS platform_admins_select ON public.platform_admins;
DROP POLICY IF EXISTS platform_admins_insert ON public.platform_admins;
DROP POLICY IF EXISTS platform_admins_delete ON public.platform_admins;

CREATE POLICY platform_admins_select ON public.platform_admins FOR SELECT
  USING (auth.uid() = user_id OR public.is_platform_admin(auth.uid()));

-- Bootstrap and membership changes are service-role/database operations.
-- Existing platform administrators may also grant or revoke access.
CREATE POLICY platform_admins_insert ON public.platform_admins FOR INSERT
  WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE POLICY platform_admins_delete ON public.platform_admins FOR DELETE
  USING (public.is_platform_admin(auth.uid()));

CREATE TABLE IF NOT EXISTS public.account_settings (
  account_id UUID PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  branding JSONB NOT NULL DEFAULT '{}'::JSONB,
  feature_flags JSONB NOT NULL DEFAULT '{}'::JSONB,
  lead_config JSONB NOT NULL DEFAULT jsonb_build_object(
    'close_no_response_after', 5,
    'suggest_follow_up', true,
    'require_next_step', true
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT account_settings_branding_object CHECK (jsonb_typeof(branding) = 'object'),
  CONSTRAINT account_settings_feature_flags_object CHECK (jsonb_typeof(feature_flags) = 'object'),
  CONSTRAINT account_settings_lead_config_object CHECK (jsonb_typeof(lead_config) = 'object')
);

INSERT INTO public.account_settings (account_id)
SELECT a.id FROM public.accounts a
ON CONFLICT (account_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.ensure_account_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.account_settings (account_id)
  VALUES (NEW.id)
  ON CONFLICT (account_id) DO NOTHING;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.ensure_account_settings() OWNER TO postgres;

DROP TRIGGER IF EXISTS ensure_account_settings_after_insert ON public.accounts;
CREATE TRIGGER ensure_account_settings_after_insert
  AFTER INSERT ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.ensure_account_settings();

DROP TRIGGER IF EXISTS set_updated_at ON public.account_settings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.account_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.account_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_settings_select ON public.account_settings;
DROP POLICY IF EXISTS account_settings_insert ON public.account_settings;
DROP POLICY IF EXISTS account_settings_update ON public.account_settings;
DROP POLICY IF EXISTS account_settings_delete ON public.account_settings;

CREATE POLICY account_settings_select ON public.account_settings FOR SELECT
  USING (public.has_account_access(account_id));
CREATE POLICY account_settings_insert ON public.account_settings FOR INSERT
  WITH CHECK (public.has_account_access(account_id, 'admin'));
CREATE POLICY account_settings_update ON public.account_settings FOR UPDATE
  USING (public.has_account_access(account_id, 'admin'))
  WITH CHECK (public.has_account_access(account_id, 'admin'));
CREATE POLICY account_settings_delete ON public.account_settings FOR DELETE
  USING (public.has_account_access(account_id, 'owner'));

COMMENT ON TABLE public.platform_admins IS
  'Comunicacion Nativa operators with cross-account platform privileges; separate from tenant roles.';
COMMENT ON TABLE public.account_settings IS
  'Tenant-scoped branding, feature flags, and lead workflow configuration.';
