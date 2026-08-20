\set ON_ERROR_STOP on
BEGIN;

SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('role', 'service_role', true);

CREATE OR REPLACE FUNCTION pg_temp.assert_true(ok BOOLEAN, message TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN IF NOT ok THEN RAISE EXCEPTION 'assertion failed: %', message; END IF; END $$;

DO $$
DECLARE
  v_account UUID;
  v_event UUID;
  v_first JSONB;
  v_second JSONB;
BEGIN
  SELECT id INTO v_account FROM public.accounts ORDER BY created_at LIMIT 1;
  IF v_account IS NULL THEN RAISE EXCEPTION 'test requires an account'; END IF;

  SELECT id INTO v_event FROM public.register_inbound_lead_event(v_account, 'phase3-test', 'event-idempotent-001', '{"safe":"fixture"}');
  v_first := public.process_inbound_lead_event(v_account, v_event,
    '{"phone":"+5491100004242","name":"Fixture Intake"}',
    '{"source":"phase3-test","external_id":"lead-idempotent-001","next_follow_up_at":"2026-08-21T12:00:00Z"}');
  v_second := public.process_inbound_lead_event(v_account, v_event,
    '{"phone":"+5491100004242","name":"Ignored Retry"}',
    '{"source":"phase3-test","external_id":"lead-idempotent-001","next_follow_up_at":"2026-08-22T12:00:00Z"}');

  PERFORM pg_temp.assert_true(v_first->>'lead_id' = v_second->>'lead_id', 'retry must return same lead');
  PERFORM pg_temp.assert_true((v_second->>'duplicate')::boolean, 'retry must be marked duplicate');
  PERFORM pg_temp.assert_true((SELECT count(*) = 1 FROM public.inbound_events WHERE account_id=v_account AND provider='phase3-test' AND external_event_id='event-idempotent-001'), 'one inbound event');
  PERFORM pg_temp.assert_true((SELECT count(*) = 1 FROM public.leads WHERE id=(v_first->>'lead_id')::uuid), 'one lead');
  PERFORM pg_temp.assert_true((SELECT count(*) = 1 FROM public.lead_tasks WHERE lead_id=(v_first->>'lead_id')::uuid AND status='pending'), 'one next task');
  PERFORM pg_temp.assert_true((SELECT count(*) = 1 FROM public.domain_events WHERE account_id=v_account AND event_key='lead.created:' || (v_first->>'lead_id')), 'one outbox event');
END $$;

ROLLBACK;
