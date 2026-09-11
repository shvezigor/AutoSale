import type { AuthPrincipal } from '@autosale/contracts/auth';
import { deliveryConnectionInputSchema, deliveryLocationQuerySchema, deliverySenderProfileInputSchema } from '@autosale/contracts';
import { NovaPoshtaError } from '@autosale/integrations';
import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Inject, Put, Query } from '@nestjs/common';

import { CurrentPrincipal, RequireMembership } from '../auth/auth.decorators.js';
import { DeliveryService } from './delivery.service.js';
import { DeliveryLocationService } from './delivery-location.service.js';

@Controller('api/integrations/delivery')
export class DeliveryController {
  constructor(@Inject(DeliveryService) private readonly delivery: DeliveryService) {}

  @Get()
  @RequireMembership('MANAGER')
  summary(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.delivery.summary(principal.tenantId!);
  }

  @Put('nova-poshta')
  @RequireMembership('OWNER')
  async connect(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: unknown) {
    assertOwner(principal);
    const parsed = deliveryConnectionInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid Nova Poshta connection');
    try {
      return await this.delivery.connect(principal.tenantId!, principal.userId, parsed.data);
    } catch (error) {
      if (error instanceof NovaPoshtaError) throw new BadRequestException('Nova Poshta rejected the connection');
      throw error;
    }
  }

  @Delete('nova-poshta')
  @RequireMembership('OWNER')
  disconnect(@CurrentPrincipal() principal: AuthPrincipal) {
    assertOwner(principal);
    return this.delivery.disconnect(principal.tenantId!);
  }

  @Get('nova-poshta/sender-profile')
  @RequireMembership('MANAGER')
  senderProfile(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.delivery.senderProfile(principal.tenantId!);
  }

  @Put('nova-poshta/sender-profile')
  @RequireMembership('OWNER')
  saveSenderProfile(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: unknown) {
    assertOwner(principal);
    const parsed = deliverySenderProfileInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid Nova Poshta sender profile');
    return this.delivery.saveSenderProfile(principal.tenantId!, parsed.data);
  }

  @Get('nova-poshta/sender-options')
  @RequireMembership('OWNER')
  senderOptions(@CurrentPrincipal() principal: AuthPrincipal) {
    assertOwner(principal);
    return this.delivery.senderOptions(principal.tenantId!);
  }
}

@Controller('api/delivery')
export class DeliveryLocationController {
  constructor(@Inject(DeliveryLocationService) private readonly locationsService: DeliveryLocationService) {}

  @Get('locations')
  @RequireMembership('MANAGER')
  locations(@CurrentPrincipal() principal: AuthPrincipal, @Query() query: unknown) {
    const parsed = deliveryLocationQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid delivery location search');
    return this.locationsService.search(principal.tenantId!, parsed.data);
  }
}

function assertOwner(principal: AuthPrincipal): void {
  if (principal.membershipRole !== 'OWNER') throw new ForbiddenException('Only workspace owners can configure delivery');
}
