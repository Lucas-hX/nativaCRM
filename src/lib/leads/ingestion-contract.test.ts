import { describe, expect, it } from 'vitest';
import {
  IngestionValidationError,
  parseCanonicalLeadIntake,
  redactedIntakePayload,
} from './ingestion-contract';

describe('canonical lead intake contract', () => {
  it('normalizes a minimal provider-neutral event', () => {
    expect(
      parseCanonicalLeadIntake({
        provider: 'MAKE',
        event_id: 'evt-1',
        contact: { phone: '+54 11 5555 1234' },
      })
    ).toMatchObject({
      provider: 'make',
      eventId: 'evt-1',
      contact: { phone: '+54 11 5555 1234' },
      opportunity: { source: 'make', priority: 'normal' },
      metadata: {},
    });
  });
  it.each([
    [{ event_id: 'x', contact: { phone: '+541155551234' } }, 'provider'],
    [{ provider: 'make', event_id: 'x', contact: { phone: '123' } }, 'phone'],
    [
      {
        provider: 'make',
        event_id: 'bad id',
        contact: { phone: '+541155551234' },
      },
      'event_id',
    ],
    [
      {
        provider: 'make',
        event_id: 'x',
        contact: { phone: '+541155551234' },
        opportunity: { priority: 'critical' },
      },
      'priority',
    ],
  ])('rejects invalid input %#', (body, message) => {
    expect(() => parseCanonicalLeadIntake(body)).toThrow(message);
    expect(() => parseCanonicalLeadIntake(body)).toThrow(
      IngestionValidationError
    );
  });
  it('maps generic opportunity type, catalog and field codes', () => {
    expect(
      parseCanonicalLeadIntake({
        provider: 'store',
        event_id: 'order-1',
        contact: { phone: '+541155551234' },
        opportunity: {
          opportunity_type_code: 'new_sale',
          catalog_sku: 'PLAN-10',
          fields: { current_provider: 'other', line_count: 2 },
        },
      })
    ).toMatchObject({
      opportunity: {
        opportunityTypeCode: 'new_sale',
        catalogSku: 'PLAN-10',
        fields: { current_provider: 'other', line_count: 2 },
      },
    });
  });
  it('redacts direct personal contact fields from the audit payload', () => {
    const input = parseCanonicalLeadIntake({
      provider: 'make',
      event_id: 'evt',
      contact: {
        phone: '+541155551234',
        name: 'Ada',
        email: 'ada@example.test',
      },
      metadata: { unsafe_value: 'never persist this value' },
    });
    const serialized = JSON.stringify(redactedIntakePayload(input));
    expect(serialized).toContain('1234');
    expect(serialized).not.toContain('+541155551234');
    expect(serialized).not.toContain('ada@example.test');
    expect(serialized).not.toContain('Ada');
    expect(serialized).toContain('unsafe_value');
    expect(serialized).not.toContain('never persist this value');
  });
});
