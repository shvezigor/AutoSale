import { acceptInvitationRequestSchema, inviteMemberRequestSchema, type AuthPrincipal } from '@autosale/contracts/auth';
import { BadRequestException, Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';

import { CurrentPrincipal, Public, RequireMembership } from '../auth/auth.decorators.js';
import { TeamService } from './team.service.js';

@Controller('api/team')
@RequireMembership('OWNER')
export class TeamController {
  constructor(@Inject(TeamService) private readonly team: TeamService) {}

  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal) { return this.team.list(principal.tenantId!); }

  @Post('invitations')
  invite(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: unknown) {
    const parsed = inviteMemberRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid invitation');
    return this.team.invite(principal.tenantId!, principal.userId, parsed.data.email);
  }

  @Post('invitations/accept')
  @Public()
  accept(@Body() body: unknown) {
    const parsed = acceptInvitationRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid invitation acceptance');
    return this.team.accept(parsed.data.token, { name: parsed.data.name, password: parsed.data.password });
  }

  @Post('invitations/:id/revoke')
  revoke(@CurrentPrincipal() principal: AuthPrincipal, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.team.revokeInvitation(principal.tenantId!, id);
  }

  @Post('members/:id/block')
  block(@CurrentPrincipal() principal: AuthPrincipal, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.team.blockMember(principal.tenantId!, id);
  }
}
