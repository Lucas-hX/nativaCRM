'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CircleDot,
  Inbox,
  Loader2,
  MessageCircle,
  Phone,
  RefreshCw,
  Search,
  Sparkles,
  UserRoundCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';

type Activity = {
  id: string;
  result: string;
  note: string | null;
  attempt_number: number | null;
  occurred_at: string;
};
type Lead = {
  id: string;
  status: string;
  attempt_count: number;
  company: string | null;
  plan: string | null;
  assigned_to_user_id: string | null;
  opportunity_type_id?: string | null;
  catalog_item_id?: string | null;
  field_values?: Array<{ field_definition_id: string; value: unknown }>;
  contact?: { name: string | null; phone: string } | null;
  pending_tasks?: Array<{ due_at: string }>;
  activities?: Activity[];
};
type Workspace = {
  role: 'owner' | 'admin' | 'agent' | 'viewer';
  timezone: string;
  close_no_response_after: number;
};
type Member = { user_id: string; full_name: string; role: string };
type Reason = { id: string; name: string; code: string };
type OpportunityType = {
  id: string;
  name: string;
  color: string;
  is_active: boolean;
};
type CatalogItem = {
  id: string;
  name: string;
  kind: string;
  price: number | null;
  currency: string | null;
  is_active: boolean;
};
type FieldDefinition = {
  id: string;
  name: string;
  field_type: string;
  options: string[];
  opportunity_type_id: string | null;
  is_required: boolean;
  is_active: boolean;
};
type CommercialSchema = {
  opportunity_types: OpportunityType[];
  catalog_items: CatalogItem[];
  field_definitions: FieldDefinition[];
};
type View = 'today' | 'new' | 'followup' | 'overdue' | 'unassigned' | 'all';
type Result =
  'no_answer' | 'contacted' | 'qualified' | 'rescheduled' | 'discarded' | 'won';
const views: Array<{ key: View; label: string; icon: typeof Inbox }> = [
  { key: 'today', label: 'Para hoy', icon: CalendarClock },
  { key: 'new', label: 'Nuevos', icon: Sparkles },
  { key: 'followup', label: 'Seguimientos', icon: RefreshCw },
  { key: 'overdue', label: 'Vencidos', icon: AlertTriangle },
  { key: 'unassigned', label: 'Sin asignar', icon: UserRoundCheck },
  { key: 'all', label: 'Todos', icon: CircleDot },
];
const resultLabels: Record<Result, string> = {
  no_answer: 'No respondió',
  contacted: 'Información enviada',
  qualified: 'Interesado',
  rescheduled: 'Reprogramar sin intento',
  discarded: 'Descartar',
  won: 'Venta',
};
const stateLabel: Record<string, string> = {
  new: 'Nuevo',
  in_progress: 'En gestión',
  follow_up: 'Seguimiento',
  won: 'Vendido',
  discarded: 'Descartado',
};
const stateTone: Record<string, string> = {
  new: 'bg-violet-500/10 text-violet-600',
  in_progress: 'bg-blue-500/10 text-blue-600',
  follow_up: 'bg-emerald-500/10 text-emerald-600',
  won: 'bg-amber-500/10 text-amber-600',
  discarded: 'bg-muted text-muted-foreground',
};
const rescheduleReasons = [
  { code: 'customer_request', name: 'Solicitado por el cliente' },
  { code: 'outside_business_hours', name: 'Fuera de horario' },
  { code: 'seller_unavailable', name: 'Indisponibilidad del vendedor' },
  { code: 'other', name: 'Otro' },
];
const openResults: Result[] = [
  'no_answer',
  'contacted',
  'qualified',
  'rescheduled',
];
function due(lead: Lead) {
  return lead.pending_tasks?.[0]?.due_at ?? null;
}
function fmt(value: string, tz: string) {
  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: tz,
  }).format(new Date(value));
}
function bounds(timeZone: string) {
  const ps = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const n = (t: string) => Number(ps.find((p) => p.type === t)?.value);
  const noon = Date.UTC(n('year'), n('month') - 1, n('day'), 12);
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(noon))
  );
  const start =
    Date.UTC(n('year'), n('month') - 1, n('day')) - (hour - 12) * 3600000;
  return {
    start: new Date(start).toISOString(),
    end: new Date(start + 86400000 - 1).toISOString(),
  };
}
function query(view: View, search: string, tz: string) {
  const p = new URLSearchParams({ limit: '50', page: '1' }),
    b = bounds(tz);
  if (search.trim()) p.set('search', search.trim());
  if (view === 'new') p.set('status', 'new');
  if (view === 'followup') p.set('status', 'follow_up');
  if (view === 'overdue') p.set('due_before', b.start);
  if (view === 'today') {
    p.set('due_after', b.start);
    p.set('due_before', b.end);
  }
  if (view === 'unassigned') p.set('assigned_to', 'unassigned');
  return p;
}
async function body(response: Response) {
  const value = await response.json();
  if (!response.ok)
    throw new Error(value.error?.message ?? 'La operación no pudo completarse');
  return value;
}

