\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(ok BOOLEAN, message TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN IF NOT ok THEN RAISE EXCEPTION 'assertion failed: %', message; END IF; END $$;

INSERT INTO auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES
('45000000-0000-4000-8000-000000000001','authenticated','authenticated','integration-owner@example.test','',NOW(),'{"provider":"email"}','{"full_name":"Integration Owner"}',NOW(),NOW()),
('45000000-0000-4000-8000-000000000002','authenticated','authenticated','integration-agent@example.test','',NOW(),'{"provider":"email"}','{"full_name":"Integration Agent"}',NOW(),NOW());

SELECT account_id AS integration_account_id FROM public.profiles WHERE user_id='45000000-0000-4000-8000-000000000001' \gset
UPDATE public.profiles SET account_id=:'integration_account_id',account_role='agent' WHERE user_id='45000000-0000-4000-8000-000000000002';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','45000000-0000-4000-8000-000000000001',true);
INSERT INTO public.integration_connections(account_id,provider,category,name,created_by)
VALUES (:'integration_account_id','make','automation','Make test','45000000-0000-4000-8000-000000000001');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.integration_connections WHERE account_id=:'integration_account_id'),'owner sees integration');

SELECT set_config('request.jwt.claim.sub','45000000-0000-4000-8000-000000000002',true);
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.integration_connections),'agent cannot see integrations');

RESET ROLE;
INSERT INTO auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES ('45000000-0000-4000-8000-000000000003','authenticated','authenticated','integration-other@example.test','',NOW(),'{"provider":"email"}','{"full_name":"Other Owner"}',NOW(),NOW());
SELECT account_id AS other_integration_account_id FROM public.profiles WHERE user_id='45000000-0000-4000-8000-000000000003' \gset

DO $$
DECLARE
  source_connection_id UUID;
  other_account_id UUID;
BEGIN
  SELECT ic.id INTO source_connection_id
  FROM public.integration_connections ic
  JOIN public.profiles p ON p.account_id = ic.account_id
  WHERE p.user_id = '45000000-0000-4000-8000-000000000001'
  LIMIT 1;
  SELECT account_id INTO other_account_id
  FROM public.profiles
  WHERE user_id = '45000000-0000-4000-8000-000000000003';
  INSERT INTO public.integration_mappings(account_id,integration_id,version,mapping)
  VALUES (other_account_id, source_connection_id, 1, '{}'::jsonb);
  RAISE EXCEPTION 'cross-tenant integration mapping unexpectedly succeeded';
EXCEPTION WHEN foreign_key_violation THEN NULL; END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','45000000-0000-4000-8000-000000000002',true);

DO $$ BEGIN
  PERFORM * FROM public.integration_secrets;
  RAISE EXCEPTION 'authenticated role unexpectedly read integration secrets';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

ROLLBACK;
