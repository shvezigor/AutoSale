import type { AuthPrincipal } from '@autosale/contracts/auth';
import { googleCatalogueSourceInputSchema } from '@autosale/contracts';
import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CurrentPrincipal, RequireMembership } from '../auth/auth.decorators.js';
import { CatalogueSourcesService } from './catalogue-sources.service.js';

@ApiTags('catalogue-sources')
@Controller('api/catalogue/sources')
@RequireMembership('MANAGER')
export class CatalogueSourcesController {
  constructor(@Inject(CatalogueSourcesService) private readonly sources: CatalogueSourcesService) {}

  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.sources.listHealth(principal.tenantId!);
  }

  @Get(':id')
  @RequireMembership('OWNER')
  get(@CurrentPrincipal() principal: AuthPrincipal, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.sources.getConfiguration(principal.tenantId!, id);
  }

  @Post()
  @RequireMembership('OWNER')
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: unknown) {
    const input = parseInput(body);
    return this.sources.create(principal.tenantId!, principal.userId, input);
  }

  @Patch(':id')
  @RequireMembership('OWNER')
  update(@CurrentPrincipal() principal: AuthPrincipal, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() body: unknown) {
    return this.sources.update(principal.tenantId!, id, parseInput(body));
  }

  @Delete(':id')
  @RequireMembership('OWNER')
  remove(@CurrentPrincipal() principal: AuthPrincipal, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.sources.remove(principal.tenantId!, id);
  }

  @Post(':id/check')
  @RequireMembership('OWNER')
  check(@CurrentPrincipal() principal: AuthPrincipal, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.sources.checkConnectivity(principal.tenantId!, id);
  }

  @Post(':id/sync')
  @RequireMembership('OWNER')
  synchronize(@CurrentPrincipal() principal: AuthPrincipal, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.sources.synchronizeNow(principal.tenantId!, id);
  }
}

function parseInput(body: unknown) {
  const parsed = googleCatalogueSourceInputSchema.safeParse(body);
  if (!parsed.success) throw new BadRequestException('Invalid Google catalogue source');
  return parsed.data;
}
