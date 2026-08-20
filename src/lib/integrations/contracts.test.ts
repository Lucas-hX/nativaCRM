import { describe, expect, it } from 'vitest';
import { parseCreateIntegration, parseIntegrationSettings, parseSecrets } from './contracts';

describe('integration contracts', () => {
  it('derives category from the trusted provider catalogue', () => {
    expect(parseCreateIntegration({ provider: 'google_sheets', name: 'Ventas', settings: { sheet_id: 'public-id' } })).toMatchObject({ provider: 'google_sheets', category: 'data', name: 'Ventas' });
  });

  it('rejects secret-like values in public settings', () => {
    expect(() => parseCreateIntegration({ provider: 'make', settings: { api_token: 'secret' } })).toThrow(/credentials endpoint/);
    expect(() => parseIntegrationSettings({ settings: { auth: { access_token: 'nested-secret' } } })).toThrow(/credentials endpoint/);
  });

  it('does not duplicate the dedicated WhatsApp credential store', () => {
    expect(() => parseCreateIntegration({ provider: 'whatsapp_cloud' })).toThrow(/dedicated/);
  });

  it('allows only provider-declared credentials', () => {
    expect(parseSecrets('openrouter', { secrets: { api_key: 'sk-test' } })).toEqual({ api_key: 'sk-test' });
    expect(() => parseSecrets('openrouter', { secrets: { password: 'bad-value' } })).toThrow(/Invalid credential/);
  });

  it('validates the minimum Google service account shape', () => {
    expect(() => parseSecrets('google_sheets', { secrets: { service_account_json: '{"type":"user"}' } })).toThrow(/Invalid credential/);
    const serviceAccount = JSON.stringify({ type: 'service_account', client_email: 'robot@example.test', private_key: 'private-key' });
    expect(parseSecrets('google_sheets', { secrets: { service_account_json: serviceAccount } })).toEqual({ service_account_json: serviceAccount });
  });
});
