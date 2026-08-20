import 'server-only';

import type { AccountContext } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { encrypt } from '@/lib/whatsapp/encryption';
import { INTEGRATION_CATALOG, integrationDefinition } from './catalog';
import type { CreateIntegrationCommand } from './contracts';

function safeConnection(row: Record<string, unknown>, hasCredentials = false) {
  return {
    id: row.id, provider: row.provider, category: row.category, name: row.name,
    status: row.status, external_ref: row.external_ref, settings: row.settings,
    last_tested_at: row.last_tested_at, last_event_at: row.last_event_at,
    last_success_at: row.last_success_at, last_error_code: row.last_error_code,
    created_at: row.created_at, updated_at: row.updated_at, has_credentials: hasCredentials,
  };
}

export async function listIntegrations(ctx: AccountContext) {
  const [{ data: rows, error }, { data: whatsapp }] = await Promise.all([
    ctx.supabase.from('integration_connections').select('id,provider,category,name,status,external_ref,settings,last_tested_at,last_event_at,last_success_at,last_error_code,created_at,updated_at').eq('account_id', ctx.accountId).order('created_at'),
    ctx.supabase.from('whatsapp_config').select('status,phone_number_id,registered_at,last_registration_error').eq('account_id', ctx.accountId).maybeSingle(),
  ]);
  if (error) throw error;
  const ids = (rows ?? []).map((row) => row.id);
  const credentialIds = new Set<string>();
  if (ids.length) {
    const { data, error: secretError } = await supabaseAdmin().from('integration_secrets').select('integration_id').in('integration_id', ids);
    if (secretError) throw secretError;
    for (const row of data ?? []) credentialIds.add(row.integration_id);
  }
  return {
    catalog: INTEGRATION_CATALOG,
    connections: (rows ?? []).map((row) => safeConnection(row, credentialIds.has(row.id))),
    builtin: {
      whatsapp_cloud: {
        configured: Boolean(whatsapp?.phone_number_id),
        connected: whatsapp?.status === 'connected' && Boolean(whatsapp?.registered_at),
        status: !whatsapp?.phone_number_id ? 'not_configured' : whatsapp?.last_registration_error ? 'degraded' : whatsapp?.registered_at ? 'active' : 'ready',
      },
    },
  };
}

export async function createIntegration(ctx: AccountContext, command: CreateIntegrationCommand) {
  const { data, error } = await ctx.supabase.from('integration_connections').insert({
    account_id: ctx.accountId, provider: command.provider, category: command.category,
    name: command.name, external_ref: command.externalRef, settings: command.settings,
    created_by: ctx.userId, updated_by: ctx.userId,
  }).select('id,provider,category,name,status,external_ref,settings,last_tested_at,last_event_at,last_success_at,last_error_code,created_at,updated_at').single();
  if (error) throw error;
  await ctx.supabase.from('integration_audit_logs').insert({ account_id: ctx.accountId, integration_id: data.id, actor_user_id: ctx.userId, action: 'integration.created', metadata: { provider: command.provider } });
  return safeConnection(data);
}

export async function storeIntegrationSecrets(ctx: AccountContext, id: string, secrets: Record<string, string>) {
  const { data: connection, error } = await ctx.supabase.from('integration_connections').select('id,provider').eq('account_id', ctx.accountId).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!connection) return null;
  const definition = integrationDefinition(connection.provider);
  if (!definition) throw new Error('Unknown integration provider');
  const admin = supabaseAdmin();
  for (const [secretKey, value] of Object.entries(secrets)) {
    if (!definition.secretKeys.includes(secretKey)) throw new Error('Credential is not allowed for this provider');
    const hint = secretKey === 'service_account_json' ? null : value.slice(-4);
    const { error: upsertError } = await admin.from('integration_secrets').upsert({ integration_id: id, secret_key: secretKey, encrypted_value: encrypt(value), value_hint: hint, created_by: ctx.userId, rotated_at: new Date().toISOString() }, { onConflict: 'integration_id,secret_key' });
    if (upsertError) throw upsertError;
  }
  const { error: statusError } = await ctx.supabase
    .from('integration_connections')
    .update({ status: 'ready', updated_by: ctx.userId })
    .eq('account_id', ctx.accountId)
    .eq('id', id);
  if (statusError) throw statusError;
  await ctx.supabase.from('integration_audit_logs').insert({ account_id: ctx.accountId, integration_id: id, actor_user_id: ctx.userId, action: 'integration.credentials_rotated', metadata: { keys: Object.keys(secrets) } });
  return { id, credentials_configured: true };
}

export async function updateIntegration(ctx: AccountContext, id: string, command: { name?: string; settings?: Record<string, unknown> }) {
  const update: Record<string, unknown> = { updated_by: ctx.userId };
  if (command.name) update.name = command.name;
  if (command.settings) update.settings = command.settings;
  const { data, error } = await ctx.supabase.from('integration_connections').update(update).eq('account_id', ctx.accountId).eq('id', id).select('id,provider,category,name,status,external_ref,settings,last_tested_at,last_event_at,last_success_at,last_error_code,created_at,updated_at').maybeSingle();
  if (error) throw error;
  if (!data) return null;
  await ctx.supabase.from('integration_audit_logs').insert({ account_id: ctx.accountId, integration_id: id, actor_user_id: ctx.userId, action: 'integration.settings_updated', metadata: { fields: Object.keys(command) } });
  return safeConnection(data);
}
