import { BadRequestException, Body, Controller, Get, Inject, Patch } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthPrincipal } from '@autosale/contracts/auth';

import { CurrentPrincipal, RequireMembership } from '../auth/auth.decorators.js';
import {
  OrderSettingsService,
  type OrderSettingsResponse,
  type UpdateOrderSettingsInput,
} from './order-settings.service.js';

const updateSchema = z
  .object({
    approvalMode: z.enum(['ALWAYS', 'NEVER', 'ON_LOW_CONFIDENCE']).optional(),
    autoApprovalThreshold: z.number().min(0).max(1).optional(),
    triggerPhrases: z.array(z.string().trim().min(1)).min(1).optional(),
  })
  .refine((value) => Object.keys(value).length > 0);

@ApiTags('settings')
@Controller('api/settings/orders')
@RequireMembership('OWNER')
export class OrderSettingsController {
  constructor(@Inject(OrderSettingsService) private readonly settings: OrderSettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get order processing settings' })
  @ApiOkResponse({ description: 'Current order processing settings' })
  get(@CurrentPrincipal() principal: AuthPrincipal): Promise<OrderSettingsResponse> {
    return this.settings.get(principal.tenantId!);
  }

  @Patch()
  @ApiOperation({ summary: 'Update order processing settings' })
  @ApiOkResponse({ description: 'Updated order processing settings' })
  update(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: unknown): Promise<OrderSettingsResponse> {
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid order settings');
    const input: UpdateOrderSettingsInput = {};
    if (parsed.data.approvalMode !== undefined) input.approvalMode = parsed.data.approvalMode;
    if (parsed.data.autoApprovalThreshold !== undefined) {
      input.autoApprovalThreshold = parsed.data.autoApprovalThreshold;
    }
    if (parsed.data.triggerPhrases !== undefined) input.triggerPhrases = parsed.data.triggerPhrases;
    return this.settings.update(principal.tenantId!, input);
  }
}
