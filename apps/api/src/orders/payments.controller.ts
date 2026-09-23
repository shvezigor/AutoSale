import type { AuthPrincipal } from '@autosale/contracts/auth';
import { cancelOrderPaymentSchema, createOrderPaymentSchema } from '@autosale/contracts/payments';
import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';

import { CurrentPrincipal, RequireMembership } from '../auth/auth.decorators.js';
import { PaymentsService } from './payments.service.js';
import { validationBadRequest } from '../common/validation-error.js';

const uuidPipe = new ParseUUIDPipe({ version: '4' });
const paymentIssueCodes = { amount: 'INVALID_AMOUNT', receivedAt: 'INVALID_RECEIVED_AT', method: 'INVALID_METHOD', bankAccountId: 'INVALID_BANK_ACCOUNT', carrier: 'INVALID_CARRIER', note: 'INVALID_NOTE', idempotencyKey: 'INVALID_IDEMPOTENCY_KEY' } as const;
const cancellationIssueCodes = { reason: 'INVALID_REASON', idempotencyKey: 'INVALID_IDEMPOTENCY_KEY' } as const;

@Controller('api/orders')
@RequireMembership('MANAGER')
export class PaymentsController {
  constructor(@Inject(PaymentsService) private readonly payments: PaymentsService) {}

  @Get(':id/payments')
  get(@CurrentPrincipal() principal: AuthPrincipal, @Param('id', uuidPipe) id: string) {
    return this.payments.get(principal.tenantId!, id);
  }

  @Post(':id/payments')
  record(@CurrentPrincipal() principal: AuthPrincipal, @Param('id', uuidPipe) id: string, @Body() body: unknown) {
    const parsed = createOrderPaymentSchema.safeParse(body);
    if (!parsed.success) throw validationBadRequest(parsed.error, paymentIssueCodes);
    return this.payments.record(principal.tenantId!, id, principal.userId, parsed.data);
  }

  @Post(':id/payments/:paymentId/cancel')
  @RequireMembership('OWNER')
  cancel(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', uuidPipe) id: string,
    @Param('paymentId', uuidPipe) paymentId: string,
    @Body() body: unknown,
  ) {
    const parsed = cancelOrderPaymentSchema.safeParse(body);
    if (!parsed.success) throw validationBadRequest(parsed.error, cancellationIssueCodes);
    return this.payments.cancel(principal.tenantId!, id, paymentId, principal.userId, parsed.data);
  }
}
