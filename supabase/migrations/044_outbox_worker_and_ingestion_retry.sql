-- 044 — Durable outbox claiming/backoff and encrypted ingestion retry payload.

ALTER TYPE domain_event_status_enum ADD VALUE IF NOT EXISTS 'processing';

DROP FUNCTION IF EXISTS public.register_inbound_lead_event(UUID,TEXT,TEXT,JSONB);
CREATE OR REPLACE FUNCTION public.register_inbound_lead_event(
  p_account_id UUID, p_provider TEXT, p_external_event_id TEXT,
  p_payload_redacted JSONB DEFAULT '{}'::jsonb, p_payload_ciphertext TEXT DEFAULT NULL
) RETURNS public.inbound_events
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_event public.inbound_events;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
  IF NULLIF(btrim(p_provider),'') IS NULL OR NULLIF(btrim(p_external_event_id),'') IS NULL THEN RAISE EXCEPTION 'provider and external event id are required' USING ERRCODE='22023'; END IF;
  IF p_payload_redacted IS NULL OR jsonb_typeof(p_payload_redacted)<>'object' THEN RAISE EXCEPTION 'redacted payload must be an object' USING ERRCODE='22023'; END IF;
  INSERT INTO public.inbound_events(account_id,provider,external_event_id,payload_redacted,payload_ciphertext)
  VALUES(p_account_id,lower(btrim(p_provider)),btrim(p_external_event_id),p_payload_redacted,p_payload_ciphertext)
  ON CONFLICT(account_id,provider,external_event_id) DO UPDATE SET
    payload_ciphertext=CASE WHEN inbound_events.status='processed' THEN NULL ELSE COALESCE(inbound_events.payload_ciphertext,EXCLUDED.payload_ciphertext) END;
  SELECT * INTO v_event FROM public.inbound_events WHERE account_id=p_account_id
    AND provider=lower(btrim(p_provider)) AND external_event_id=btrim(p_external_event_id);
  RETURN v_event;
END $$;

-- Successful processing no longer needs replay material.
CREATE OR REPLACE FUNCTION public.clear_processed_inbound_ciphertext()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
BEGIN IF NEW.status='processed' THEN NEW.payload_ciphertext:=NULL; END IF; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS clear_processed_inbound_ciphertext ON public.inbound_events;
CREATE TRIGGER clear_processed_inbound_ciphertext BEFORE INSERT OR UPDATE OF status ON public.inbound_events
  FOR EACH ROW EXECUTE FUNCTION public.clear_processed_inbound_ciphertext();

CREATE OR REPLACE FUNCTION public.claim_domain_events(p_limit INTEGER DEFAULT 20, p_lease_seconds INTEGER DEFAULT 60)
RETURNS SETOF public.domain_events
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT id FROM public.domain_events
    WHERE (status='pending' OR status='failed' OR (status='processing' AND available_at<=NOW()))
      AND available_at<=NOW() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT LEAST(GREATEST(p_limit,1),100)
  )
  UPDATE public.domain_events e SET status='processing', attempt_count=e.attempt_count+1,
    available_at=NOW()+make_interval(secs=>LEAST(GREATEST(p_lease_seconds,10),600)), last_error_code=NULL
  FROM candidates c WHERE e.id=c.id RETURNING e.*;
END $$;

CREATE OR REPLACE FUNCTION public.complete_domain_event(p_event_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
  UPDATE public.domain_events SET status='published',published_at=NOW(),last_error_code=NULL WHERE id=p_event_id AND status='processing';
END $$;

CREATE OR REPLACE FUNCTION public.fail_domain_event(p_event_id UUID,p_error_code TEXT,p_backoff_seconds INTEGER)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
  UPDATE public.domain_events SET status='failed',last_error_code=left(COALESCE(NULLIF(p_error_code,''),'delivery_failed'),100),
    available_at=NOW()+make_interval(secs=>LEAST(GREATEST(p_backoff_seconds,5),86400))
  WHERE id=p_event_id AND status='processing';
END $$;

REVOKE ALL ON FUNCTION public.register_inbound_lead_event(UUID,TEXT,TEXT,JSONB,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_domain_events(INTEGER,INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_domain_event(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_domain_event(UUID,TEXT,INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_inbound_lead_event(UUID,TEXT,TEXT,JSONB,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_domain_events(INTEGER,INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_domain_event(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_domain_event(UUID,TEXT,INTEGER) TO service_role;
