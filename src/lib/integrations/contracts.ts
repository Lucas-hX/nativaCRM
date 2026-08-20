import { integrationDefinition, type IntegrationCategory, type IntegrationProvider } from './catalog';

export interface CreateIntegrationCommand {
  provider: IntegrationProvider;
  category: IntegrationCategory;
  name: string;
  externalRef: string | null;
  settings: Record<string, unknown>;
}

const SECRETISH = /secret|token|password|credential|api[_-]?key|private[_-]?key/i;
const MAX_SETTINGS_BYTES = 32_768;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('settings must be an object');
  return value as Record<string, unknown>;
}

function assertPublicSettings(value: Record<string, unknown>): void {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_SETTINGS_BYTES) {
    throw new Error('settings payload is too large');
  }
  const visit = (entry: unknown): void => {
    if (Array.isArray(entry)) {
      entry.forEach(visit);
      return;
    }
    if (!entry || typeof entry !== 'object') return;
    for (const [key, nested] of Object.entries(entry as Record<string, unknown>)) {
      if (SECRETISH.test(key)) throw new Error(`Secret-like setting '${key}' must use the credentials endpoint`);
      visit(nested);
    }
  };
  visit(value);
}

export function parseCreateIntegration(value: unknown): CreateIntegrationCommand {
  const body = object(value);
  const definition = integrationDefinition(body.provider);
  if (!definition) throw new Error('Unsupported integration provider');
  if (definition.provider === 'whatsapp_cloud') throw new Error('WhatsApp uses its dedicated secure setup');
  const name = typeof body.name === 'string' ? body.name.trim() : definition.name;
  if (!name || name.length > 100) throw new Error('name must contain 1 to 100 characters');
  const externalRef = body.external_ref == null ? null : String(body.external_ref).trim();
  if (externalRef && externalRef.length > 200) throw new Error('external_ref is too long');
  const settings = body.settings == null ? {} : object(body.settings);
  assertPublicSettings(settings);
  return { provider: definition.provider, category: definition.category, name, externalRef, settings };
}

export function parseIntegrationSettings(value: unknown): { name?: string; settings?: Record<string, unknown> } {
  const body = object(value);
  const result: { name?: string; settings?: Record<string, unknown> } = {};
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 100) throw new Error('name must contain 1 to 100 characters');
    result.name = body.name.trim();
  }
  if (body.settings !== undefined) {
    const settings = object(body.settings);
    assertPublicSettings(settings);
    result.settings = settings;
  }
  if (!result.name && !result.settings) throw new Error('At least one setting is required');
  return result;
}

export function parseSecrets(provider: IntegrationProvider, value: unknown): Record<string, string> {
  const definition = integrationDefinition(provider);
  const body = object(value);
  const secrets = object(body.secrets);
  if (!definition || definition.secretKeys.length === 0) throw new Error('This provider does not accept stored credentials');
  const parsed: Record<string, string> = {};
  for (const [key, raw] of Object.entries(secrets)) {
    if (!definition.secretKeys.includes(key) || typeof raw !== 'string' || raw.length < 4 || raw.length > 20_000) {
      throw new Error(`Invalid credential '${key}'`);
    }
    parsed[key] = raw;
  }
  if (Object.keys(parsed).length === 0) throw new Error('At least one credential is required');
  if (provider === 'google_sheets' && parsed.service_account_json) {
    let credential: Record<string, unknown>;
    try {
      credential = object(JSON.parse(parsed.service_account_json));
    } catch {
      throw new Error("Invalid credential 'service_account_json'");
    }
    if (credential.type !== 'service_account' || typeof credential.client_email !== 'string' || typeof credential.private_key !== 'string') {
      throw new Error("Invalid credential 'service_account_json'");
    }
  }
  return parsed;
}
