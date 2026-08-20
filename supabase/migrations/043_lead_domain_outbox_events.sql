-- 043 — Emit provider-neutral lead lifecycle events in the same
-- transaction as domain changes, and restrict assignees to operators.

CREATE OR REPLACE FUNCTION public.validate_lead_tenant_links()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id=NEW.contact_id AND c.account_id=NEW.account_id) THEN
    RAISE EXCEPTION 'lead contact must belong to the same account' USING ERRCODE='23514';
  END IF;
  IF NEW.assigned_to_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.user_id=NEW.assigned_to_user_id
      AND p.account_id=NEW.account_id AND p.account_role IN ('owner','admin','agent')
  ) THEN RAISE EXCEPTION 'lead assignee must be an operator in the same account' USING ERRCODE='23514'; END IF;
  IF NEW.discard_reason_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.discard_reasons d WHERE d.id=NEW.discard_reason_id AND d.account_id=NEW.account_id
  ) THEN RAISE EXCEPTION 'discard reason must belong to the same account' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.validate_lead_child_tenant()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.id=NEW.lead_id AND l.account_id=NEW.account_id) THEN
    RAISE EXCEPTION 'lead child row must belong to the lead account' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='lead_tasks' THEN
    IF NEW.assigned_to_user_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.user_id=NEW.assigned_to_user_id
        AND p.account_id=NEW.account_id AND p.account_role IN ('owner','admin','agent')
    ) THEN RAISE EXCEPTION 'task assignee must be an operator in the same account' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.emit_lead_created_event()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  INSERT INTO public.domain_events(account_id,event_key,event_type,aggregate_type,aggregate_id,payload)
  VALUES(NEW.account_id,'lead.created:'||NEW.id,'lead.created','lead',NEW.id,
    jsonb_build_object('lead_id',NEW.id,'contact_id',NEW.contact_id,'source',NEW.source))
  ON CONFLICT(account_id,event_key) DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS emit_lead_created_event ON public.leads;
CREATE TRIGGER emit_lead_created_event AFTER INSERT ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.emit_lead_created_event();

CREATE OR REPLACE FUNCTION public.emit_lead_activity_events()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_type TEXT;
BEGIN
  INSERT INTO public.domain_events(account_id,event_key,event_type,aggregate_type,aggregate_id,payload)
  VALUES(NEW.account_id,'lead.result_recorded:'||NEW.id,'lead.result_recorded','lead',NEW.lead_id,
    jsonb_build_object('lead_id',NEW.lead_id,'activity_id',NEW.id,'channel',NEW.channel,'result',NEW.result,'occurred_at',NEW.occurred_at));

  v_type := CASE NEW.result WHEN 'assigned' THEN 'lead.assigned' WHEN 'won' THEN 'lead.won'
    WHEN 'discarded' THEN 'lead.discarded' ELSE NULL END;
  IF v_type IS NOT NULL THEN
    INSERT INTO public.domain_events(account_id,event_key,event_type,aggregate_type,aggregate_id,payload)
    VALUES(NEW.account_id,v_type||':'||NEW.id,v_type,'lead',NEW.lead_id,
      jsonb_build_object('lead_id',NEW.lead_id,'activity_id',NEW.id,'occurred_at',NEW.occurred_at));
  END IF;

  IF NEW.result IN ('no_answer','contacted','qualified','rescheduled') THEN
    INSERT INTO public.domain_events(account_id,event_key,event_type,aggregate_type,aggregate_id,payload)
    VALUES(NEW.account_id,'lead.follow_up_scheduled:'||NEW.id,'lead.follow_up_scheduled','lead',NEW.lead_id,
      jsonb_build_object('lead_id',NEW.lead_id,'activity_id',NEW.id,'result',NEW.result));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS emit_lead_activity_events ON public.lead_activities;
CREATE TRIGGER emit_lead_activity_events AFTER INSERT ON public.lead_activities
  FOR EACH ROW EXECUTE FUNCTION public.emit_lead_activity_events();
