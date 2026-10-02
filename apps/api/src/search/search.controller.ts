import { workspaceSearchQuerySchema, type AuthPrincipal } from '@autosale/contracts';
import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CurrentPrincipal, RequireMembership } from '../auth/auth.decorators.js';
import { SearchService } from './search.service.js';

@ApiTags('search')
@Controller('api/search')
@RequireMembership('MANAGER')
export class SearchController {
  constructor(@Inject(SearchService) private readonly workspaceSearch: SearchService) {}

  @Get()
  search(@CurrentPrincipal() principal: AuthPrincipal, @Query() query: unknown) {
    const parsed = workspaceSearchQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid workspace search query');
    return this.workspaceSearch.search(principal.tenantId!, parsed.data);
  }
}
