import type { AuthPrincipal } from '@autosale/contracts/auth';
import { BadRequestException, Controller, Get, Inject, Param } from '@nestjs/common';
import { z } from 'zod';

import { CurrentPrincipal, RequireMembership } from '../auth/auth.decorators.js';
import { GoogleFilesService } from './google-files.service.js';

const fileIdSchema = z.string().trim().min(5).max(200).regex(/^[A-Za-z0-9_-]+$/);

@Controller('api/integrations/google/files')
@RequireMembership('OWNER')
export class GoogleFilesController {
  constructor(@Inject(GoogleFilesService) private readonly files: GoogleFilesService) {}

  @Get(':fileId/tabs')
  getTabs(@CurrentPrincipal() principal: AuthPrincipal, @Param('fileId') rawFileId: string) {
    const fileId = fileIdSchema.safeParse(rawFileId);
    if (!fileId.success) throw new BadRequestException('Invalid Google file');
    return this.files.getTabs(principal.tenantId!, fileId.data);
  }
}
