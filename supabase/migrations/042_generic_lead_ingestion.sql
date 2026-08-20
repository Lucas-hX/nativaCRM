-- ============================================================
-- 042 — Provider-neutral lead ingestion and transactional outbox.
-- Registration and processing are deliberately separate commits so
-- malformed/provider failures remain auditable and retryable.
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'domain_event_status_enum') THEN
    CREATE TYPE domain_event_status_enum AS ENUM ('pending', 'published', 'failed');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.domain_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id UUID NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status domain_event_status_enum NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, event_key),
  CONSTRAINT domain_events_payload_object CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT domain_events_attempt_nonnegative CHECK (attempt_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_domain_events_dispatch
  ON public.domain_events(status, available_at, created_at) WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS idx_domain_events_account_type
  ON public.domain_events(account_id, event_type, created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at ON public.domain_events;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.domain_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.domain_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS domain_events_select ON public.domain_events;
CREATE POLICY domain_events_select ON public.domain_events FOR SELECT
  USING (public.has_account_access(account_id, 'admin'));
REVOKE ALL ON public.domain_events FROM anon, authenticated;
GRANT SELECT ON public.domain_events TO authenticated;

CREATE OR REPLACE FUNCTION public.register_inbound_lead_event(
  p_account_id UUID,
  p_provider TEXT,
  p_external_event_id TEXT,
  p_payload_redacted JSONB DEFAULT '{}'::jsonb
) RETURNS public.inbound_events
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event public.inbound_events;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_provider), '') IS NULL OR NULLIF(btrim(p_external_event_id), '') IS NULL THEN
    RAISE EXCEPTION 'provider and external event id are required' USING ERRCODE = '22023';
  END IF;
  IF p_payload_redacted IS NULL OR jsonb_typeof(p_payload_redacted) <> 'object' THEN
    RAISE EXCEPTION 'redacted payload must be an object' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.inbound_events(account_id, provider, external_event_id, payload_redacted)
  VALUES (p_account_id, lower(btrim(p_provider)), btrim(p_external_event_id), p_payload_redacted)
  ON CONFLICT (account_id, provider, external_event_id) DO NOTHING;

  SELECT * INTO v_event FROM public.inbound_events
  WHERE account_id = p_account_id AND provider = lower(btrim(p_provider))
    AND external_event_id = btrim(p_external_event_id);
  RETURN v_event;
END $$;

