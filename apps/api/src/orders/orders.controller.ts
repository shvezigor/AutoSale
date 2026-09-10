import { BadRequestException, Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { ManagerOrderUpdate } from '@autosale/contracts/orders';
import type { AuthPrincipal } from '@autosale/contracts/auth';
import { procurementTransitionSchema } from '@autosale/contracts/procurement';

import { CurrentPrincipal, RequireMembership } from '../auth/auth.decorators.js';
import { OrdersService } from './orders.service.js';

const actorSchema = z.object({ actor: z.string().trim().min(1).max(120) }).strict();
const listSchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  status: z.enum(['AI_PROCESSING', 'AI_FAILED', 'NEEDS_REVIEW', 'AUTO_APPROVED', 'APPROVED', 'CANCELLED']).optional(),
  procurementStatus: z.enum(['UNASSESSED', 'READY', 'PARTIALLY_READY', 'NEEDS_ORDER', 'SENDING', 'AWAITING_SUPPLIER', 'BLOCKED', 'HANDED_OFF']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
const updateSchema = z.object({
  actor: z.string().trim().min(1).max(120),
  customer: z.object({ name: z.string().trim().nullable().optional(), phone: z.string().trim().nullable().optional(), instagramUsername: z.string().trim().nullable().optional() }).strict().optional(),
  delivery: z.object({ city: z.string().trim().nullable().optional(), address: z.string().trim().nullable().optional(), novaPoshtaBranch: z.string().trim().nullable().optional() }).strict().optional(),
  items: z.array(z.object({ id: z.string().min(1), catalogId: z.string().trim().nullable(), quantity: z.number().int().positive(), color: z.string().trim().nullable(), size: z.string().trim().nullable() }).strict()).optional(),
}).strict();

@ApiTags('orders')
@Controller('api/orders')
@RequireMembership('MANAGER')
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}

  @Get() list(@CurrentPrincipal() principal: AuthPrincipal, @Query() query: unknown) {
    const parsed = listSchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid orders query');
    return this.orders.list(principal.tenantId!, parsed.data);
  }

  @Get(':id') detail(@CurrentPrincipal() principal: AuthPrincipal, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.orders.detail(principal.tenantId!, id); }

  @Post(':id/approve') approve(@CurrentPrincipal() principal: AuthPrincipal, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() body: unknown) {
    return this.orders.approve(principal.tenantId!, id, this.actor(body));
  }

  @Post(':id/cancel') cancel(@CurrentPrincipal() principal: AuthPrincipal, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() body: unknown) {
    return this.orders.cancel(principal.tenantId!, id, this.actor(body));
  }

  @Post(':id/sheets-export/retry') retrySheetsExport(@CurrentPrincipal() principal: AuthPrincipal, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.orders.retrySheetsExport(principal.tenantId!, id);
  }

  @Put(':orderId/items/:itemId/procurement')
  setItemProcurement(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('orderId', new ParseUUIDPipe({ version: '4' })) orderId: string,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
    @Body() body: unknown,
  ) {
    const parsed = procurementTransitionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid procurement transition');
    return this.orders.setItemProcurement(
      principal.tenantId!, orderId, itemId, parsed.data.status, principal.userId,
    );
  }

  @Post(':id/hand-off')
  handOff(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.orders.handOff(principal.tenantId!, id, principal.userId);
  }

  @Patch(':id') update(@CurrentPrincipal() principal: AuthPrincipal, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() body: unknown) {
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid order correction');
    const { actor } = parsed.data;
    const changes: ManagerOrderUpdate = {};
    if (parsed.data.customer !== undefined) changes.customer = parsed.data.customer as NonNullable<ManagerOrderUpdate['customer']>;
    if (parsed.data.delivery !== undefined) changes.delivery = parsed.data.delivery as NonNullable<ManagerOrderUpdate['delivery']>;
    if (parsed.data.items !== undefined) changes.items = parsed.data.items;
    return this.orders.update(principal.tenantId!, id, actor, changes);
  }

  private actor(body: unknown): string {
    const parsed = actorSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid manager actor');
    return parsed.data.actor;
  }
}
