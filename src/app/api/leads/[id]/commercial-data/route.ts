import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/account';
import { assertUuid, leadErrorResponse } from '@/lib/leads/http';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    assertUuid(id);
    const { supabase, accountId, userId } = await requireRole('agent');
    const body = (await request.json()) as Record<string, unknown>;
    const opportunityTypeId =
      typeof body.opportunity_type_id === 'string' && body.opportunity_type_id
        ? body.opportunity_type_id
        : null;
    const catalogItemId =
      typeof body.catalog_item_id === 'string' && body.catalog_item_id
        ? body.catalog_item_id
        : null;
    const values =
      body.field_values &&
      typeof body.field_values === 'object' &&
      !Array.isArray(body.field_values)
        ? (body.field_values as Record<string, unknown>)
        : {};

    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .update({
        opportunity_type_id: opportunityTypeId,
        catalog_item_id: catalogItemId,
      })
      .eq('account_id', accountId)
      .eq('id', id)
      .select('id')
      .single();
    if (leadError || !lead) throw leadError ?? new Error('Lead not found');

    const entries = Object.entries(values);
    if (entries.length) {
      const fieldIds = entries.map(([fieldId]) => fieldId);
      const { data: definitions, error } = await supabase
        .from('lead_field_definitions')
        .select('id, field_type, options, is_required')
        .eq('account_id', accountId)
        .in('id', fieldIds);
      if (error || definitions?.length !== fieldIds.length)
        throw error ?? new Error('Invalid field');
      const rows = definitions.map((definition) => {
        const value = values[definition.id];
        if (definition.is_required && (value === null || value === ''))
          throw new Error('Required field missing');
        return {
          account_id: accountId,
          lead_id: id,
          field_definition_id: definition.id,
          value,
          updated_by: userId,
        };
      });
      const { error: valuesError } = await supabase
        .from('lead_field_values')
        .upsert(rows, { onConflict: 'lead_id,field_definition_id' });
      if (valuesError) throw valuesError;
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return leadErrorResponse(error);
  }
}