CREATE OR REPLACE FUNCTION public.process_inbound_lead_event(
  p_account_id UUID,
  p_event_id UUID,
  p_contact JSONB,
  p_opportunity JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_event public.inbound_events;
  v_contact_id UUID;
  v_audit_user UUID;
  v_lead_id UUID;
  v_phone TEXT;
  v_phone_normalized TEXT;
  v_prior_lead UUID;
  v_created_contact BOOLEAN := FALSE;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_contact) <> 'object' OR jsonb_typeof(p_opportunity) <> 'object' THEN
    RAISE EXCEPTION 'contact and opportunity must be objects' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_event FROM public.inbound_events
  WHERE id = p_event_id AND account_id = p_account_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'inbound event not found' USING ERRCODE = 'P0002'; END IF;
  IF v_event.status = 'processed' THEN
    RETURN jsonb_build_object('event_id', v_event.id, 'lead_id', v_event.lead_id,
      'contact_id', (SELECT contact_id FROM public.leads WHERE id = v_event.lead_id),
      'duplicate', TRUE, 'contact_created', FALSE);
  END IF;

  v_phone := btrim(COALESCE(p_contact->>'phone', ''));
  v_phone_normalized := regexp_replace(v_phone, '\D', '', 'g');
  IF v_phone_normalized = '' THEN RAISE EXCEPTION 'valid contact phone is required' USING ERRCODE = '22023'; END IF;

  UPDATE public.inbound_events SET status = 'processing', attempt_count = attempt_count + 1,
    last_error_code = NULL, last_error_message = NULL WHERE id = v_event.id;

  SELECT owner_user_id INTO v_audit_user FROM public.accounts WHERE id = p_account_id;
  IF v_audit_user IS NULL THEN RAISE EXCEPTION 'account owner not found' USING ERRCODE = 'P0002'; END IF;

  SELECT id INTO v_contact_id FROM public.contacts
  WHERE account_id = p_account_id AND phone_normalized = v_phone_normalized FOR UPDATE;
  IF v_contact_id IS NULL THEN
    BEGIN
      INSERT INTO public.contacts(account_id, user_id, phone, name, email, company)
      VALUES (p_account_id, v_audit_user, v_phone,
        COALESCE(NULLIF(btrim(p_contact->>'name'), ''), v_phone),
        NULLIF(btrim(p_contact->>'email'), ''), NULLIF(btrim(p_contact->>'company'), ''))
      RETURNING id INTO v_contact_id;
      v_created_contact := TRUE;
    EXCEPTION WHEN unique_violation THEN
      SELECT id INTO v_contact_id FROM public.contacts
      WHERE account_id = p_account_id AND phone_normalized = v_phone_normalized;
    END;
  ELSE
    UPDATE public.contacts SET
      name = CASE WHEN (name IS NULL OR name = '' OR name = phone) THEN COALESCE(NULLIF(btrim(p_contact->>'name'), ''), name) ELSE name END,
      email = COALESCE(email, NULLIF(btrim(p_contact->>'email'), '')),
      company = COALESCE(company, NULLIF(btrim(p_contact->>'company'), ''))
    WHERE id = v_contact_id;
  END IF;

  SELECT id INTO v_prior_lead FROM public.leads
  WHERE account_id = p_account_id AND contact_id = v_contact_id
  ORDER BY received_at DESC LIMIT 1;

  v_lead_id := public.create_lead_with_initial_task(
    p_account_id, v_contact_id,
    COALESCE(NULLIF(p_opportunity->>'source', ''), v_event.provider),
    COALESCE(NULLIF(p_opportunity->>'external_id', ''), v_event.external_event_id),
    COALESCE((p_opportunity->>'received_at')::timestamptz, v_event.received_at),
    NULLIF(p_opportunity->>'assigned_to_user_id', '')::uuid,
    COALESCE((p_opportunity->>'next_follow_up_at')::timestamptz, NOW()),
    NULLIF(p_opportunity->>'campaign_id', ''), NULLIF(p_opportunity->>'campaign_name', ''),
    NULLIF(p_opportunity->>'form_id', ''), NULLIF(p_opportunity->>'form_name', ''),
    COALESCE(NULLIF(p_opportunity->>'company', ''), NULLIF(p_contact->>'company', '')),
    NULLIF(p_opportunity->>'plan', ''),
    COALESCE(NULLIF(p_opportunity->>'priority', '')::lead_priority_enum, 'normal'::lead_priority_enum)
  );

  IF v_prior_lead IS NOT NULL AND v_prior_lead <> v_lead_id THEN
    INSERT INTO public.lead_duplicate_matches(account_id, lead_id, matched_lead_id, match_type, confidence)
    VALUES (p_account_id, v_lead_id, v_prior_lead, 'phone', 1)
    ON CONFLICT DO NOTHING;
  END IF;

  UPDATE public.inbound_events SET status = 'processed', lead_id = v_lead_id,
    processed_at = NOW(), last_error_code = NULL, last_error_message = NULL
  WHERE id = v_event.id;

  INSERT INTO public.domain_events(account_id, event_key, event_type, aggregate_type, aggregate_id, payload)
  VALUES (p_account_id, 'lead.created:' || v_lead_id, 'lead.created', 'lead', v_lead_id,
    jsonb_build_object('lead_id', v_lead_id, 'contact_id', v_contact_id, 'source',
      COALESCE(NULLIF(p_opportunity->>'source', ''), v_event.provider), 'inbound_event_id', v_event.id))
  ON CONFLICT (account_id, event_key) DO NOTHING;

  RETURN jsonb_build_object('event_id', v_event.id, 'lead_id', v_lead_id,
    'contact_id', v_contact_id, 'duplicate', FALSE, 'contact_created', v_created_contact);
END $$;

CREATE OR REPLACE FUNCTION public.fail_inbound_lead_event(
  p_account_id UUID, p_event_id UUID, p_error_code TEXT, p_error_message TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE = '42501'; END IF;
  UPDATE public.inbound_events SET status = 'failed',
    last_error_code = left(COALESCE(NULLIF(p_error_code, ''), 'processing_error'), 100),
    last_error_message = left(COALESCE(NULLIF(p_error_message, ''), 'Lead ingestion failed'), 1000)
  WHERE id = p_event_id AND account_id = p_account_id AND status <> 'processed';
END $$;

REVOKE ALL ON FUNCTION public.register_inbound_lead_event(UUID,TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_inbound_lead_event(UUID,UUID,JSONB,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_inbound_lead_event(UUID,UUID,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_inbound_lead_event(UUID,TEXT,TEXT,JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.process_inbound_lead_event(UUID,UUID,JSONB,JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_inbound_lead_event(UUID,UUID,TEXT,TEXT) TO service_role;

COMMENT ON TABLE public.domain_events IS 'Transactional outbox for provider-neutral domain events.';
