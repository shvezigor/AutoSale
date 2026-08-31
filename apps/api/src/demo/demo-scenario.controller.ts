import { Controller, Inject, Post } from '@nestjs/common';
import type { AuthPrincipal } from '@autosale/contracts/auth';

import { CurrentPrincipal, RequireMembership } from '../auth/auth.decorators.js';
import { DemoScenarioService } from './demo-scenario.service.js';

@Controller('api/demo/order-scenario')
@RequireMembership('OWNER')
export class DemoScenarioController {
  constructor(@Inject(DemoScenarioService) private readonly demo: DemoScenarioService) {}

  @Post()
  start(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.demo.start(principal.tenantId!);
  }
}
