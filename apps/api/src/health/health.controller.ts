import { metrics } from '@autosale/observability';
import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../auth/auth.decorators.js';

metrics.increment('autosale_api_info');

@Controller()
@Public()
export class HealthController {
  @Get('health/live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('metrics')
  @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  metrics(): string { return metrics.render(); }
}
