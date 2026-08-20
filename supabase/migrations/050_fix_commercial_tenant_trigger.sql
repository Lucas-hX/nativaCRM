-- Avoid accessing table-specific NEW fields from a shared trigger function.
-- PostgreSQL evaluates record field references before boolean short-circuiting,
-- so each table must live in its own explicit branch.
CREATE OR REPLACE FUNCTION public.validate_commercial_tenant_links()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_type TEXT; v_options JSONB;
BEGIN
  IF TG_TABLE_NAME = 'lead_field_definitions' THEN
    IF NEW.opportunity_type_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.opportunity_types t
      WHERE t.id = NEW.opportunity_type_id AND t.account_id = NEW.account_id
    ) THEN
      RAISE EXCEPTION 'opportunity type must belong to the same account' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'leads' THEN
    IF NEW.opportunity_type_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.opportunity_types t
      WHERE t.id = NEW.opportunity_type_id AND t.account_id = NEW.account_id
    ) THEN
      RAISE EXCEPTION 'opportunity type must belong to the same account' USING ERRCODE='23514';
    END IF;
    IF NEW.catalog_item_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.catalog_items i
      WHERE i.id = NEW.catalog_item_id AND i.account_id = NEW.account_id
    ) THEN
      RAISE EXCEPTION 'catalog item must belong to the same account' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'lead_field_values' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.leads l
      JOIN public.lead_field_definitions f ON f.id = NEW.field_definition_id
      WHERE l.id = NEW.lead_id
        AND l.account_id = NEW.account_id
        AND f.account_id = NEW.account_id
        AND (f.opportunity_type_id IS NULL OR f.opportunity_type_id = l.opportunity_type_id)
    ) THEN
      RAISE EXCEPTION 'lead field value has inconsistent tenant or opportunity type' USING ERRCODE='23514';
    END IF;
    IF NEW.value <> 'null'::jsonb THEN
      SELECT field_type, options INTO v_type, v_options
      FROM public.lead_field_definitions WHERE id = NEW.field_definition_id;
      IF (v_type IN ('text','date','select') AND jsonb_typeof(NEW.value) <> 'string')
         OR (v_type = 'number' AND jsonb_typeof(NEW.value) <> 'number')
         OR (v_type = 'boolean' AND jsonb_typeof(NEW.value) <> 'boolean')
         OR (v_type = 'select' AND NOT v_options @> jsonb_build_array(NEW.value)) THEN
        RAISE EXCEPTION 'lead field value does not match its definition' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
