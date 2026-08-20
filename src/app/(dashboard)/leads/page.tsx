"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, CircleDot, Inbox, MessageCircle, RefreshCw, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Lead = { id:string; status:string; priority:string; attempt_count:number; received_at:string; company:string|null; plan:string|null; assigned_to_user_id:string|null; contact?:{id:string;name:string|null;phone:string}|null; pending_tasks?:Array<{due_at:string}> };
type View = "today"|"new"|"followup"|"overdue"|"all";
const views: Array<{key:View;label:string;icon:typeof Inbox}> = [
  {key:"today",label:"Para hoy",icon:CalendarClock},{key:"new",label:"Nuevos",icon:Sparkles},{key:"followup",label:"Seguimientos",icon:RefreshCw},{key:"overdue",label:"Vencidos",icon:AlertTriangle},{key:"all",label:"Todos",icon:CircleDot},
];
const stateLabel:Record<string,string>={new:"Nuevo",in_progress:"En gestión",follow_up:"Seguimiento",won:"Vendido",discarded:"Descartado"};
const stateTone:Record<string,string>={new:"bg-violet-500/10 text-violet-600 dark:text-violet-300",in_progress:"bg-blue-500/10 text-blue-600 dark:text-blue-300",follow_up:"bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",won:"bg-amber-500/10 text-amber-600 dark:text-amber-300",discarded:"bg-muted text-muted-foreground"};
function task(lead:Lead){return lead.pending_tasks?.[0]?.due_at??null;}
function formatDate(value:string){return new Intl.DateTimeFormat("es-AR",{dateStyle:"short",timeStyle:"short"}).format(new Date(value));}

export default function LeadsPage(){
  const [view,setView]=useState<View>("today"); const [search,setSearch]=useState(""); const [leads,setLeads]=useState<Lead[]>([]); const [loading,setLoading]=useState(true);
  const load=useCallback(async()=>{setLoading(true);try{const response=await fetch("/api/leads?limit=100");if(!response.ok)throw new Error();const body=await response.json();setLeads(body.data??[]);}catch{toast.error("No se pudieron cargar los leads");}finally{setLoading(false);}},[]);
  useEffect(()=>{void load();},[load]);
  const now=Date.now();
  const {startTime,endTime}=useMemo(()=>{const start=new Date();start.setHours(0,0,0,0);const end=new Date();end.setHours(23,59,59,999);return{startTime:start.getTime(),endTime:end.getTime()};},[]);
  const filtered=useMemo(()=>leads.filter(lead=>{
    const due=task(lead)?new Date(task(lead)!).getTime():null; const open=!['won','discarded'].includes(lead.status);
    const matchesView=view==="all"||(view==="new"&&lead.status==="new")||(view==="followup"&&lead.status==="follow_up")||(view==="overdue"&&open&&due!==null&&due<startTime)||(view==="today"&&open&&due!==null&&due>=startTime&&due<=endTime);
    const term=search.trim().toLowerCase(); const matchesSearch=!term||[lead.contact?.name,lead.contact?.phone,lead.company,lead.plan].some(x=>x?.toLowerCase().includes(term)); return matchesView&&matchesSearch;
  }),[leads,view,search,startTime,endTime]);
  const counts=Object.fromEntries(views.map(v=>[v.key,leads.filter(l=>{const due=task(l)?new Date(task(l)!).getTime():null;const open=!['won','discarded'].includes(l.status);return v.key==='all'||(v.key==='new'&&l.status==='new')||(v.key==='followup'&&l.status==='follow_up')||(v.key==='overdue'&&open&&due!==null&&due<startTime)||(v.key==='today'&&open&&due!==null&&due>=startTime&&due<=endTime);}).length]));
  return <div className="mx-auto flex max-w-7xl flex-col gap-6">
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-primary">Base comercial</p><h2 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Mi trabajo</h2><p className="mt-1 text-muted-foreground">Cada lead abierto conserva un próximo paso.</p></div><Button variant="outline" onClick={()=>void load()} disabled={loading}><RefreshCw className={loading?"animate-spin":""}/>Actualizar</Button></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{views.map(v=><button key={v.key} onClick={()=>setView(v.key)} className={`flex min-h-24 items-center gap-3 rounded-xl border p-4 text-left transition ${view===v.key?"border-primary bg-primary/5 ring-1 ring-primary/20":"bg-card hover:bg-muted/50"}`}><span className="rounded-xl bg-muted p-2"><v.icon className="size-5"/></span><span><strong className="block text-2xl">{counts[v.key]}</strong><span className="text-sm text-muted-foreground">{v.label}</span></span></button>)}</div>
    <Card><CardContent className="space-y-4"><div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"/><Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar por nombre, teléfono, compañía o plan" className="pl-9"/></div>
      <div className="overflow-hidden rounded-xl border"><div className="hidden grid-cols-[1.5fr_.8fr_.7fr_.7fr_1fr_auto] gap-4 bg-muted/50 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground md:grid"><span>Contacto</span><span>Estado</span><span>Intentos</span><span>Ingreso</span><span>Próximo paso</span><span></span></div><div className="divide-y">
      {filtered.map(lead=>{const due=task(lead);const overdue=due&&new Date(due).getTime()<now;return <div key={lead.id} className="grid gap-3 px-4 py-4 transition hover:bg-muted/30 md:grid-cols-[1.5fr_.8fr_.7fr_.7fr_1fr_auto] md:items-center"><div><p className="font-medium">{lead.contact?.name??lead.contact?.phone??"Contacto"}</p><p className="text-xs text-muted-foreground">{lead.contact?.phone} {lead.company?`· ${lead.company}`:""} {lead.plan?`· ${lead.plan}`:""}</p></div><Badge className={stateTone[lead.status]}>{stateLabel[lead.status]??lead.status}</Badge><p className="text-sm"><strong>{lead.attempt_count}</strong> intentos</p><p className="text-sm text-muted-foreground">{formatDate(lead.received_at)}</p><div><p className={overdue?"font-medium text-destructive":"font-medium"}>{due?formatDate(due):"Sin tarea"}</p>{overdue&&<p className="text-xs text-destructive">Vencido</p>}</div><Button variant="outline" size="sm" render={<Link href="/inbox"/>}><MessageCircle/>WhatsApp</Button></div>})}
      {!loading&&!filtered.length&&<div className="px-4 py-16 text-center"><Inbox className="mx-auto mb-3 size-9 text-muted-foreground"/><p className="font-medium">No hay leads en esta bandeja</p><p className="text-sm text-muted-foreground">Probá otra vista o cambiá la búsqueda.</p></div>}
      </div></div></CardContent></Card>
  </div>;
}
