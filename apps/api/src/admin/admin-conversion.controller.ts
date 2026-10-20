import { BadRequestException, Controller, Get, Header, Inject, Query } from '@nestjs/common';
import { z } from 'zod';

import { RequirePlatformAdmin } from '../auth/auth.decorators.js';
import { AdminConversionService, validReportRange } from './admin-conversion.service.js';

const querySchema = z.object({ from: z.string(), to: z.string() }).strict();

@Controller('api/admin/conversions')
@RequirePlatformAdmin()
export class AdminConversionController {
  constructor(@Inject(AdminConversionService) private readonly conversions: AdminConversionService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  report(@Query() query: unknown) {
    const parsed = querySchema.safeParse(query);
    if (!parsed.success || !validReportRange(parsed.data.from, parsed.data.to)) {
      throw new BadRequestException('CONVERSION_REPORT_RANGE_INVALID');
    }
    return this.conversions.report(parsed.data.from, parsed.data.to);
  }
}
