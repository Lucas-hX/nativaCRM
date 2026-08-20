-- ============================================================
-- 041 — Leads Nativa domain, RLS, invariants, and transactional
-- seller workflow operations.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lead_status_enum') THEN
    CREATE TYPE lead_status_enum AS ENUM ('new', 'in_progress', 'follow_up', 'won', 'discarded');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lead_priority_enum') THEN
    CREATE TYPE lead_priority_enum AS ENUM ('low', 'normal', 'high', 'urgent');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lead_activity_channel_enum') THEN
    CREATE TYPE lead_activity_channel_enum AS ENUM ('whatsapp', 'phone', 'email', 'other', 'system');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lead_activity_result_enum') THEN
    CREATE TYPE lead_activity_result_enum AS ENUM (
      'no_answer', 'contacted', 'qualified', 'won', 'discarded',
      'rescheduled', 'note', 'assigned'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lead_task_status_enum') THEN
    CREATE TYPE lead_task_status_enum AS ENUM ('pending', 'completed', 'cancelled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inbound_event_status_enum') THEN
    CREATE TYPE inbound_event_status_enum AS ENUM ('received', 'processing', 'processed', 'failed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lead_duplicate_match_type_enum') THEN
    CREATE TYPE lead_duplicate_match_type_enum AS ENUM ('phone', 'dni', 'manual');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.discard_reasons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, code),
  CONSTRAINT discard_reasons_code_format CHECK (code ~ '^[a-z0-9_]+$')
);

CREATE TABLE IF NOT EXISTS public.leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE RESTRICT,
  source TEXT NOT NULL DEFAULT 'manual',
  external_id TEXT,
  campaign_id TEXT,
  campaign_name TEXT,
  form_id TEXT,
  form_name TEXT,
  company TEXT,
  plan TEXT,
  status lead_status_enum NOT NULL DEFAULT 'new',
  priority lead_priority_enum NOT NULL DEFAULT 'normal',
  assigned_to_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  dni_ciphertext TEXT,
  dni_hash TEXT,
  dni_last4 TEXT,
  discard_reason_id UUID REFERENCES public.discard_reasons(id) ON DELETE RESTRICT,
  closed_at TIMESTAMPTZ,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT leads_attempt_count_nonnegative CHECK (attempt_count >= 0),
  CONSTRAINT leads_dni_last4_format CHECK (dni_last4 IS NULL OR dni_last4 ~ '^[0-9]{1,4}$'),
  CONSTRAINT leads_closed_state_consistent CHECK (
    (status IN ('won', 'discarded') AND closed_at IS NOT NULL)
    OR (status NOT IN ('won', 'discarded') AND closed_at IS NULL)
  ),
  CONSTRAINT leads_discard_reason_consistent CHECK (
    (status = 'discarded' AND discard_reason_id IS NOT NULL)
    OR (status <> 'discarded' AND discard_reason_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.lead_activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  channel lead_activity_channel_enum NOT NULL,
  result lead_activity_result_enum NOT NULL,
  attempt_number INTEGER,
  note TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lead_activities_attempt_positive CHECK (attempt_number IS NULL OR attempt_number > 0),
  CONSTRAINT lead_activities_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE TABLE IF NOT EXISTS public.lead_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  assigned_to_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status lead_task_status_enum NOT NULL DEFAULT 'pending',
  due_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lead_tasks_completion_consistent CHECK (
    (status = 'completed' AND completed_at IS NOT NULL)
    OR (status <> 'completed' AND completed_at IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.inbound_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  status inbound_event_status_enum NOT NULL DEFAULT 'received',
  payload_redacted JSONB NOT NULL DEFAULT '{}'::JSONB,
  payload_ciphertext TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  last_error_message TEXT,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, provider, external_event_id),
  CONSTRAINT inbound_events_attempt_nonnegative CHECK (attempt_count >= 0),
  CONSTRAINT inbound_events_payload_object CHECK (jsonb_typeof(payload_redacted) = 'object')
);

CREATE TABLE IF NOT EXISTS public.lead_duplicate_matches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  matched_lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
  matched_contact_id UUID REFERENCES public.contacts(id) ON DELETE CASCADE,
  match_type lead_duplicate_match_type_enum NOT NULL,
  confidence NUMERIC(5,4),
  reviewed_at TIMESTAMPTZ,
  reviewed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lead_duplicate_not_self CHECK (matched_lead_id IS NULL OR matched_lead_id <> lead_id),
  CONSTRAINT lead_duplicate_target CHECK (matched_lead_id IS NOT NULL OR matched_contact_id IS NOT NULL),
  CONSTRAINT lead_duplicate_confidence_range CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1)
);

