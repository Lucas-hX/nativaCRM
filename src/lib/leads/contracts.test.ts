import { describe, expect, it } from 'vitest';
import {
  parseAssignment,
  parseCreateLead,
  parseLeadListFilters,
  parseLeadSettings,
  parseRecordResult,
} from './contracts';
import { LeadDomainError } from './errors';

const id = '123e4567-e89b-42d3-a456-426614174000';

describe('lead HTTP contracts', () => {
  it('normalizes a minimal create command and applies provider-neutral defaults', () => {
    expect(
      parseCreateLead({
        contact_id: id,
        next_follow_up_at: '2026-08-21T12:00:00Z',
      })
    ).toMatchObject({
      contactId: id,
      source: 'manual',
      priority: 'normal',
      nextFollowUpAt: '2026-08-21T12:00:00.000Z',
    });
  });

  it('rejects account_id supplied in place of required domain fields', () => {
    expect(() =>
      parseCreateLead({ account_id: id, next_follow_up_at: '2026-08-21' })
    ).toThrow(LeadDomainError);
  });

  it('accepts tenant-defined commercial references without industry fields', () => {
    expect(
      parseCreateLead({
        contact_id: id,
        next_follow_up_at: '2026-08-21',
        opportunity_type_id: id,
        catalog_item_id: id,
        field_values: { coverage_zone: 'north', lines: 4 },
      })
    ).toMatchObject({
      opportunityTypeId: id,
      catalogItemId: id,
      fieldValues: { coverage_zone: 'north', lines: 4 },
    });
  });

  it.each(['no_answer', 'contacted', 'qualified', 'rescheduled'])(
    'requires a next action for %s',
    (result) => {
      expect(() => parseRecordResult({ channel: 'whatsapp', result })).toThrow(
        /next_follow_up_at/
      );
    }
  );

  it('requires a structured reason when discarding', () => {
    expect(() =>
      parseRecordResult({ channel: 'phone', result: 'discarded' })
    ).toThrow(/discard_reason_id/);
  });

  it('requires structured rescheduling and sale data', () => {
    expect(() =>
      parseRecordResult({
        channel: 'phone',
        result: 'rescheduled',
        next_follow_up_at: '2026-08-21',
      })
    ).toThrow(/reason_code/);
    expect(() =>
      parseRecordResult({ channel: 'phone', result: 'won' })
    ).toThrow(/sold_product/);
    expect(
      parseRecordResult({
        channel: 'phone',
        result: 'won',
        sold_product: 'Plan PyME',
        won_amount: 1200,
        won_currency: 'ars',
      })
    ).toMatchObject({
      soldProduct: 'Plan PyME',
      wonAmount: 1200,
      wonCurrency: 'ARS',
    });
  });

  it('creates a provider-neutral assignment result', () => {
    expect(parseAssignment({ assigned_to_user_id: id })).toEqual({
      channel: 'system',
      result: 'assigned',
      assignedToUserId: id,
      note: undefined,
    });
  });

  it('bounds pagination and parses unassigned', () => {
    expect(
      parseLeadListFilters(
        new URLSearchParams('page=2&limit=50&assigned_to=unassigned')
      )
    ).toMatchObject({ page: 2, limit: 50, assignedToUserId: null });
    expect(() =>
      parseLeadListFilters(new URLSearchParams('limit=101'))
    ).toThrow(/between 1 and 100/);
  });

  it('accepts only known lead settings', () => {
    expect(
      parseLeadSettings({ close_no_response_after: 5, require_next_step: true })
    ).toEqual({ closeNoResponseAfter: 5, requireNextStep: true });
    expect(() => parseLeadSettings({ unknown: true })).toThrow(/At least one/);
  });
});
