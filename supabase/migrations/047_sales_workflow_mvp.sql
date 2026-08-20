-- ============================================================
-- 047 — Seller workspace rules for the Nativa CRM pilot.
-- Restricts agents to assigned leads, makes assignment supervisory,
-- and persists the structured data required by commercial outcomes.
-- ============================================================

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS sold_product TEXT,
  ADD COLUMN IF NOT EXISTS won_amount NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS won_currency TEXT;

ALTER TABLE public.lead_activities
  ADD COLUMN IF NOT EXISTS reason_code TEXT;

UPDATE public.leads
SET sold_product = COALESCE(NULLIF(BTRIM(plan), ''), 'Venta histórica sin detalle')
WHERE status = 'won' AND sold_product IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leads_won_details_consistent'
  ) THEN
    ALTER TABLE public.leads ADD CONSTRAINT leads_won_details_consistent CHECK (
      (status = 'won' AND sold_product IS NOT NULL AND BTRIM(sold_product) <> '')
      OR (status <> 'won' AND sold_product IS NULL AND won_amount IS NULL AND won_currency IS NULL)
    );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leads_won_amount_nonnegative'
  ) THEN
    ALTER TABLE public.leads ADD CONSTRAINT leads_won_amount_nonnegative
      CHECK (won_amount IS NULL OR won_amount >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leads_won_currency_format'
  ) THEN
    ALTER TABLE public.leads ADD CONSTRAINT leads_won_currency_format
      CHECK (won_currency IS NULL OR won_currency ~ '^[A-Z]{3}$');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lead_activities_reason_code_format'
  ) THEN
    ALTER TABLE public.lead_activities ADD CONSTRAINT lead_activities_reason_code_format
      CHECK (reason_code IS NULL OR reason_code ~ '^[a-z0-9_]+$');
  END IF;
END $$;

UPDATE public.account_settings
SET lead_config = jsonb_strip_nulls(
  jsonb_build_object(
    'close_no_response_after', COALESCE(lead_config->'close_no_response_after', '5'::jsonb),
    'require_next_step', 'true'::jsonb,
    'timezone', COALESCE(lead_config->'timezone', '"America/Argentina/Buenos_Aires"'::jsonb)
  ) || (lead_config - 'suggest_follow_up')
);

INSERT INTO public.discard_reasons(account_id, name, code, sort_order)
SELECT a.id, reason.name, reason.code, reason.sort_order
FROM public.accounts a
CROSS JOIN (VALUES
  ('Precio', 'price', 11),
  ('Ya contrató otra opción', 'chose_other', 12),
  ('No lo necesita actualmente', 'not_needed_now', 13),
  ('No recuerda haber consultado', 'does_not_recall', 14),
  ('Condiciones o cobertura', 'conditions_not_suitable', 15),
  ('Número incorrecto', 'wrong_number', 30),
  ('No cumple requisitos', 'not_qualified', 31)
) AS reason(name, code, sort_order)
ON CONFLICT (account_id, code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.enforce_lead_creation_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'authenticated'
     AND NOT public.has_account_access(NEW.account_id, 'admin')
     AND NOT (
       public.has_account_access(NEW.account_id, 'agent')
       AND NEW.assigned_to_user_id = auth.uid()
     ) THEN
    RAISE EXCEPTION 'agents may only create leads assigned to themselves' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_lead_creation_assignment ON public.leads;
CREATE TRIGGER enforce_lead_creation_assignment
  BEFORE INSERT ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.enforce_lead_creation_assignment();

CREATE OR REPLACE FUNCTION public.can_read_lead(p_account_id UUID, p_assigned_to_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_id = p_account_id
        AND (p.account_role IN ('owner', 'admin', 'viewer') OR p.user_id = p_assigned_to_user_id)
    );
$$;

CREATE OR REPLACE FUNCTION public.can_operate_lead(p_account_id UUID, p_assigned_to_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_id = p_account_id
        AND (p.account_role IN ('owner', 'admin') OR (p.account_role = 'agent' AND p.user_id = p_assigned_to_user_id))
    );
$$;

REVOKE ALL ON FUNCTION public.can_read_lead(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_operate_lead(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_lead(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_operate_lead(UUID, UUID) TO authenticated, service_role;

DROP POLICY IF EXISTS leads_select ON public.leads;
CREATE POLICY leads_select ON public.leads FOR SELECT
  USING (public.can_read_lead(account_id, assigned_to_user_id));

DROP POLICY IF EXISTS lead_activities_select ON public.lead_activities;
CREATE POLICY lead_activities_select ON public.lead_activities FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = lead_id AND l.account_id = account_id
      AND public.can_read_lead(l.account_id, l.assigned_to_user_id)
  ));

DROP POLICY IF EXISTS lead_tasks_select ON public.lead_tasks;
CREATE POLICY lead_tasks_select ON public.lead_tasks FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = lead_id AND l.account_id = account_id
      AND public.can_read_lead(l.account_id, l.assigned_to_user_id)
  ));