CREATE INDEX IF NOT EXISTS idx_discard_reasons_account_active
  ON public.discard_reasons(account_id, is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_leads_account_status_received
  ON public.leads(account_id, status, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_account_assignee_status
  ON public.leads(account_id, assigned_to_user_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_contact ON public.leads(contact_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_account_phone_lookup ON public.leads(account_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_leads_account_dni_hash
  ON public.leads(account_id, dni_hash) WHERE dni_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_external_idempotency
  ON public.leads(account_id, source, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lead_activities_timeline
  ON public.lead_activities(account_id, lead_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_tasks_due
  ON public.lead_tasks(account_id, status, due_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_tasks_one_pending
  ON public.lead_tasks(lead_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_inbound_events_failed
  ON public.inbound_events(account_id, status, received_at) WHERE status = 'failed';
CREATE INDEX IF NOT EXISTS idx_duplicate_matches_review
  ON public.lead_duplicate_matches(account_id, reviewed_at) WHERE reviewed_at IS NULL;

DROP TRIGGER IF EXISTS set_updated_at ON public.discard_reasons;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.discard_reasons
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS set_updated_at ON public.leads;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS set_updated_at ON public.lead_tasks;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.lead_tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS set_updated_at ON public.inbound_events;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.inbound_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.validate_lead_tenant_links()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = NEW.contact_id AND c.account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'lead contact must belong to the same account' USING ERRCODE = '23514';
  END IF;
  IF NEW.assigned_to_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = NEW.assigned_to_user_id AND p.account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'lead assignee must belong to the same account' USING ERRCODE = '23514';
  END IF;
  IF NEW.discard_reason_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.discard_reasons dr
    WHERE dr.id = NEW.discard_reason_id AND dr.account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'discard reason must belong to the same account' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_lead_tenant_links ON public.leads;
CREATE TRIGGER validate_lead_tenant_links
  BEFORE INSERT OR UPDATE OF account_id, contact_id, assigned_to_user_id, discard_reason_id
  ON public.leads FOR EACH ROW EXECUTE FUNCTION public.validate_lead_tenant_links();

CREATE OR REPLACE FUNCTION public.validate_lead_child_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = NEW.lead_id AND l.account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'lead child row must belong to the lead account' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'lead_tasks' THEN
    IF NEW.assigned_to_user_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = NEW.assigned_to_user_id AND p.account_id = NEW.account_id
    ) THEN
      RAISE EXCEPTION 'task assignee must belong to the same account' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_lead_activity_tenant ON public.lead_activities;
CREATE TRIGGER validate_lead_activity_tenant
  BEFORE INSERT OR UPDATE OF account_id, lead_id
  ON public.lead_activities FOR EACH ROW EXECUTE FUNCTION public.validate_lead_child_tenant();
DROP TRIGGER IF EXISTS validate_lead_task_tenant ON public.lead_tasks;
CREATE TRIGGER validate_lead_task_tenant
  BEFORE INSERT OR UPDATE OF account_id, lead_id, assigned_to_user_id
  ON public.lead_tasks FOR EACH ROW EXECUTE FUNCTION public.validate_lead_child_tenant();

CREATE OR REPLACE FUNCTION public.assert_open_lead_has_pending_task()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_lead_id UUID;
  v_status lead_status_enum;
  v_pending_count INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'leads' THEN
    v_lead_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    v_lead_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.lead_id ELSE NEW.lead_id END;
  END IF;

  SELECT status INTO v_status FROM public.leads WHERE id = v_lead_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COUNT(*) INTO v_pending_count
  FROM public.lead_tasks
  WHERE lead_id = v_lead_id AND status = 'pending';

  IF v_status IN ('new', 'in_progress', 'follow_up') AND v_pending_count <> 1 THEN
    RAISE EXCEPTION 'open lead % must have exactly one pending task (found %)', v_lead_id, v_pending_count
      USING ERRCODE = '23514';
  END IF;
  IF v_status IN ('won', 'discarded') AND v_pending_count <> 0 THEN
    RAISE EXCEPTION 'closed lead % cannot have pending tasks', v_lead_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS leads_pending_task_invariant ON public.leads;
CREATE CONSTRAINT TRIGGER leads_pending_task_invariant
  AFTER INSERT OR UPDATE OR DELETE ON public.leads
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_open_lead_has_pending_task();
DROP TRIGGER IF EXISTS lead_tasks_pending_task_invariant ON public.lead_tasks;
CREATE CONSTRAINT TRIGGER lead_tasks_pending_task_invariant
  AFTER INSERT OR UPDATE OR DELETE ON public.lead_tasks
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_open_lead_has_pending_task();

ALTER TABLE public.discard_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_duplicate_matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS discard_reasons_select ON public.discard_reasons;
DROP POLICY IF EXISTS discard_reasons_insert ON public.discard_reasons;
DROP POLICY IF EXISTS discard_reasons_update ON public.discard_reasons;
DROP POLICY IF EXISTS discard_reasons_delete ON public.discard_reasons;
DROP POLICY IF EXISTS leads_select ON public.leads;
DROP POLICY IF EXISTS leads_insert ON public.leads;
DROP POLICY IF EXISTS leads_update ON public.leads;
DROP POLICY IF EXISTS leads_delete ON public.leads;
DROP POLICY IF EXISTS lead_activities_select ON public.lead_activities;
DROP POLICY IF EXISTS lead_activities_insert ON public.lead_activities;
DROP POLICY IF EXISTS lead_tasks_select ON public.lead_tasks;
DROP POLICY IF EXISTS lead_tasks_insert ON public.lead_tasks;
DROP POLICY IF EXISTS lead_tasks_update ON public.lead_tasks;
DROP POLICY IF EXISTS lead_tasks_delete ON public.lead_tasks;
DROP POLICY IF EXISTS inbound_events_select ON public.inbound_events;
DROP POLICY IF EXISTS lead_duplicate_matches_select ON public.lead_duplicate_matches;
DROP POLICY IF EXISTS lead_duplicate_matches_insert ON public.lead_duplicate_matches;
DROP POLICY IF EXISTS lead_duplicate_matches_update ON public.lead_duplicate_matches;

CREATE POLICY discard_reasons_select ON public.discard_reasons FOR SELECT
  USING (public.has_account_access(account_id));
CREATE POLICY discard_reasons_insert ON public.discard_reasons FOR INSERT
  WITH CHECK (public.has_account_access(account_id, 'admin'));
CREATE POLICY discard_reasons_update ON public.discard_reasons FOR UPDATE
  USING (public.has_account_access(account_id, 'admin'))
  WITH CHECK (public.has_account_access(account_id, 'admin'));
CREATE POLICY discard_reasons_delete ON public.discard_reasons FOR DELETE
  USING (public.has_account_access(account_id, 'admin'));

CREATE POLICY leads_select ON public.leads FOR SELECT
  USING (public.has_account_access(account_id));
CREATE POLICY leads_insert ON public.leads FOR INSERT
  WITH CHECK (public.has_account_access(account_id, 'agent'));
CREATE POLICY leads_update ON public.leads FOR UPDATE
  USING (public.has_account_access(account_id, 'agent'))
  WITH CHECK (public.has_account_access(account_id, 'agent'));
CREATE POLICY leads_delete ON public.leads FOR DELETE
  USING (public.has_account_access(account_id, 'admin'));

CREATE POLICY lead_activities_select ON public.lead_activities FOR SELECT
  USING (public.has_account_access(account_id));
CREATE POLICY lead_activities_insert ON public.lead_activities FOR INSERT
  WITH CHECK (public.has_account_access(account_id, 'agent'));

CREATE POLICY lead_tasks_select ON public.lead_tasks FOR SELECT
  USING (public.has_account_access(account_id));
CREATE POLICY lead_tasks_insert ON public.lead_tasks FOR INSERT
  WITH CHECK (public.has_account_access(account_id, 'agent'));
CREATE POLICY lead_tasks_update ON public.lead_tasks FOR UPDATE
  USING (public.has_account_access(account_id, 'agent'))
  WITH CHECK (public.has_account_access(account_id, 'agent'));
CREATE POLICY lead_tasks_delete ON public.lead_tasks FOR DELETE
  USING (public.has_account_access(account_id, 'admin'));

CREATE POLICY inbound_events_select ON public.inbound_events FOR SELECT
  USING (public.has_account_access(account_id, 'admin'));

CREATE POLICY lead_duplicate_matches_select ON public.lead_duplicate_matches FOR SELECT
  USING (public.has_account_access(account_id, 'agent'));
CREATE POLICY lead_duplicate_matches_insert ON public.lead_duplicate_matches FOR INSERT
  WITH CHECK (public.has_account_access(account_id, 'agent'));
CREATE POLICY lead_duplicate_matches_update ON public.lead_duplicate_matches FOR UPDATE
  USING (public.has_account_access(account_id, 'agent'))
  WITH CHECK (public.has_account_access(account_id, 'agent'));

-- Operational history and the open-lead/task invariant must only be
-- mutated through the SECURITY DEFINER workflow functions below. RLS
-- still scopes reads, while service_role retains ingestion access.
REVOKE ALL ON public.leads, public.lead_activities, public.lead_tasks, public.inbound_events
  FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.leads, public.lead_activities, public.lead_tasks, public.inbound_events
  FROM authenticated;
GRANT SELECT ON public.leads, public.lead_activities, public.lead_tasks, public.inbound_events
  TO authenticated;

CREATE OR REPLACE FUNCTION public.create_lead_with_initial_task(
  p_account_id UUID,
  p_contact_id UUID,
  p_source TEXT DEFAULT 'manual',
  p_external_id TEXT DEFAULT NULL,
  p_received_at TIMESTAMPTZ DEFAULT NOW(),
  p_assigned_to_user_id UUID DEFAULT NULL,
  p_next_follow_up_at TIMESTAMPTZ DEFAULT NOW(),
  p_campaign_id TEXT DEFAULT NULL,
  p_campaign_name TEXT DEFAULT NULL,
  p_form_id TEXT DEFAULT NULL,
  p_form_name TEXT DEFAULT NULL,
  p_company TEXT DEFAULT NULL,
  p_plan TEXT DEFAULT NULL,
  p_priority lead_priority_enum DEFAULT 'normal'
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead_id UUID;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.has_account_access(p_account_id, 'agent')) THEN
    RAISE EXCEPTION 'insufficient lead permissions' USING ERRCODE = '42501';
  END IF;
  IF p_next_follow_up_at IS NULL THEN
    RAISE EXCEPTION 'an open lead requires a next follow-up' USING ERRCODE = '23514';
  END IF;

  IF p_external_id IS NOT NULL THEN
    SELECT id INTO v_lead_id
    FROM public.leads
    WHERE account_id = p_account_id
      AND source = COALESCE(NULLIF(p_source, ''), 'manual')
      AND external_id = p_external_id;
    IF FOUND THEN
      RETURN v_lead_id;
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.leads (
      account_id, contact_id, source, external_id, received_at,
      assigned_to_user_id, campaign_id, campaign_name, form_id, form_name,
      company, plan, priority, created_by_user_id
    ) VALUES (
      p_account_id, p_contact_id, COALESCE(NULLIF(p_source, ''), 'manual'), p_external_id,
      COALESCE(p_received_at, NOW()), p_assigned_to_user_id, p_campaign_id,
      p_campaign_name, p_form_id, p_form_name, p_company, p_plan, p_priority,
      auth.uid()
    )
    RETURNING id INTO v_lead_id;
  EXCEPTION WHEN unique_violation THEN
    IF p_external_id IS NULL THEN
      RAISE;
    END IF;
    SELECT id INTO v_lead_id
    FROM public.leads
    WHERE account_id = p_account_id
      AND source = COALESCE(NULLIF(p_source, ''), 'manual')
      AND external_id = p_external_id;
    IF v_lead_id IS NULL THEN
      RAISE;
    END IF;
    RETURN v_lead_id;
  END;

  INSERT INTO public.lead_tasks (
    account_id, lead_id, assigned_to_user_id, due_at, created_by_user_id
  ) VALUES (
    p_account_id, v_lead_id, p_assigned_to_user_id, p_next_follow_up_at, auth.uid()
  )
  ON CONFLICT (lead_id) WHERE status = 'pending' DO NOTHING;

  RETURN v_lead_id;
END;
$$;

ALTER FUNCTION public.create_lead_with_initial_task(
  UUID, UUID, TEXT, TEXT, TIMESTAMPTZ, UUID, TIMESTAMPTZ,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, lead_priority_enum
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_lead_with_initial_task(
  UUID, UUID, TEXT, TEXT, TIMESTAMPTZ, UUID, TIMESTAMPTZ,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, lead_priority_enum
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_lead_with_initial_task(
  UUID, UUID, TEXT, TEXT, TIMESTAMPTZ, UUID, TIMESTAMPTZ,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, lead_priority_enum
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_lead_result(
  p_lead_id UUID,
  p_channel lead_activity_channel_enum,
  p_result lead_activity_result_enum,
  p_note TEXT DEFAULT NULL,
  p_next_follow_up_at TIMESTAMPTZ DEFAULT NULL,
  p_discard_reason_id UUID DEFAULT NULL,
  p_assigned_to_user_id UUID DEFAULT NULL
) RETURNS public.leads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead public.leads;
  v_attempt_number INTEGER;
  v_is_attempt BOOLEAN;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lead not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (auth.role() = 'service_role' OR public.has_account_access(v_lead.account_id, 'agent')) THEN
    RAISE EXCEPTION 'insufficient lead permissions' USING ERRCODE = '42501';
  END IF;
  IF v_lead.status IN ('won', 'discarded') THEN
    RAISE EXCEPTION 'closed leads cannot receive operational results' USING ERRCODE = '23514';
  END IF;

  IF p_result = 'discarded' AND p_discard_reason_id IS NULL THEN
    RAISE EXCEPTION 'discarded result requires a discard reason' USING ERRCODE = '23514';
  END IF;
  IF p_result IN ('no_answer', 'contacted', 'qualified', 'rescheduled')
     AND p_next_follow_up_at IS NULL THEN
    RAISE EXCEPTION 'open result requires a next follow-up' USING ERRCODE = '23514';
  END IF;

  IF p_result = 'note' THEN
    INSERT INTO public.lead_activities (
      account_id, lead_id, channel, result, note, actor_user_id
    ) VALUES (
      v_lead.account_id, v_lead.id, p_channel, p_result, p_note, auth.uid()
    );
    RETURN v_lead;
  END IF;

  IF p_result = 'assigned' THEN
    IF p_assigned_to_user_id IS NULL THEN
      RAISE EXCEPTION 'assigned result requires an assignee' USING ERRCODE = '23514';
    END IF;
    UPDATE public.leads
    SET assigned_to_user_id = p_assigned_to_user_id
    WHERE id = v_lead.id
    RETURNING * INTO v_lead;
    UPDATE public.lead_tasks
    SET assigned_to_user_id = p_assigned_to_user_id
    WHERE lead_id = v_lead.id AND status = 'pending';
    INSERT INTO public.lead_activities (
      account_id, lead_id, channel, result, note, actor_user_id
    ) VALUES (
      v_lead.account_id, v_lead.id, p_channel, p_result, p_note, auth.uid()
    );
    RETURN v_lead;
  END IF;

  v_is_attempt := p_result IN ('no_answer', 'contacted', 'qualified', 'won', 'discarded');
  v_attempt_number := CASE WHEN v_is_attempt THEN v_lead.attempt_count + 1 ELSE NULL END;

  UPDATE public.lead_tasks
  SET status = CASE
        WHEN p_result IN ('won', 'discarded') THEN 'cancelled'::lead_task_status_enum
        ELSE 'completed'::lead_task_status_enum
      END,
      completed_at = CASE WHEN p_result IN ('won', 'discarded') THEN NULL ELSE NOW() END
  WHERE lead_id = v_lead.id AND status = 'pending';

  UPDATE public.leads
  SET status = CASE p_result
        WHEN 'no_answer' THEN 'follow_up'::lead_status_enum
        WHEN 'contacted' THEN 'in_progress'::lead_status_enum
        WHEN 'qualified' THEN 'follow_up'::lead_status_enum
        WHEN 'rescheduled' THEN 'follow_up'::lead_status_enum
        WHEN 'won' THEN 'won'::lead_status_enum
        WHEN 'discarded' THEN 'discarded'::lead_status_enum
        WHEN 'assigned' THEN status
        ELSE status
      END,
      attempt_count = attempt_count + CASE WHEN v_is_attempt THEN 1 ELSE 0 END,
      assigned_to_user_id = COALESCE(p_assigned_to_user_id, assigned_to_user_id),
      discard_reason_id = CASE WHEN p_result = 'discarded' THEN p_discard_reason_id ELSE NULL END,
      closed_at = CASE WHEN p_result IN ('won', 'discarded') THEN NOW() ELSE NULL END
  WHERE id = v_lead.id
  RETURNING * INTO v_lead;

  INSERT INTO public.lead_activities (
    account_id, lead_id, channel, result, attempt_number, note, actor_user_id
  ) VALUES (
    v_lead.account_id, v_lead.id, p_channel, p_result,
    v_attempt_number, p_note, auth.uid()
  );

  IF v_lead.status IN ('new', 'in_progress', 'follow_up') THEN
    INSERT INTO public.lead_tasks (
      account_id, lead_id, assigned_to_user_id, due_at, created_by_user_id
    ) VALUES (
      v_lead.account_id, v_lead.id, v_lead.assigned_to_user_id,
      p_next_follow_up_at, auth.uid()
    );
  END IF;

  RETURN v_lead;
END;
$$;

ALTER FUNCTION public.record_lead_result(
  UUID, lead_activity_channel_enum, lead_activity_result_enum,
  TEXT, TIMESTAMPTZ, UUID, UUID
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_lead_result(
  UUID, lead_activity_channel_enum, lead_activity_result_enum,
  TEXT, TIMESTAMPTZ, UUID, UUID
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_lead_result(
  UUID, lead_activity_channel_enum, lead_activity_result_enum,
  TEXT, TIMESTAMPTZ, UUID, UUID
) TO authenticated, service_role;

-- Seed structured reasons for every existing account.
INSERT INTO public.discard_reasons (account_id, name, code, sort_order)
SELECT a.id, seed.name, seed.code, seed.sort_order
FROM public.accounts a
CROSS JOIN (VALUES
  ('No le interesa', 'not_interested', 10),
  ('Sin respuesta', 'no_response', 20),
  ('Datos incorrectos', 'invalid_data', 30),
  ('Fuera de zona', 'out_of_area', 40),
  ('Otro', 'other', 100)
) AS seed(name, code, sort_order)
ON CONFLICT (account_id, code) DO NOTHING;

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

  INSERT INTO public.discard_reasons (account_id, name, code, sort_order)
  VALUES
    (NEW.id, 'No le interesa', 'not_interested', 10),
    (NEW.id, 'Sin respuesta', 'no_response', 20),
    (NEW.id, 'Datos incorrectos', 'invalid_data', 30),
    (NEW.id, 'Fuera de zona', 'out_of_area', 40),
    (NEW.id, 'Otro', 'other', 100)
  ON CONFLICT (account_id, code) DO NOTHING;
  RETURN NEW;
END;
$$;

COMMENT ON COLUMN public.leads.dni_ciphertext IS
  'Application-encrypted DNI only. Never store or log plaintext DNI.';
COMMENT ON COLUMN public.inbound_events.payload_redacted IS
  'Safe diagnostic subset only; secrets and complete DNI values must be removed.';
COMMENT ON COLUMN public.inbound_events.payload_ciphertext IS
  'Optional application-encrypted raw payload for controlled replay.';
