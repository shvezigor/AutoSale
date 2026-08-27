import { BadRequestException, Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { ManagerOrderUpdate } from '@autosale/contracts/orders';

import { OrdersService } from './orders.service.js';

const actorSchema = z.object({ actor: z.string().trim().min(1).max(120) }).strict();
const updateSchema = z.object({
  actor: z.string().trim().min(1).max(120),
  customer: z.object({ name: z.string().trim().nullable().optional(), phone: z.string().trim().nullable().optional(), instagramUsername: z.string().trim().nullable().optional() }).strict().optional(),
  delivery: z.object({ city: z.string().trim().nullable().optional(), address: z.string().trim().nullable().optional(), novaPoshtaBranch: z.string().trim().nullable().optional() }).strict().optional(),
  items: z.array(z.object({ id: z.string().min(1), catalogId: z.string().trim().nullable(), quantity: z.number().int().positive(), color: z.string().trim().nullable(), size: z.string().trim().nullable() }).strict()).optional(),
}).strict();

@ApiTags('orders')
@Controller('api/orders')
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}

  @Get() list() { return this.orders.list(); }

  @Get(':id') detail(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.orders.detail(id); }

  @Post(':id/approve') approve(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() body: unknown) {
    return this.orders.approve(id, this.actor(body));
  }

  @Post(':id/cancel') cancel(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() body: unknown) {
    return this.orders.cancel(id, this.actor(body));
  }

  @Post(':id/sheets-export/retry') retrySheetsExport(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.orders.retrySheetsExport(id);
  }

  @Patch(':id') update(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() body: unknown) {
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid order correction');
    const { actor } = parsed.data;
    const changes: ManagerOrderUpdate = {};
    if (parsed.data.customer !== undefined) changes.customer = parsed.data.customer as NonNullable<ManagerOrderUpdate['customer']>;
    if (parsed.data.delivery !== undefined) changes.delivery = parsed.data.delivery as NonNullable<ManagerOrderUpdate['delivery']>;
    if (parsed.data.items !== undefined) changes.items = parsed.data.items;
    return this.orders.update(id, actor, changes);
  }

  private actor(body: unknown): string {
    const parsed = actorSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid manager actor');
    return parsed.data.actor;
  }
}
