\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(condition BOOLEAN, message TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'assertion failed: %', message;
  END IF;
END;
$$;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'phase2-owner@example.test', '', NOW(), '{"provider":"email"}', '{"full_name":"Phase 2 Owner"}', NOW(), NOW()),
  ('10000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'phase2-admin@example.test', '', NOW(), '{"provider":"email"}', '{"full_name":"Phase 2 Admin"}', NOW(), NOW()),
  ('10000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'phase2-agent@example.test', '', NOW(), '{"provider":"email"}', '{"full_name":"Phase 2 Agent"}', NOW(), NOW()),
  ('10000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'phase2-viewer@example.test', '', NOW(), '{"provider":"email"}', '{"full_name":"Phase 2 Viewer"}', NOW(), NOW()),
  ('10000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'phase2-platform@example.test', '', NOW(), '{"provider":"email"}', '{"full_name":"Phase 2 Platform"}', NOW(), NOW()),
  ('10000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'phase2-outsider@example.test', '', NOW(), '{"provider":"email"}', '{"full_name":"Phase 2 Outsider"}', NOW(), NOW());

SELECT account_id AS tenant_account_id
FROM public.profiles
WHERE user_id = '10000000-0000-4000-8000-000000000001'
\gset

-- Move admin/agent/viewer into the owner's tenant and delete the empty
-- personal accounts produced by the normal signup trigger.
UPDATE public.profiles
SET account_id = :'tenant_account_id'::UUID,
    account_role = CASE user_id
      WHEN '10000000-0000-4000-8000-000000000002' THEN 'admin'::account_role_enum
      WHEN '10000000-0000-4000-8000-000000000003' THEN 'agent'::account_role_enum
      WHEN '10000000-0000-4000-8000-000000000004' THEN 'viewer'::account_role_enum
      ELSE account_role
    END
WHERE user_id IN (
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000004'
);

DELETE FROM public.accounts
WHERE owner_user_id IN (
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000004'
);

INSERT INTO public.platform_admins(user_id)
VALUES ('10000000-0000-4000-8000-000000000005');

INSERT INTO public.contacts (user_id, account_id, phone, name)
VALUES (
  '10000000-0000-4000-8000-000000000001',
  :'tenant_account_id'::UUID,
  '+54 9 11 5555 0101',
  'Phase 2 Contact'
)
RETURNING id AS contact_id
\gset

SELECT set_config('test.tenant_account_id', :'tenant_account_id', TRUE);
SELECT set_config('test.contact_id', :'contact_id', TRUE);

-- Agent can create a lead only through the atomic operation. The lead
-- and its required pending task must commit as one unit.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', TRUE);
SELECT set_config('request.jwt.claim.role', 'authenticated', TRUE);

SELECT public.create_lead_with_initial_task(
  p_account_id => :'tenant_account_id'::UUID,
  p_contact_id => :'contact_id'::UUID,
  p_source => 'phase2-test',
  p_external_id => 'event-001',
  p_assigned_to_user_id => '10000000-0000-4000-8000-000000000003',
  p_next_follow_up_at => NOW() + INTERVAL '1 hour'
) AS lead_id
\gset
SELECT set_config('test.lead_id', :'lead_id', TRUE);

SELECT pg_temp.assert_true(
  (SELECT COUNT(*) = 1 FROM public.lead_tasks WHERE lead_id = :'lead_id'::UUID AND status = 'pending'),
  'new lead has exactly one pending task'
);

-- Idempotency returns the same lead and does not create a second task.
SELECT public.create_lead_with_initial_task(
  p_account_id => :'tenant_account_id'::UUID,
  p_contact_id => :'contact_id'::UUID,
  p_source => 'phase2-test',
  p_external_id => 'event-001',
  p_assigned_to_user_id => '10000000-0000-4000-8000-000000000003',
  p_next_follow_up_at => NOW() + INTERVAL '2 hours'
) AS duplicate_lead_id
\gset
SELECT pg_temp.assert_true(:'duplicate_lead_id'::UUID = :'lead_id'::UUID, 'idempotent create returns original lead');
SELECT pg_temp.assert_true(
  (SELECT COUNT(*) = 1 FROM public.leads WHERE account_id = :'tenant_account_id'::UUID AND external_id = 'event-001'),
  'idempotent create stores one lead'
);

SELECT public.record_lead_result(
  :'lead_id'::UUID, 'phone', 'no_answer', 'No response', NOW() + INTERVAL '1 day'
);
SELECT pg_temp.assert_true(
  (SELECT attempt_count = 1 AND status = 'follow_up' FROM public.leads WHERE id = :'lead_id'::UUID),
  'no_answer increments attempts and moves to follow_up'
);
SELECT pg_temp.assert_true(
  (SELECT COUNT(*) = 1 FROM public.lead_tasks WHERE lead_id = :'lead_id'::UUID AND status = 'pending'),
  'no_answer replaces the pending task atomically'
);

-- The configurable no-response reason cannot close the lead before
-- the fifth attempted contact (the default pilot threshold).
SELECT id AS no_response_reason_id
FROM public.discard_reasons
WHERE account_id = :'tenant_account_id'::UUID AND code = 'no_response'
\gset
SELECT set_config('test.no_response_reason_id', :'no_response_reason_id', TRUE);
DO $$
BEGIN
  BEGIN
    PERFORM public.record_lead_result(
      p_lead_id => current_setting('test.lead_id')::UUID,
      p_channel => 'phone',
      p_result => 'discarded',
      p_discard_reason_id => current_setting('test.no_response_reason_id')::UUID
    );
    RAISE EXCEPTION 'early no-response discard unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END;
$$;

-- Agents cannot use the assignment command; assignment is a
-- supervisory operation even when the target happens to be themselves.
DO $$
BEGIN
  BEGIN
    PERFORM public.record_lead_result(
      p_lead_id => current_setting('test.lead_id')::UUID,
      p_channel => 'system',
      p_result => 'assigned',
      p_assigned_to_user_id => '10000000-0000-4000-8000-000000000003'
    );
    RAISE EXCEPTION 'agent assignment unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$$;

-- Reprogramming does not count as an attempt and requires a
-- structured reason plus the replacement next action.
SELECT public.record_lead_result(
  p_lead_id => :'lead_id'::UUID,
  p_channel => 'phone',
  p_result => 'rescheduled',
  p_next_follow_up_at => NOW() + INTERVAL '2 days',
  p_reason_code => 'customer_request'
);
SELECT pg_temp.assert_true(
  (SELECT attempt_count = 1 FROM public.leads WHERE id = :'lead_id'::UUID),
  'rescheduling does not increment attempts'
);

-- A viewer can read but cannot mutate the tenant's lead.
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', TRUE);
SELECT pg_temp.assert_true(
  (SELECT COUNT(*) = 1 FROM public.leads WHERE id = :'lead_id'::UUID),
  'viewer can read tenant leads'
);
DO $$
BEGIN
  BEGIN
    UPDATE public.leads SET priority = 'urgent'
    WHERE id = current_setting('test.lead_id')::UUID;
    IF FOUND THEN RAISE EXCEPTION 'viewer update unexpectedly succeeded'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$$;

-- An unrelated tenant cannot see the lead.
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000006', TRUE);
SELECT pg_temp.assert_true(
  (SELECT COUNT(*) = 0 FROM public.leads WHERE id = :'lead_id'::UUID),
  'unrelated tenant is isolated'
);

-- A platform administrator can access the tenant without becoming a
-- member and can manage account-level configuration.
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', TRUE);
SELECT pg_temp.assert_true(public.is_platform_admin(), 'platform role is independent and active');
SELECT pg_temp.assert_true(
  (SELECT COUNT(*) = 1 FROM public.leads WHERE id = :'lead_id'::UUID),
  'platform admin has cross-account lead access'
);
UPDATE public.account_settings
SET feature_flags = feature_flags || '{"leads":true}'::JSONB
WHERE account_id = :'tenant_account_id'::UUID;
SELECT pg_temp.assert_true(
  (SELECT feature_flags->>'leads' = 'true' FROM public.account_settings WHERE account_id = :'tenant_account_id'::UUID),
  'platform admin can manage account feature flags'
);

-- An agent cannot change account-level feature flags.
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', TRUE);
DO $$
BEGIN
  BEGIN
    UPDATE public.account_settings
    SET feature_flags = '{}'::JSONB
    WHERE account_id = current_setting('test.tenant_account_id')::UUID;
    IF FOUND THEN RAISE EXCEPTION 'agent settings update unexpectedly succeeded'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$$;

-- Discard requires a structured reason.
DO $$
BEGIN
  BEGIN
    PERFORM public.record_lead_result(
      current_setting('test.lead_id')::UUID, 'phone', 'discarded', 'No reason'
    );
    RAISE EXCEPTION 'discard without reason unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END;
$$;

-- Closing a lead cancels all pending work.
DO $$
BEGIN
  BEGIN
    PERFORM public.record_lead_result(
      p_lead_id => current_setting('test.lead_id')::UUID,
      p_channel => 'phone',
      p_result => 'won'
    );
    RAISE EXCEPTION 'sale without product unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END;
$$;
SELECT public.record_lead_result(
  p_lead_id => :'lead_id'::UUID,
  p_channel => 'phone',
  p_result => 'won',
  p_note => 'Sold',
  p_sold_product => 'Plan de prueba'
);
SELECT pg_temp.assert_true(
  (SELECT status = 'won' AND attempt_count = 2 AND closed_at IS NOT NULL FROM public.leads WHERE id = :'lead_id'::UUID),
  'won closes the lead and increments the attempt count'
);
SELECT pg_temp.assert_true(
  (SELECT COUNT(*) = 0 FROM public.lead_tasks WHERE lead_id = :'lead_id'::UUID AND status = 'pending'),
  'closed lead has no pending task'
);

-- A repeated inbound event after closure returns the original lead and
-- must never reopen work or create a new pending task.
SELECT public.create_lead_with_initial_task(
  p_account_id => :'tenant_account_id'::UUID,
  p_contact_id => :'contact_id'::UUID,
  p_source => 'phase2-test',
  p_external_id => 'event-001',
  p_assigned_to_user_id => '10000000-0000-4000-8000-000000000003',
  p_next_follow_up_at => NOW() + INTERVAL '3 days'
) AS closed_duplicate_lead_id
\gset
SELECT pg_temp.assert_true(
  :'closed_duplicate_lead_id'::UUID = :'lead_id'::UUID,
  'closed duplicate returns original lead'
);
SELECT pg_temp.assert_true(
  (SELECT status = 'won' FROM public.leads WHERE id = :'lead_id'::UUID)
  AND (SELECT COUNT(*) = 0 FROM public.lead_tasks WHERE lead_id = :'lead_id'::UUID AND status = 'pending'),
  'idempotent retry does not reopen a closed lead'
);

-- The deferred invariant rejects an open lead committed without a task.
RESET ROLE;
DO $$
DECLARE
  invalid_lead_id UUID;
BEGIN
  BEGIN
    INSERT INTO public.leads(account_id, contact_id, source)
    VALUES (
      current_setting('test.tenant_account_id')::UUID,
      current_setting('test.contact_id')::UUID,
      'invalid-direct'
    )
    RETURNING id INTO invalid_lead_id;
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'open lead without task unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN
    SET CONSTRAINTS ALL DEFERRED;
  END;
END;
$$;

ROLLBACK;
