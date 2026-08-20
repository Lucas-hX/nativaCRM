import { NextResponse, type NextRequest } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

const resources = {
  opportunity_type: 'opportunity_types',
  catalog_item: 'catalog_items',
  field_definition: 'lead_field_definitions',
} as const;
type Resource = keyof typeof resources;

function resource(value: unknown): Resource {
  if (typeof value !== 'string' || !(value in resources))
    throw new Error('INVALID_RESOURCE');
  return value as Resource;
}
function text(value: unknown, max: number) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    throw new Error('INVALID_INPUT');
  return value.trim();
}
function code(value: unknown) {
  const result = text(value, 64)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(result)) throw new Error('INVALID_INPUT');
  return result;
}
function payload(kind: Resource, body: Record<string, unknown>) {
  if (kind === 'opportunity_type')
    return {
      name: text(body.name, 100),
      code: code(body.code ?? body.name),
      description:
        typeof body.description === 'string'
          ? body.description.trim() || null
          : null,
      color:
        typeof body.color === 'string' && /^#[0-9a-f]{6}$/i.test(body.color)
          ? body.color
          : '#6366f1',
      is_active: body.is_active !== false,
    };
  if (kind === 'catalog_item') {
    const price =
      body.price === '' || body.price == null ? null : Number(body.price);
    if (price !== null && (!Number.isFinite(price) || price < 0))
      throw new Error('INVALID_INPUT');
    return {
      name: text(body.name, 160),
      sku: typeof body.sku === 'string' ? body.sku.trim() || null : null,
      kind: ['product', 'service', 'plan', 'bundle', 'other'].includes(
        String(body.kind)
      )
        ? body.kind
        : 'service',
      description:
        typeof body.description === 'string'
          ? body.description.trim() || null
          : null,
      price,
      currency:
        typeof body.currency === 'string' ? body.currency.toUpperCase() : null,
      is_active: body.is_active !== false,
    };
  }
  const fieldType = String(body.field_type);
  if (!['text', 'number', 'date', 'boolean', 'select'].includes(fieldType))
    throw new Error('INVALID_INPUT');
  const options =
    fieldType === 'select' && Array.isArray(body.options)
      ? body.options
          .filter(
            (item): item is string => typeof item === 'string' && !!item.trim()
          )
          .map((item) => item.trim())
      : [];
  if (fieldType === 'select' && !options.length)
    throw new Error('INVALID_INPUT');
  return {
    name: text(body.name, 100),
    code: code(body.code ?? body.name),
    field_type: fieldType,
    opportunity_type_id:
      typeof body.opportunity_type_id === 'string' && body.opportunity_type_id
        ? body.opportunity_type_id
        : null,
    options,
    is_required: body.is_required === true,
    is_active: body.is_active !== false,
  };
}
function errorResponse(error: unknown) {
  if (
    error instanceof Error &&
    ['INVALID_INPUT', 'INVALID_RESOURCE'].includes(error.message)
  ) {
    return NextResponse.json(
      { error: 'Datos comerciales inválidos' },
      { status: 400 }
    );
  }
  return toErrorResponse(error);
}

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('viewer');
    const [types, items, fields] = await Promise.all([
      supabase
        .from('opportunity_types')
        .select('*')
        .eq('account_id', accountId)
        .order('sort_order')
        .order('name'),
      supabase
        .from('catalog_items')
        .select('*')
        .eq('account_id', accountId)
        .order('name'),
      supabase
        .from('lead_field_definitions')
        .select('*')
        .eq('account_id', accountId)
        .order('sort_order')
        .order('name'),
    ]);
    const failure = types.error ?? items.error ?? fields.error;
    if (failure) throw failure;
    return NextResponse.json({
      opportunity_types: types.data,
      catalog_items: items.data,
      field_definitions: fields.data,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const body = (await request.json()) as Record<string, unknown>;
    const kind = resource(body.resource);
    const { data, error } = await supabase
      .from(resources[kind])
      .insert({ account_id: accountId, ...payload(kind, body) })
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const body = (await request.json()) as Record<string, unknown>;
    const kind = resource(body.resource);
    const id = text(body.id, 50);
    const { data, error } = await supabase
      .from(resources[kind])
      .update(payload(kind, body))
      .eq('account_id', accountId)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const kind = resource(request.nextUrl.searchParams.get('resource'));
    const id = text(request.nextUrl.searchParams.get('id'), 50);
    const { error } = await supabase
      .from(resources[kind])
      .delete()
      .eq('account_id', accountId)
      .eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
