'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  BriefcaseBusiness,
  ListPlus,
  PackageOpen,
  Plus,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SettingsPanelHead } from './settings-panel-head';

type OpportunityType = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  is_active: boolean;
};
type CatalogItem = {
  id: string;
  name: string;
  sku: string | null;
  kind: string;
  price: number | null;
  currency: string | null;
  is_active: boolean;
};
type FieldDefinition = {
  id: string;
  name: string;
  field_type: string;
  opportunity_type_id: string | null;
  is_required: boolean;
  is_active: boolean;
};
type Schema = {
  opportunity_types: OpportunityType[];
  catalog_items: CatalogItem[];
  field_definitions: FieldDefinition[];
};
type Resource = 'opportunity_type' | 'catalog_item' | 'field_definition';

async function json(response: Response) {
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? 'No se pudo guardar');
  return value;
}

export function CommercialModelSettings() {
  const [data, setData] = useState<Schema | null>(null),
    [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    try {
      setData(
        await fetch('/api/leads/commercial-schema', { cache: 'no-store' }).then(
          json
        )
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cargar');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function create(resource: Resource, form: HTMLFormElement) {
    setSaving(true);
    try {
      const values = Object.fromEntries(new FormData(form));
      const payload: Record<string, unknown> = {
        resource,
        ...values,
        is_required: values.is_required === 'on',
      };
      if (typeof values.options === 'string')
        payload.options = values.options
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean);
      await json(
        await fetch('/api/leads/commercial-schema', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
      );
      form.reset();
      toast.success('Configuración agregada');
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'No se pudo guardar'
      );
    } finally {
      setSaving(false);
    }
  }
  async function toggle(
    resource: Resource,
    item: OpportunityType | CatalogItem | FieldDefinition
  ) {
    setSaving(true);
    try {
      await json(
        await fetch('/api/leads/commercial-schema', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            resource,
            ...item,
            is_active: !item.is_active,
          }),
        })
      );
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'No se pudo actualizar'
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="animate-in fade-in-50 max-w-5xl space-y-5 duration-200">
      <SettingsPanelHead
        title="Modelo comercial"
        description="Adaptá oportunidades, oferta y datos comerciales sin cambiar el núcleo del CRM."
      />
      <div className="grid gap-4 xl:grid-cols-3">
        <CommercialCard
          icon={BriefcaseBusiness}
          title="Tipos de oportunidad"
          description="Qué objetivo comercial se está gestionando."
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void create('opportunity_type', e.currentTarget);
            }}
            className="space-y-3"
          >
            <Field label="Nombre">
              <Input name="name" placeholder="Ej. Portabilidad" required />
            </Field>
            <Field label="Descripción">
              <Input name="description" placeholder="Opcional" />
            </Field>
            <Button className="w-full" disabled={saving}>
              <Plus />
              Agregar tipo
            </Button>
          </form>
          <Items>
            {data?.opportunity_types.map((item) => (
              <Item
                key={item.id}
                name={item.name}
                detail={item.description}
                active={item.is_active}
                onToggle={() => void toggle('opportunity_type', item)}
              />
            ))}
          </Items>
        </CommercialCard>
        <CommercialCard
          icon={PackageOpen}
          title="Catálogo comercial"
          description="Productos, servicios o planes; no administra stock."
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void create('catalog_item', e.currentTarget);
            }}
            className="space-y-3"
          >
            <Field label="Nombre">
              <Input
                name="name"
                placeholder="Ej. Plan Empresa 10 GB"
                required
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Tipo">
                <select
                  name="kind"
                  className="bg-background h-9 w-full rounded-lg border px-3"
                >
                  <option value="service">Servicio</option>
                  <option value="plan">Plan</option>
                  <option value="product">Producto</option>
                  <option value="bundle">Paquete</option>
                  <option value="other">Otro</option>
                </select>
              </Field>
              <Field label="SKU">
                <Input name="sku" placeholder="Opcional" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Precio">
                <Input name="price" type="number" min="0" step="0.01" />
              </Field>
              <Field label="Moneda">
                <Input name="currency" defaultValue="ARS" maxLength={3} />
              </Field>
            </div>
            <Button className="w-full" disabled={saving}>
              <Plus />
              Agregar oferta
            </Button>
          </form>
          <Items>
            {data?.catalog_items.map((item) => (
              <Item
                key={item.id}
                name={item.name}
                detail={[
                  item.kind,
                  item.sku,
                  item.price != null
                    ? `${item.currency ?? ''} ${item.price}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                active={item.is_active}
                onToggle={() => void toggle('catalog_item', item)}
              />
            ))}
          </Items>
        </CommercialCard>
        <CommercialCard
          icon={ListPlus}
          title="Campos de oportunidad"
          description="Datos de una venta concreta, no de la persona."
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void create('field_definition', e.currentTarget);
            }}
            className="space-y-3"
          >
            <Field label="Nombre">
              <Input name="name" placeholder="Ej. Operador actual" required />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Tipo">
                <select
                  name="field_type"
                  className="bg-background h-9 w-full rounded-lg border px-3"
                >
                  <option value="text">Texto</option>
                  <option value="number">Número</option>
                  <option value="date">Fecha</option>
                  <option value="boolean">Sí / No</option>
                  <option value="select">Opciones</option>
                </select>
              </Field>
              <Field label="Aplica a">
                <select
                  name="opportunity_type_id"
                  className="bg-background h-9 w-full rounded-lg border px-3"
                >
                  <option value="">Todos</option>
                  {data?.opportunity_types.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Opciones">
              <Input name="options" placeholder="Separadas por coma" />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input name="is_required" type="checkbox" />
              Obligatorio
            </label>
            <Button className="w-full" disabled={saving}>
              <Plus />
              Agregar campo
            </Button>
          </form>
          <Items>
            {data?.field_definitions.map((item) => (
              <Item
                key={item.id}
                name={item.name}
                detail={`${item.field_type}${item.is_required ? ' · obligatorio' : ''}`}
                active={item.is_active}
                onToggle={() => void toggle('field_definition', item)}
              />
            ))}
          </Items>
        </CommercialCard>
      </div>
    </section>
  );
}
function CommercialCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof BriefcaseBusiness;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="bg-primary-soft text-primary mb-2 flex size-9 items-center justify-center rounded-lg">
          <Icon className="size-4" />
        </div>
        <CardTitle>{title}</CardTitle>
        <p className="text-muted-foreground text-xs">{description}</p>
      </CardHeader>
      <CardContent className="space-y-5">{children}</CardContent>
    </Card>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
function Items({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-h-72 divide-y overflow-y-auto rounded-lg border">
      {children}
    </div>
  );
}
function Item({
  name,
  detail,
  active,
  onToggle,
}: {
  name: string;
  detail?: string | null;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center gap-3 p-3">
      <span className="min-w-0 flex-1">
        <strong className="block truncate text-sm">{name}</strong>
        {detail ? (
          <span className="text-muted-foreground block truncate text-xs">
            {detail}
          </span>
        ) : null}
      </span>
      <button
        type="button"
        onClick={onToggle}
        title={active ? 'Desactivar' : 'Activar'}
        className={active ? 'text-primary' : 'text-muted-foreground'}
      >
        {active ? <ToggleRight /> : <ToggleLeft />}
      </button>
    </div>
  );
}
