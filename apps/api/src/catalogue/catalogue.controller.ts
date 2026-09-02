import type { AuthPrincipal } from '@autosale/contracts/auth';
import { BadRequestException, Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { CurrentPrincipal, RequireMembership } from '../auth/auth.decorators.js';
import { CatalogueService, type CatalogueProductCreate, type CatalogueProductUpdate } from './catalogue.service.js';

const nullableText = z.string().trim().max(10_000).nullable();
const productFieldsSchema = z.object({
  sku: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(500),
  description: nullableText,
  price: z.number().finite().nonnegative().nullable(),
  currency: z.string().trim().length(3).nullable(),
  stockQuantity: z.number().int().nullable(),
  category: nullableText,
  brand: nullableText,
  aliases: z.array(z.string().trim().min(1).max(500)).max(200),
  color: nullableText,
  size: nullableText,
  imageUrls: z.array(z.string().url()).max(50),
  attributes: z.record(z.string().min(1).max(120), z.unknown()),
  active: z.boolean(),
}).strict();

const createSchema = productFieldsSchema.pick({ sku: true, name: true }).extend({
  description: productFieldsSchema.shape.description.optional(),
  price: productFieldsSchema.shape.price.optional(),
  currency: productFieldsSchema.shape.currency.optional(),
  stockQuantity: productFieldsSchema.shape.stockQuantity.optional(),
  category: productFieldsSchema.shape.category.optional(),
  brand: productFieldsSchema.shape.brand.optional(),
  aliases: productFieldsSchema.shape.aliases.optional(),
  color: productFieldsSchema.shape.color.optional(),
  size: productFieldsSchema.shape.size.optional(),
  imageUrls: productFieldsSchema.shape.imageUrls.optional(),
  attributes: productFieldsSchema.shape.attributes.optional(),
  active: productFieldsSchema.shape.active.optional(),
}).superRefine(validateAliases);

const updateSchema = productFieldsSchema.partial().refine((value) => Object.keys(value).length > 0).superRefine(validateAliases);

const listSchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

@ApiTags('catalogue')
@Controller('api/catalogue')
@RequireMembership('MANAGER')
export class CatalogueController {
  constructor(@Inject(CatalogueService) private readonly catalogue: CatalogueService) {}

  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal, @Query() query: unknown) {
    const parsed = listSchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid catalogue query');
    return this.catalogue.list(principal.tenantId!, parsed.data);
  }

  @Post()
  @RequireMembership('OWNER')
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: unknown) {
    return this.catalogue.create(principal.tenantId!, parseCreate(body));
  }

  @Patch(':id')
  @RequireMembership('OWNER')
  update(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: unknown,
  ) {
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid catalogue product');
    return this.catalogue.update(principal.tenantId!, id, parsed.data as CatalogueProductUpdate);
  }
}

function parseCreate(body: unknown): CatalogueProductCreate {
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) throw new BadRequestException('Invalid catalogue product');
  return parsed.data;
}

function validateAliases(value: { aliases?: string[] | undefined }, context: z.RefinementCtx): void {
  if (value.aliases && new Set(value.aliases).size !== value.aliases.length) {
    context.addIssue({ code: 'custom', path: ['aliases'], message: 'Aliases must be unique' });
  }
}
