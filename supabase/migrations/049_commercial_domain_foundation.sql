-- Agnostic commercial configuration shared by telecom, services and commerce.

CREATE TABLE IF NOT EXISTS public.opportunity_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  code TEXT NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  description TEXT,
  color TEXT NOT NULL DEFAULT '#6366f1',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, code)
);

CREATE TABLE IF NOT EXISTS public.catalog_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  sku TEXT,
  kind TEXT NOT NULL DEFAULT 'service' CHECK (kind IN ('product', 'service', 'plan', 'bundle', 'other')),
  description TEXT,
  price NUMERIC(14,2) CHECK (price IS NULL OR price >= 0),
  currency TEXT CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  external_ref TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS catalog_items_account_sku_uq
  ON public.catalog_items(account_id, sku) WHERE sku IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.lead_field_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  opportunity_type_id UUID REFERENCES public.opportunity_types(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  code TEXT NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  field_type TEXT NOT NULL CHECK (field_type IN ('text', 'number', 'date', 'boolean', 'select')),
  options JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(options) = 'array'),
  is_required BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, opportunity_type_id, code),
  CONSTRAINT lead_field_select_options CHECK (field_type <> 'select' OR jsonb_array_length(options) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS lead_field_definitions_global_code_uq
  ON public.lead_field_definitions(account_id, code) WHERE opportunity_type_id IS NULL;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS opportunity_type_id UUID REFERENCES public.opportunity_types(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS catalog_item_id UUID REFERENCES public.catalog_items(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.lead_field_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  field_definition_id UUID NOT NULL REFERENCES public.lead_field_definitions(id) ON DELETE CASCADE,
  value JSONB NOT NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(lead_id, field_definition_id)
);

CREATE INDEX IF NOT EXISTS opportunity_types_account_active_idx ON public.opportunity_types(account_id, is_active, sort_order);
CREATE INDEX IF NOT EXISTS catalog_items_account_active_idx ON public.catalog_items(account_id, is_active, name);
CREATE INDEX IF NOT EXISTS lead_field_definitions_account_idx ON public.lead_field_definitions(account_id, opportunity_type_id, is_active, sort_order);
CREATE INDEX IF NOT EXISTS lead_field_values_lead_idx ON public.lead_field_values(account_id, lead_id);
CREATE INDEX IF NOT EXISTS leads_opportunity_type_idx ON public.leads(account_id, opportunity_type_id, status);
CREATE INDEX IF NOT EXISTS leads_catalog_item_idx ON public.leads(account_id, catalog_item_id, status);

CREATE OR REPLACE FUNCTION public.validate_commercial_tenant_links()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_type TEXT; v_options JSONB;
BEGIN
  IF TG_TABLE_NAME = 'lead_field_definitions' AND NEW.opportunity_type_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.opportunity_types t WHERE t.id=NEW.opportunity_type_id AND t.account_id=NEW.account_id) THEN
    RAISE EXCEPTION 'opportunity type must belong to the same account' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME = 'leads' THEN
    IF NEW.opportunity_type_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.opportunity_types t WHERE t.id=NEW.opportunity_type_id AND t.account_id=NEW.account_id) THEN
      RAISE EXCEPTION 'opportunity type must belong to the same account' USING ERRCODE='23514';
    END IF;
    IF NEW.catalog_item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.catalog_items i WHERE i.id=NEW.catalog_item_id AND i.account_id=NEW.account_id) THEN
      RAISE EXCEPTION 'catalog item must belong to the same account' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'lead_field_values' AND NOT EXISTS (
    SELECT 1 FROM public.leads l JOIN public.lead_field_definitions f ON f.id=NEW.field_definition_id
    WHERE l.id=NEW.lead_id AND l.account_id=NEW.account_id AND f.account_id=NEW.account_id
      AND (f.opportunity_type_id IS NULL OR f.opportunity_type_id=l.opportunity_type_id)
  ) THEN
    RAISE EXCEPTION 'lead field value has inconsistent tenant or opportunity type' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME = 'lead_field_values' AND NEW.value <> 'null'::jsonb THEN
    SELECT field_type, options INTO v_type, v_options FROM public.lead_field_definitions WHERE id=NEW.field_definition_id;
    IF (v_type IN ('text','date','select') AND jsonb_typeof(NEW.value)<>'string')
       OR (v_type='number' AND jsonb_typeof(NEW.value)<>'number')
       OR (v_type='boolean' AND jsonb_typeof(NEW.value)<>'boolean')
       OR (v_type='select' AND NOT v_options @> jsonb_build_array(NEW.value)) THEN
      RAISE EXCEPTION 'lead field value does not match its definition' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS validate_opportunity_field_tenant ON public.lead_field_definitions;
CREATE TRIGGER validate_opportunity_field_tenant BEFORE INSERT OR UPDATE ON public.lead_field_definitions FOR EACH ROW EXECUTE FUNCTION public.validate_commercial_tenant_links();
DROP TRIGGER IF EXISTS validate_lead_commercial_tenant ON public.leads;
CREATE TRIGGER validate_lead_commercial_tenant BEFORE INSERT OR UPDATE OF account_id, opportunity_type_id, catalog_item_id ON public.leads FOR EACH ROW EXECUTE FUNCTION public.validate_commercial_tenant_links();
DROP TRIGGER IF EXISTS validate_lead_field_value_tenant ON public.lead_field_values;
CREATE TRIGGER validate_lead_field_value_tenant BEFORE INSERT OR UPDATE ON public.lead_field_values FOR EACH ROW EXECUTE FUNCTION public.validate_commercial_tenant_links();