DROP POLICY IF EXISTS lead_duplicate_matches_select ON public.lead_duplicate_matches;
CREATE POLICY lead_duplicate_matches_select ON public.lead_duplicate_matches FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = lead_id AND l.account_id = account_id
      AND public.can_read_lead(l.account_id, l.assigned_to_user_id)
  ));

DROP FUNCTION IF EXISTS public.record_lead_result(
  UUID, lead_activity_channel_enum, lead_activity_result_enum,
  TEXT, TIMESTAMPTZ, UUID, UUID
);

CREATE FUNCTION public.record_lead_result(
  p_lead_id UUID,
  p_channel lead_activity_channel_enum,
  p_result lead_activity_result_enum,
  p_note TEXT DEFAULT NULL,
  p_next_follow_up_at TIMESTAMPTZ DEFAULT NULL,
  p_discard_reason_id UUID DEFAULT NULL,
  p_assigned_to_user_id UUID DEFAULT NULL,
  p_reason_code TEXT DEFAULT NULL,
  p_sold_product TEXT DEFAULT NULL,
  p_won_amount NUMERIC DEFAULT NULL,
  p_won_currency TEXT DEFAULT NULL
) RETURNS public.leads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead public.leads;
  v_attempt_number INTEGER;
  v_is_attempt BOOLEAN;
  v_discard_code TEXT;
  v_no_response_threshold INTEGER;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lead not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (auth.role() = 'service_role' OR public.can_operate_lead(v_lead.account_id, v_lead.assigned_to_user_id)) THEN
    RAISE EXCEPTION 'insufficient lead permissions' USING ERRCODE = '42501';
  END IF;
  IF v_lead.status IN ('won', 'discarded') THEN
    RAISE EXCEPTION 'closed leads cannot receive operational results' USING ERRCODE = '23514';
  END IF;

  IF p_result = 'assigned' THEN
    IF NOT (auth.role() = 'service_role' OR public.has_account_access(v_lead.account_id, 'admin')) THEN
      RAISE EXCEPTION 'lead assignment requires admin permissions' USING ERRCODE = '42501';
    END IF;
    IF p_assigned_to_user_id IS NULL THEN
      RAISE EXCEPTION 'assigned result requires an assignee' USING ERRCODE = '23514';
    END IF;
    UPDATE public.leads SET assigned_to_user_id = p_assigned_to_user_id
      WHERE id = v_lead.id RETURNING * INTO v_lead;
    UPDATE public.lead_tasks SET assigned_to_user_id = p_assigned_to_user_id
      WHERE lead_id = v_lead.id AND status = 'pending';
    INSERT INTO public.lead_activities(account_id, lead_id, channel, result, note, actor_user_id)
      VALUES (v_lead.account_id, v_lead.id, 'system', 'assigned', p_note, auth.uid());
    RETURN v_lead;
  END IF;

  IF p_result = 'note' THEN
    INSERT INTO public.lead_activities(account_id, lead_id, channel, result, note, actor_user_id)
      VALUES (v_lead.account_id, v_lead.id, p_channel, p_result, p_note, auth.uid());
    RETURN v_lead;
  END IF;

  IF p_result IN ('no_answer', 'contacted', 'qualified', 'rescheduled') AND p_next_follow_up_at IS NULL THEN
    RAISE EXCEPTION 'open result requires a next follow-up' USING ERRCODE = '23514';
  END IF;
  IF p_result = 'rescheduled' AND p_reason_code NOT IN ('customer_request', 'outside_business_hours', 'seller_unavailable', 'other') THEN
    RAISE EXCEPTION 'rescheduled result requires a valid reason' USING ERRCODE = '23514';
  END IF;
  IF p_result = 'won' AND (p_sold_product IS NULL OR BTRIM(p_sold_product) = '') THEN
    RAISE EXCEPTION 'won result requires a sold product or plan' USING ERRCODE = '23514';
  END IF;
  IF p_result = 'discarded' THEN
    IF p_discard_reason_id IS NULL THEN
      RAISE EXCEPTION 'discarded result requires a discard reason' USING ERRCODE = '23514';
    END IF;
    SELECT code INTO v_discard_code FROM public.discard_reasons
      WHERE id = p_discard_reason_id AND account_id = v_lead.account_id AND is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'discard reason does not belong to the lead account' USING ERRCODE = '23514';
    END IF;
    IF v_discard_code = 'no_response' THEN
      SELECT GREATEST(1, COALESCE((lead_config->>'close_no_response_after')::INTEGER, 5))
        INTO v_no_response_threshold FROM public.account_settings WHERE account_id = v_lead.account_id;
      IF v_lead.attempt_count + 1 < COALESCE(v_no_response_threshold, 5) THEN
        RAISE EXCEPTION 'no-response discard threshold has not been reached' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  v_is_attempt := p_result IN ('no_answer', 'contacted', 'qualified', 'won', 'discarded');
  v_attempt_number := CASE WHEN v_is_attempt THEN v_lead.attempt_count + 1 ELSE NULL END;

  UPDATE public.lead_tasks
    SET status = CASE WHEN p_result IN ('won', 'discarded') THEN 'cancelled'::lead_task_status_enum ELSE 'completed'::lead_task_status_enum END,
        completed_at = CASE WHEN p_result IN ('won', 'discarded') THEN NULL ELSE NOW() END
    WHERE lead_id = v_lead.id AND status = 'pending';

  UPDATE public.leads SET
    status = CASE p_result
      WHEN 'no_answer' THEN 'follow_up'::lead_status_enum
      WHEN 'contacted' THEN 'in_progress'::lead_status_enum
      WHEN 'qualified' THEN 'follow_up'::lead_status_enum
      WHEN 'rescheduled' THEN 'follow_up'::lead_status_enum
      WHEN 'won' THEN 'won'::lead_status_enum
      WHEN 'discarded' THEN 'discarded'::lead_status_enum ELSE status END,
    attempt_count = attempt_count + CASE WHEN v_is_attempt THEN 1 ELSE 0 END,
    discard_reason_id = CASE WHEN p_result = 'discarded' THEN p_discard_reason_id ELSE NULL END,
    sold_product = CASE WHEN p_result = 'won' THEN BTRIM(p_sold_product) ELSE NULL END,
    won_amount = CASE WHEN p_result = 'won' THEN p_won_amount ELSE NULL END,
    won_currency = CASE WHEN p_result = 'won' AND p_won_amount IS NOT NULL THEN COALESCE(UPPER(p_won_currency), 'ARS') ELSE NULL END,
    closed_at = CASE WHEN p_result IN ('won', 'discarded') THEN NOW() ELSE NULL END
    WHERE id = v_lead.id RETURNING * INTO v_lead;

  INSERT INTO public.lead_activities(
    account_id, lead_id, channel, result, attempt_number, note, reason_code, actor_user_id
  ) VALUES (
    v_lead.account_id, v_lead.id, p_channel, p_result, v_attempt_number, p_note,
    CASE WHEN p_result = 'rescheduled' THEN p_reason_code ELSE v_discard_code END, auth.uid()
  );

  IF v_lead.status IN ('new', 'in_progress', 'follow_up') THEN
    INSERT INTO public.lead_tasks(account_id, lead_id, assigned_to_user_id, due_at, created_by_user_id)
      VALUES (v_lead.account_id, v_lead.id, v_lead.assigned_to_user_id, p_next_follow_up_at, auth.uid());
  END IF;
  RETURN v_lead;
END;
$$;

ALTER FUNCTION public.record_lead_result(
  UUID, lead_activity_channel_enum, lead_activity_result_enum,
  TEXT, TIMESTAMPTZ, UUID, UUID, TEXT, TEXT, NUMERIC, TEXT
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_lead_result(
  UUID, lead_activity_channel_enum, lead_activity_result_enum,
  TEXT, TIMESTAMPTZ, UUID, UUID, TEXT, TEXT, NUMERIC, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_lead_result(
  UUID, lead_activity_channel_enum, lead_activity_result_enum,
  TEXT, TIMESTAMPTZ, UUID, UUID, TEXT, TEXT, NUMERIC, TEXT
) TO authenticated, service_role;

COMMENT ON COLUMN public.leads.sold_product IS 'Required product or plan snapshot when the opportunity is won.';
COMMENT ON COLUMN public.lead_activities.reason_code IS 'Structured discard or reschedule reason; contains no credentials or personal identifiers.';
