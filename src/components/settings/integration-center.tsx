'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Bot, Braces, CheckCircle2, FileSpreadsheet, Loader2, MessageCircle, RefreshCw, Sheet, Sparkles, Workflow, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RequireRole } from '@/components/auth/require-role';
import type { IntegrationDefinition, IntegrationProvider } from '@/lib/integrations/catalog';
import { SettingsPanelHead } from './settings-panel-head';

interface Connection { id:string; provider:IntegrationProvider; status:string; has_credentials:boolean; last_success_at:string|null; last_error_code:string|null }
interface Payload { catalog:IntegrationDefinition[]; connections:Connection[]; builtin:{whatsapp_cloud:{configured:boolean;connected:boolean;status:string}} }
const icons: Record<IntegrationProvider, typeof MessageCircle> = { whatsapp_cloud:MessageCircle,generic_webhook:Braces,make:Workflow,meta_lead_ads:Sparkles,google_sheets:Sheet,csv_import:FileSpreadsheet,openai:Bot,openrouter:Bot };
const categories = [['channel','Canales'],['lead_source','Fuentes de leads'],['automation','Automatización'],['data','Datos e importación'],['ai','Inteligencia artificial']] as const;
function statusLabel(status:string){return({not_configured:'Sin configurar',awaiting_sample:'Esperando muestra',mapping_required:'Mapeo pendiente',ready:'Listo para activar',active:'Activo',degraded:'Requiere atención',paused:'Pausado'} as Record<string,string>)[status]??status;}

export function IntegrationCenter(){
  const [data,setData]=useState<Payload|null>(null);const [loading,setLoading]=useState(true);
  const load=useCallback(async()=>{setLoading(true);try{const response=await fetch('/api/integrations',{cache:'no-store'});if(!response.ok)throw new Error();setData((await response.json()).data);}catch{toast.error('No se pudo cargar el Centro de Integraciones');}finally{setLoading(false);}},[]);
  useEffect(()=>{void load();},[load]);
  if(loading)return <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-primary"/></div>;
  if(!data)return <div className="rounded-xl border border-dashed p-10 text-center"><p>No pudimos cargar las integraciones.</p><Button className="mt-4" variant="outline" onClick={()=>void load()}><RefreshCw/>Reintentar</Button></div>;
  return <RequireRole min="admin"><section className="space-y-8">
    <SettingsPanelHead title="Centro de Integraciones" description="Conectá canales, fuentes de leads, datos y proveedores de IA sin exponer credenciales al equipo comercial." action={<Button variant="outline" onClick={()=>void load()}><RefreshCw/>Actualizar estados</Button>}/>
    <Card className="border-primary/20 bg-primary/5"><CardContent className="flex gap-3 p-4"><Wrench className="mt-0.5 size-5 shrink-0 text-primary"/><div><p className="font-medium">Base técnica protegida por cuenta</p><p className="mt-1 text-sm text-muted-foreground">Sólo owner y admin pueden entrar. Las credenciales se cifran, nunca vuelven al navegador y cada modificación queda preparada para auditoría.</p></div></CardContent></Card>
    {categories.map(([category,label])=>{const items=data.catalog.filter(item=>item.category===category);if(!items.length)return null;return <div key={category} className="space-y-3"><h3 className="text-base font-semibold">{label}</h3><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{items.map(item=>{const Icon=icons[item.provider];const connection=data.connections.find(row=>row.provider===item.provider);const builtin=item.provider==='whatsapp_cloud'?data.builtin.whatsapp_cloud:null;const status=builtin?.status??connection?.status??'not_configured';return <Card key={item.provider} className="flex min-h-56 flex-col"><CardHeader><div className="flex items-start justify-between gap-3"><div className="rounded-xl bg-muted p-2.5"><Icon className="size-5"/></div><Badge className={status==='active'?'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300':status==='degraded'?'bg-destructive/10 text-destructive':'bg-muted text-muted-foreground'}>{status==='active'&&<CheckCircle2 className="mr-1 size-3"/>}{statusLabel(status)}</Badge></div><CardTitle className="mt-3 text-base">{item.name}</CardTitle><CardDescription>{item.description}</CardDescription></CardHeader><CardContent className="mt-auto flex items-center justify-between gap-3"><Badge variant="outline">{item.availability==='available'?'Disponible':item.availability==='foundation'?'Base disponible':'Próximamente'}</Badge>{item.setupPath?<Button size="sm" render={<Link href={item.setupPath}/>}>{builtin?.configured?'Administrar':'Configurar'}</Button>:<Button size="sm" variant="outline" disabled>Configurar</Button>}</CardContent></Card>;})}</div></div>})}
  </section></RequireRole>;
}
