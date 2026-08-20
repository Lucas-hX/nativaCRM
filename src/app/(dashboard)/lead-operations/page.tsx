"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Clock3, DatabaseZap, RefreshCw, RotateCcw, Send, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Inbound = { id:string; provider:string; external_event_id:string; status:string; attempt_count:number; last_error_code:string|null; last_error_message:string|null; lead_id:string|null; received_at:string; processed_at:string|null };
type DomainEvent = { id:string; event_type:string; status:string; attempt_count:number; available_at:string; published_at:string|null; last_error_code:string|null; created_at:string };

const tone: Record<string, string> = {
  processed: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  published: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  failed: "border-destructive/30 bg-destructive/10 text-destructive",
  processing: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-300",
  pending: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300",
  received: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300",
};
function Status({ value }: { value: string }) { return <Badge variant="outline" className={tone[value] ?? ""}>{value}</Badge>; }
function when(value: string | null) { return value ? new Intl.DateTimeFormat("es-AR", { dateStyle:"short", timeStyle:"short" }).format(new Date(value)) : "—"; }

export default function LeadOperationsPage() {
  const { canEditSettings, profileLoading } = useAuth();
  const [tab, setTab] = useState<"inbound"|"outbox">("inbound");
  const [inbound, setInbound] = useState<Inbound[]>([]);
  const [events, setEvents] = useState<DomainEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string|null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a,b] = await Promise.all([fetch("/api/admin/lead-operations/inbound-events?limit=100"), fetch("/api/admin/lead-operations/domain-events?limit=100")]);
      if (!a.ok || !b.ok) throw new Error("request failed");
      const [aj,bj] = await Promise.all([a.json(),b.json()]);
      setInbound(aj.data ?? []); setEvents(bj.data ?? []);
    } catch { toast.error("No se pudo cargar el estado operativo"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (canEditSettings) void load(); }, [canEditSettings, load]);

  async function retry(id:string) {
    setRetrying(id);
    try {
      const response = await fetch(`/api/admin/lead-operations/inbound-events/${id}/retry`, { method:"POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudo reintentar");
      toast.success("Evento procesado correctamente"); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo reintentar"); }
    finally { setRetrying(null); }
  }

  if (profileLoading) return <div className="h-40 animate-pulse rounded-xl bg-muted" />;
  if (!canEditSettings) return <Card><CardHeader><CardTitle>Acceso restringido</CardTitle><CardDescription>Operaciones está disponible solamente para administradores y owners.</CardDescription></CardHeader></Card>;

  const failedInbound = inbound.filter(x=>x.status==="failed").length;
  const pendingEvents = events.filter(x=>["pending","processing","failed"].includes(x.status)).length;
  const published = events.filter(x=>x.status==="published").length;
  return <div className="mx-auto flex max-w-7xl flex-col gap-6">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><p className="text-xs font-semibold uppercase tracking-[.18em] text-primary">Administración</p><h2 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Operaciones de leads</h2><p className="mt-1 text-muted-foreground">Supervisá ingresos, reintentos y eventos sin acceder a la base de datos.</p></div>
      <Button variant="outline" onClick={()=>void load()} disabled={loading}><RefreshCw className={loading?"animate-spin":""}/>Actualizar</Button>
    </div>
    <div className="grid gap-3 sm:grid-cols-3">
      <Card><CardContent className="flex items-center gap-3"><span className="rounded-xl bg-destructive/10 p-2 text-destructive"><AlertCircle/></span><div><p className="text-2xl font-semibold">{failedInbound}</p><p className="text-xs text-muted-foreground">Ingresos fallidos</p></div></CardContent></Card>
      <Card><CardContent className="flex items-center gap-3"><span className="rounded-xl bg-amber-500/10 p-2 text-amber-600"><Clock3/></span><div><p className="text-2xl font-semibold">{pendingEvents}</p><p className="text-xs text-muted-foreground">Eventos por entregar</p></div></CardContent></Card>
      <Card><CardContent className="flex items-center gap-3"><span className="rounded-xl bg-emerald-500/10 p-2 text-emerald-600"><CheckCircle2/></span><div><p className="text-2xl font-semibold">{published}</p><p className="text-xs text-muted-foreground">Entregados en la muestra</p></div></CardContent></Card>
    </div>
    <div className="flex w-fit rounded-xl border bg-card p-1"><Button variant={tab==="inbound"?"secondary":"ghost"} onClick={()=>setTab("inbound")}><DatabaseZap/>Ingresos</Button><Button variant={tab==="outbox"?"secondary":"ghost"} onClick={()=>setTab("outbox")}><Send/>Outbox</Button></div>
    {tab==="inbound" ? <Card><CardHeader><CardTitle>Eventos entrantes</CardTitle><CardDescription>El diagnóstico está redactado; los datos de replay permanecen cifrados solamente hasta procesarse.</CardDescription></CardHeader><CardContent className="px-0"><div className="divide-y">
      {inbound.map(row=><div key={row.id} className="grid gap-3 px-4 py-4 md:grid-cols-[1.2fr_1.4fr_.7fr_.6fr_auto] md:items-center"><div><p className="font-medium">{row.provider}</p><p className="truncate text-xs text-muted-foreground">{row.external_event_id}</p></div><div><p className="text-sm">{when(row.received_at)}</p><p className="text-xs text-muted-foreground">{row.lead_id ? `Lead ${row.lead_id.slice(0,8)}` : "Sin lead asociado"}</p></div><Status value={row.status}/><div className="text-sm"><span className="font-medium">{row.attempt_count}</span><span className="text-muted-foreground"> intentos</span></div><div className="flex items-center justify-end gap-2">{row.last_error_code&&<span className="max-w-40 truncate text-xs text-destructive" title={row.last_error_message??row.last_error_code}>{row.last_error_code}</span>}{row.status==="failed"&&<Button size="sm" onClick={()=>void retry(row.id)} disabled={retrying===row.id}><RotateCcw className={retrying===row.id?"animate-spin":""}/>Reintentar</Button>}</div></div>)}
      {!loading&&!inbound.length&&<div className="px-4 py-14 text-center text-muted-foreground"><ShieldCheck className="mx-auto mb-3 size-8"/><p>No hay eventos de ingreso todavía.</p></div>}
    </div></CardContent></Card> : <Card><CardHeader><CardTitle>Eventos de dominio</CardTitle><CardDescription>El worker toma estos eventos con lease y reintenta las entregas fallidas con backoff.</CardDescription></CardHeader><CardContent className="px-0"><div className="divide-y">
      {events.map(row=><div key={row.id} className="grid gap-3 px-4 py-4 md:grid-cols-[1.5fr_1fr_.7fr_.6fr] md:items-center"><div><p className="font-medium">{row.event_type}</p><p className="text-xs text-muted-foreground">{row.id.slice(0,8)} · {when(row.created_at)}</p></div><div className="text-sm"><p>Disponible {when(row.available_at)}</p>{row.published_at&&<p className="text-xs text-muted-foreground">Publicado {when(row.published_at)}</p>}</div><Status value={row.status}/><p className="text-sm">{row.attempt_count} intentos</p></div>)}
      {!loading&&!events.length&&<div className="px-4 py-14 text-center text-muted-foreground"><CheckCircle2 className="mx-auto mb-3 size-8"/><p>La outbox está vacía.</p></div>}
    </div></CardContent></Card>}
  </div>;
}
