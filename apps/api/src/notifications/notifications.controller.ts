import type { AuthPrincipal } from '@autosale/contracts/auth';
import { Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';

import { CurrentPrincipal, RequireMembership } from '../auth/auth.decorators.js';
import { NotificationService } from './notifications.service.js';

@Controller('api/notifications')
@RequireMembership('MANAGER')
export class NotificationsController {
  constructor(@Inject(NotificationService) private readonly notifications: NotificationService) {}

  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal, @Query('limit') limit?: string) {
    const parsed = Number.parseInt(limit ?? '20', 10);
    return this.notifications.list(principal.tenantId!, principal.userId, Number.isFinite(parsed) ? parsed : 20);
  }

  @Post('read-all')
  markAllRead(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.notifications.markAllRead(principal.tenantId!, principal.userId);
  }

  @Post(':id/read')
  markRead(@CurrentPrincipal() principal: AuthPrincipal, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.notifications.markRead(principal.tenantId!, principal.userId, id);
  }
}