export default function LeadsPage() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null),
    [view, setView] = useState<View>('today'),
    [search, setSearch] = useState(''),
    [leads, setLeads] = useState<Lead[]>([]),
    [counts, setCounts] = useState<Record<string, number>>({}),
    [loading, setLoading] = useState(true),
    [selected, setSelected] = useState<Lead | null>(null),
    [members, setMembers] = useState<Member[]>([]),
    [reasons, setReasons] = useState<Reason[]>([]),
    [commercial, setCommercial] = useState<CommercialSchema>({
      opportunity_types: [],
      catalog_items: [],
      field_definitions: [],
    }),
    [fieldValues, setFieldValues] = useState<Record<string, unknown>>({});
  const [result, setResult] = useState<Result>('no_answer'),
    [channel, setChannel] = useState('phone'),
    [nextAt, setNextAt] = useState(''),
    [reasonId, setReasonId] = useState(''),
    [reasonCode, setReasonCode] = useState('customer_request'),
    [product, setProduct] = useState(''),
    [amount, setAmount] = useState(''),
    [note, setNote] = useState(''),
    [saving, setSaving] = useState(false);
  const supervise = workspace?.role === 'owner' || workspace?.role === 'admin',
    readOnly = workspace?.role === 'viewer';
  const available = useMemo(
    () => views.filter((v) => v.key !== 'unassigned' || supervise || readOnly),
    [supervise, readOnly]
  );
  const context = useCallback(async () => {
    const [c, r, schema] = await Promise.all([
      fetch('/api/leads/workspace').then(body),
      fetch('/api/leads/discard-reasons').then(body),
      fetch('/api/leads/commercial-schema').then(body),
    ]);
    setWorkspace(c.data);
    setReasons(r.data ?? []);
    setCommercial(schema);
    if (['owner', 'admin'].includes(c.data.role)) {
      const m = await fetch('/api/account/members').then(body);
      setMembers(m.members ?? []);
    }
    return c.data as Workspace;
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const c = workspace ?? (await context());
      const vs = views.filter(
        (v) =>
          v.key !== 'unassigned' ||
          ['owner', 'admin', 'viewer'].includes(c.role)
      );
      const [current, ...totals] = await Promise.all([
        fetch(`/api/leads?${query(view, search, c.timezone)}`).then(body),
        ...vs.map((v) =>
          fetch(`/api/leads?${query(v.key, '', c.timezone)}`).then(body)
        ),
      ]);
      setLeads(current.data ?? []);
      setCounts(
        Object.fromEntries(
          vs.map((v, i) => [v.key, totals[i].pagination.total])
        )
      );
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : 'No se pudieron cargar los leads'
      );
    } finally {
      setLoading(false);
    }
  }, [context, search, view, workspace]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);
  async function open(id: string) {
    try {
      const lead = (await fetch(`/api/leads/${id}`).then(body)).data as Lead;
      setSelected(lead);
      setFieldValues(
        Object.fromEntries(
          (lead.field_values ?? []).map((value) => [
            value.field_definition_id,
            value.value,
          ])
        )
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo abrir');
    }
  }
  async function refresh() {
    if (selected)
      setSelected((await fetch(`/api/leads/${selected.id}`).then(body)).data);
    await load();
  }
  async function assign(user: string) {
    if (!selected) return;
    setSaving(true);
    try {
      await body(
        await fetch(`/api/leads/${selected.id}/assignment`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ assigned_to_user_id: user }),
        })
      );
      toast.success('Lead asignado');
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo asignar');
    } finally {
      setSaving(false);
    }
  }
  async function saveCommercial() {
    if (!selected) return;
    setSaving(true);
    try {
      await body(
        await fetch(`/api/leads/${selected.id}/commercial-data`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            opportunity_type_id: selected.opportunity_type_id,
            catalog_item_id: selected.catalog_item_id,
            field_values: fieldValues,
          }),
        })
      );
      toast.success('Datos comerciales actualizados');
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'No se pudieron guardar los datos'
      );
    } finally {
      setSaving(false);
    }
  }
  async function save() {
    if (!selected) return;
    setSaving(true);
    try {
      const data: Record<string, unknown> = {
        result,
        channel,
        note: note || undefined,
      };
      if (openResults.includes(result)) {
        if (!nextAt) throw new Error('Elegí la fecha del próximo paso');
        data.next_follow_up_at = new Date(nextAt).toISOString();
      }
      if (result === 'discarded') {
        if (!reasonId) throw new Error('Elegí un motivo de descarte');
        data.discard_reason_id = reasonId;
      }
      if (result === 'rescheduled') data.reason_code = reasonCode;
      if (result === 'won') {
        data.sold_product =
          product ||
          commercial.catalog_items.find(
            (item) => item.id === selected.catalog_item_id
          )?.name;
        data.won_amount = amount || undefined;
        data.won_currency = amount ? 'ARS' : undefined;
      }
      await body(
        await fetch(`/api/leads/${selected.id}/results`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(data),
        })
      );
      const messages: Record<Result, string> = {
        no_answer: 'Intento registrado y próximo paso agendado',
        contacted: 'Contacto registrado y próximo paso agendado',
        qualified: 'Interés registrado y próximo paso agendado',
        rescheduled: 'Próximo paso reprogramado',
        discarded: 'Lead descartado correctamente',
        won: 'Venta registrada correctamente',
      };
      toast.success(messages[result]);
      setNote('');
      setNextAt('');
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }
  const sorted = useMemo(
    () =>
      [...leads].sort((a, b) =>
        (due(a) ?? '9999').localeCompare(due(b) ?? '9999')
      ),
    [leads]
  );
  const nextLead = !supervise && !readOnly && !search ? sorted[0] : null;
  const queue = nextLead ? sorted.slice(1) : sorted;
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-primary text-xs font-semibold tracking-[.18em] uppercase">
            Base comercial
          </p>
          <h2 className="mt-1 text-2xl font-semibold">
            {supervise || readOnly ? 'Operación de leads' : 'Mi trabajo'}
          </h2>
          <p className="text-muted-foreground">
            {readOnly
              ? 'Vista de supervisión en modo lectura.'
              : 'Atendé primero lo vencido y dejá siempre un próximo paso.'}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw className={loading ? 'animate-spin' : ''} />
          Actualizar
        </Button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {available.map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className={`flex min-w-fit items-center gap-2 rounded-full border px-3.5 py-2 text-left transition-colors ${view === v.key ? 'border-primary bg-primary-soft text-primary' : 'bg-card text-muted-foreground hover:bg-muted'}`}
          >
            <v.icon className="size-4" />
            <span className="text-sm font-medium">{v.label}</span>
            <span className="bg-background/80 min-w-6 rounded-full px-1.5 py-0.5 text-center text-xs font-semibold">
              {counts[v.key] ?? '–'}
            </span>
          </button>
        ))}
      </div>
      {nextLead && workspace && (
        <section
          aria-labelledby="next-action-title"
          className="overflow-hidden border border-primary/35 border-l-[6px] border-l-primary bg-card p-5 sm:p-6"
        >
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-primary flex items-center gap-2 text-xs font-semibold tracking-[.14em] uppercase">
                <span className="bg-primary size-2 rounded-full" />
                Próxima acción
              </div>
              <h3
                id="next-action-title"
                className="mt-3 truncate text-xl font-semibold"
              >
                {nextLead.contact?.name ??
                  nextLead.contact?.phone ??
                  'Contacto'}
              </h3>
              <p className="text-muted-foreground mt-1 text-sm">
                {nextLead.contact?.phone}
                {nextLead.company ? ` · ${nextLead.company}` : ''}
                {nextLead.plan ? ` · ${nextLead.plan}` : ''}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <Badge className={stateTone[nextLead.status]}>
                  {stateLabel[nextLead.status] ?? nextLead.status}
                </Badge>
                <span
                  className={
                    due(nextLead) && new Date(due(nextLead)!) < new Date()
                      ? 'text-destructive font-medium'
                      : 'font-medium'
                  }
                >
                  {due(nextLead)
                    ? fmt(due(nextLead)!, workspace.timezone)
                    : 'Sin horario asignado'}
                </span>
                <span className="text-muted-foreground">
                  · {nextLead.attempt_count} intentos
                </span>
              </div>
            </div>
            <Button
              size="lg"
              onClick={() => void open(nextLead.id)}
              className="shrink-0"
            >
              Gestionar ahora <ArrowRight />
            </Button>
          </div>
        </section>
      )}
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-semibold">
                {nextLead
                  ? 'Después'
                  : available.find((item) => item.key === view)?.label}
              </h3>
              <p className="text-muted-foreground text-xs">
                {loading
                  ? 'Actualizando la lista…'
                  : `${queue.length} leads visibles`}
              </p>
            </div>
            <div className="relative w-full sm:max-w-md">
              <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nombre, teléfono, compañía o plan"
                className="pl-9"
              />
            </div>
          </div>
          <div className="divide-y rounded-xl border">
            {loading && !sorted.length && (
              <div className="text-muted-foreground flex items-center justify-center gap-2 px-4 py-14 text-sm">
                <Loader2 className="size-4 animate-spin" /> Cargando tu trabajo…
              </div>
            )}
            {queue.map((l) => (
              <button
                key={l.id}
                onClick={() => void open(l.id)}
                className="hover:bg-muted/30 grid w-full gap-3 px-4 py-4 text-left md:grid-cols-[1.5fr_.8fr_.6fr_1fr_auto] md:items-center"
              >
                <div>
                  <p className="font-medium">
                    {l.contact?.name ?? l.contact?.phone ?? 'Contacto'}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {l.contact?.phone}
                    {l.company ? ` · ${l.company}` : ''}
                    {l.plan ? ` · ${l.plan}` : ''}
                  </p>
                </div>
                <Badge className={stateTone[l.status]}>
                  {stateLabel[l.status] ?? l.status}
                </Badge>
                <p className="text-sm">
                  <strong>{l.attempt_count}</strong> intentos
                </p>
                <p
                  className={
                    due(l) && new Date(due(l)!) < new Date()
                      ? 'text-destructive'
                      : ''
                  }
                >
                  {due(l) && workspace
                    ? fmt(due(l)!, workspace.timezone)
                    : 'Sin tarea'}
                </p>
                <span className="text-primary text-sm font-medium">
                  Gestionar
                </span>
              </button>
            ))}
            {!loading && !queue.length && !nextLead && (
              <div className="px-4 py-16 text-center">
                <CheckCircle2 className="text-primary mx-auto mb-3 size-10" />
                <p className="font-medium">Todo al día</p>
                <p className="text-muted-foreground mt-1 text-sm">
                  No hay leads pendientes en esta vista.
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      <Sheet
        open={!!selected}
        onOpenChange={(o) => {
          if (!o) setSelected(null);
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>
              {selected?.contact?.name ?? selected?.contact?.phone ?? 'Lead'}
            </SheetTitle>
            <SheetDescription>
              {selected?.contact?.phone} · {selected?.attempt_count} intentos
            </SheetDescription>
          </SheetHeader>
          {selected && workspace && (
            <div className="space-y-5 px-4 pb-6">
              <div className="grid grid-cols-2 gap-2">
                <Button
                  render={
                    <a
                      href={`https://wa.me/${selected.contact?.phone.replace(/\D/g, '')}`}
                      target="_blank"
                      rel="noreferrer"
                    />
                  }
                >
                  <MessageCircle />
                  WhatsApp
                </Button>
                <Button
                  variant="outline"
                  render={<a href={`tel:${selected.contact?.phone}`} />}
                >
                  <Phone />
                  Llamar
                </Button>
              </div>
              {supervise && (
                <Field label="Responsable">
                  <select
                    value={selected.assigned_to_user_id ?? ''}
                    onChange={(e) => void assign(e.target.value)}
                    disabled={saving}
                    className="bg-background h-9 w-full rounded-lg border px-3"
                  >
                    <option value="" disabled>
                      Sin asignar
                    </option>
                    {members
                      .filter((m) =>
                        ['owner', 'admin', 'agent'].includes(m.role)
                      )
                      .map((m) => (
                        <option key={m.user_id} value={m.user_id}>
                          {m.full_name || 'Miembro'} · {m.role}
                        </option>
                      ))}
                  </select>
                </Field>
              )}
              {!readOnly && (
                <div className="bg-muted/20 space-y-4 rounded-xl border p-4">
                  <div>
                    <h3 className="font-semibold">Datos de la oportunidad</h3>
                    <p className="text-muted-foreground text-xs">
                      Información de esta venta concreta.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Tipo de oportunidad">
                      <select
                        value={selected.opportunity_type_id ?? ''}
                        onChange={(e) =>
                          setSelected({
                            ...selected,
                            opportunity_type_id: e.target.value || null,
                          })
                        }
                        className="bg-background h-9 w-full rounded-lg border px-3"
                      >
                        <option value="">Sin tipo</option>
                        {commercial.opportunity_types
                          .filter((item) => item.is_active)
                          .map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field label="Producto, servicio o plan">
                      <select
                        value={selected.catalog_item_id ?? ''}
                        onChange={(e) =>
                          setSelected({
                            ...selected,
                            catalog_item_id: e.target.value || null,
                          })
                        }
                        className="bg-background h-9 w-full rounded-lg border px-3"
                      >
                        <option value="">Sin seleccionar</option>
                        {commercial.catalog_items
                          .filter((item) => item.is_active)
                          .map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                      </select>
                    </Field>
                  </div>
                  {commercial.field_definitions
                    .filter(
                      (field) =>
                        field.is_active &&
                        (!field.opportunity_type_id ||
                          field.opportunity_type_id ===
                            selected.opportunity_type_id)
                    )
                    .map((field) => (
                      <Field
                        key={field.id}
                        label={`${field.name}${field.is_required ? ' *' : ''}`}
                      >
                        <CommercialFieldInput
                          field={field}
                          value={fieldValues[field.id]}
                          onChange={(value) =>
                            setFieldValues((current) => ({
                              ...current,
                              [field.id]: value,
                            }))
                          }
                        />
                      </Field>
                    ))}
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => void saveCommercial()}
                    disabled={saving}
                  >
                    Guardar datos comerciales
                  </Button>
                </div>
              )}
              {!readOnly &&
                selected.assigned_to_user_id &&
                !['won', 'discarded'].includes(selected.status) && (
                  <div className="space-y-4 rounded-xl border p-4">
                    <h3 className="font-semibold">Registrar resultado</h3>
                    <div className="grid grid-cols-2 gap-2">
                      {(Object.keys(resultLabels) as Result[]).map((k) => (
                        <Button
                          key={k}
                          variant={result === k ? 'default' : 'outline'}
                          onClick={() => setResult(k)}
                        >
                          {resultLabels[k]}
                        </Button>
                      ))}
                    </div>
                    <Field label="Canal">
                      <select
                        value={channel}
                        onChange={(e) => setChannel(e.target.value)}
                        className="bg-background h-9 w-full rounded-lg border px-3"
                      >
                        <option value="phone">Llamada</option>
                        <option value="whatsapp">WhatsApp</option>
                        <option value="email">Email</option>
                        <option value="other">Otro</option>
                      </select>
                    </Field>
                    {openResults.includes(result) && (
                      <Field label="Próximo paso">
                        <Input
                          type="datetime-local"
                          value={nextAt}
                          onChange={(e) => setNextAt(e.target.value)}
                        />
                      </Field>
                    )}
                    {result === 'rescheduled' && (
                      <Field label="Motivo">
                        <select
                          value={reasonCode}
                          onChange={(e) => setReasonCode(e.target.value)}
                          className="bg-background h-9 w-full rounded-lg border px-3"
                        >
                          {rescheduleReasons.map((r) => (
                            <option key={r.code} value={r.code}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                    )}
                    {result === 'discarded' && (
                      <Field label="Motivo de descarte">
                        <select
                          value={reasonId}
                          onChange={(e) => setReasonId(e.target.value)}
                          className="bg-background h-9 w-full rounded-lg border px-3"
                        >
                          <option value="">Elegir motivo</option>
                          {reasons.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                        {reasons.find((r) => r.id === reasonId)?.code ===
                          'no_response' && (
                          <p className="text-muted-foreground text-xs">
                            Disponible desde el intento{' '}
                            {workspace.close_no_response_after}.
                          </p>
                        )}
                      </Field>
                    )}
                    {result === 'won' && (
                      <>
                        <Field label="Producto o plan vendido">
                          <Input
                            value={product}
                            onChange={(e) => setProduct(e.target.value)}
                            placeholder={
                              commercial.catalog_items.find(
                                (item) => item.id === selected.catalog_item_id
                              )?.name ?? 'Detalle de la venta'
                            }
                          />
                        </Field>
                        <Field label="Importe opcional (ARS)">
                          <Input
                            type="number"
                            min="0"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                          />
                        </Field>
                      </>
                    )}
                    <Field label="Observación">
                      <Textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                    </Field>
                    <Button
                      className="w-full"
                      onClick={() => void save()}
                      disabled={saving}
                    >
                      Guardar resultado
                    </Button>
                  </div>
                )}
              <div>
                <h3 className="mb-3 font-semibold">Historial</h3>
                <div className="space-y-3">
                  {selected.activities?.map((a) => (
                    <div key={a.id} className="border-l-2 pl-3">
                      <p className="font-medium">
                        {resultLabels[a.result as Result] ?? a.result}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {fmt(a.occurred_at, workspace.timezone)}
                        {a.attempt_number
                          ? ` · intento ${a.attempt_number}`
                          : ''}
                      </p>
                      {a.note && <p className="mt-1 text-sm">{a.note}</p>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
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
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
function CommercialFieldInput({
  field,
  value,
  onChange,
}: {
  field: FieldDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (field.field_type === 'boolean')
    return (
      <select
        value={value === true ? 'true' : value === false ? 'false' : ''}
        onChange={(e) =>
          onChange(e.target.value === '' ? null : e.target.value === 'true')
        }
        className="bg-background h-9 w-full rounded-lg border px-3"
      >
        <option value="">Sin definir</option>
        <option value="true">Sí</option>
        <option value="false">No</option>
      </select>
    );
  if (field.field_type === 'select')
    return (
      <select
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        required={field.is_required}
        className="bg-background h-9 w-full rounded-lg border px-3"
      >
        <option value="">Seleccionar</option>
        {field.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  return (
    <Input
      type={
        field.field_type === 'number'
          ? 'number'
          : field.field_type === 'date'
            ? 'date'
            : 'text'
      }
      value={
        typeof value === 'string' || typeof value === 'number'
          ? String(value)
          : ''
      }
      required={field.is_required}
      onChange={(e) =>
        onChange(
          field.field_type === 'number' && e.target.value !== ''
            ? Number(e.target.value)
            : e.target.value
        )
      }
    />
  );
}
