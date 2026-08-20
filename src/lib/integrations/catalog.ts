export type IntegrationCategory = 'channel' | 'lead_source' | 'automation' | 'data' | 'ai';
export type IntegrationAvailability = 'available' | 'foundation' | 'planned';
export type IntegrationProvider =
  | 'whatsapp_cloud'
  | 'generic_webhook'
  | 'make'
  | 'meta_lead_ads'
  | 'google_sheets'
  | 'csv_import'
  | 'openai'
  | 'openrouter';

export interface IntegrationDefinition {
  provider: IntegrationProvider;
  category: IntegrationCategory;
  name: string;
  description: string;
  availability: IntegrationAvailability;
  setupPath?: string;
  secretKeys: readonly string[];
}

export const INTEGRATION_CATALOG: readonly IntegrationDefinition[] = [
  { provider: 'whatsapp_cloud', category: 'channel', name: 'WhatsApp Cloud API', description: 'Mensajes, plantillas, archivos y conversaciones mediante la API oficial de Meta.', availability: 'available', setupPath: '/settings?tab=whatsapp', secretKeys: [] },
  { provider: 'generic_webhook', category: 'lead_source', name: 'Webhook genérico', description: 'Recibí leads desde cualquier sistema mediante el contrato canónico de Leads Nativa.', availability: 'foundation', secretKeys: [] },
  { provider: 'csv_import', category: 'data', name: 'Archivos CSV', description: 'Importación auditable y reutilizable para contactos y leads históricos.', availability: 'foundation', secretKeys: [] },
  { provider: 'make', category: 'automation', name: 'Make', description: 'Conectá Meta Lead Ads y otros orígenes mediante un escenario guiado.', availability: 'foundation', setupPath: '/settings?tab=make', secretKeys: [] },
  { provider: 'meta_lead_ads', category: 'lead_source', name: 'Meta Lead Ads', description: 'Prepará páginas y formularios para la conexión directa con Meta.', availability: 'foundation', setupPath: '/settings?tab=meta-leads', secretKeys: ['access_token'] },
  { provider: 'google_sheets', category: 'data', name: 'Google Sheets', description: 'Prepará una hoja para sincronización e importación de leads.', availability: 'foundation', setupPath: '/settings?tab=google-sheets', secretKeys: ['service_account_json'] },
  { provider: 'openai', category: 'ai', name: 'OpenAI', description: 'Modelos para agentes, clasificación, respuestas y herramientas.', availability: 'planned', secretKeys: ['api_key'] },
  { provider: 'openrouter', category: 'ai', name: 'OpenRouter', description: 'Acceso modular a distintos proveedores y modelos de IA.', availability: 'planned', secretKeys: ['api_key'] },
] as const;

export function integrationDefinition(value: unknown): IntegrationDefinition | null {
  return typeof value === 'string'
    ? INTEGRATION_CATALOG.find((item) => item.provider === value) ?? null
    : null;
}