CREATE OR REPLACE FUNCTION public.require_commercial_fields_on_win()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.status='won' AND OLD.status IS DISTINCT FROM 'won' AND EXISTS (
    SELECT 1 FROM public.lead_field_definitions f
    WHERE f.account_id=NEW.account_id AND f.is_active AND f.is_required
      AND (f.opportunity_type_id IS NULL OR f.opportunity_type_id=NEW.opportunity_type_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.lead_field_values v
        WHERE v.lead_id=NEW.id AND v.field_definition_id=f.id
          AND v.value <> 'null'::jsonb AND v.value <> '""'::jsonb
      )
  ) THEN
    RAISE EXCEPTION 'required commercial fields must be completed before winning a lead' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS require_commercial_fields_on_win ON public.leads;
CREATE TRIGGER require_commercial_fields_on_win BEFORE UPDATE OF status ON public.leads FOR EACH ROW EXECUTE FUNCTION public.require_commercial_fields_on_win();

DO $$ DECLARE _tbl TEXT; BEGIN
  FOREACH _tbl IN ARRAY ARRAY['opportunity_types','catalog_items','lead_field_definitions','lead_field_values'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', _tbl);
  END LOOP;
END $$;

DROP POLICY IF EXISTS opportunity_types_select ON public.opportunity_types;
DROP POLICY IF EXISTS opportunity_types_modify ON public.opportunity_types;
CREATE POLICY opportunity_types_select ON public.opportunity_types FOR SELECT USING (public.is_account_member(account_id));
CREATE POLICY opportunity_types_modify ON public.opportunity_types FOR ALL USING (public.is_account_member(account_id, 'admin')) WITH CHECK (public.is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS catalog_items_select ON public.catalog_items;
DROP POLICY IF EXISTS catalog_items_modify ON public.catalog_items;
CREATE POLICY catalog_items_select ON public.catalog_items FOR SELECT USING (public.is_account_member(account_id));
CREATE POLICY catalog_items_modify ON public.catalog_items FOR ALL USING (public.is_account_member(account_id, 'admin')) WITH CHECK (public.is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS lead_field_definitions_select ON public.lead_field_definitions;
DROP POLICY IF EXISTS lead_field_definitions_modify ON public.lead_field_definitions;
CREATE POLICY lead_field_definitions_select ON public.lead_field_definitions FOR SELECT USING (public.is_account_member(account_id));
CREATE POLICY lead_field_definitions_modify ON public.lead_field_definitions FOR ALL USING (public.is_account_member(account_id, 'admin')) WITH CHECK (public.is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS lead_field_values_select ON public.lead_field_values;
DROP POLICY IF EXISTS lead_field_values_modify ON public.lead_field_values;
CREATE POLICY lead_field_values_select ON public.lead_field_values FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.leads l WHERE l.id=lead_id AND public.can_read_lead(l.account_id,l.assigned_to_user_id))
);
CREATE POLICY lead_field_values_modify ON public.lead_field_values FOR ALL USING (
  EXISTS (SELECT 1 FROM public.leads l WHERE l.id=lead_id AND public.can_operate_lead(l.account_id,l.assigned_to_user_id))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.leads l WHERE l.id=lead_id AND public.can_operate_lead(l.account_id,l.assigned_to_user_id))
);

GRANT SELECT ON public.opportunity_types, public.catalog_items, public.lead_field_definitions, public.lead_field_values TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.opportunity_types, public.catalog_items, public.lead_field_definitions, public.lead_field_values TO authenticated;

CREATE OR REPLACE FUNCTION public.seed_commercial_defaults()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.opportunity_types(account_id,name,code,description,color,sort_order) VALUES
    (NEW.id,'Nueva venta','new_sale','Primera contratación o compra','#7c3aed',10),
    (NEW.id,'Renovación','renewal','Renovación o continuidad de un producto o servicio','#2563eb',20),
    (NEW.id,'Venta adicional','upsell','Ampliación, mejora o producto complementario','#059669',30)
  ON CONFLICT(account_id,code) DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS seed_commercial_defaults ON public.accounts;
CREATE TRIGGER seed_commercial_defaults AFTER INSERT ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.seed_commercial_defaults();

INSERT INTO public.opportunity_types(account_id,name,code,description,color,sort_order)
SELECT a.id, x.name, x.code, x.description, x.color, x.sort_order FROM public.accounts a CROSS JOIN (VALUES
 ('Nueva venta','new_sale','Primera contratación o compra','#7c3aed',10),
 ('Renovación','renewal','Renovación o continuidad de un producto o servicio','#2563eb',20),
 ('Venta adicional','upsell','Ampliación, mejora o producto complementario','#059669',30)
) AS x(name,code,description,color,sort_order)
ON CONFLICT(account_id,code) DO NOTHING;

COMMENT ON TABLE public.catalog_items IS 'Lightweight commercial catalog; transactional stock and orders remain in external systems.';
COMMENT ON TABLE public.lead_field_definitions IS 'Account-defined opportunity fields, optionally scoped to one opportunity type.';
