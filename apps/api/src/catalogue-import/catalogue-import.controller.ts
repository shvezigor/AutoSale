import type { AuthPrincipal } from '@autosale/contracts/auth';
import { BadRequestException, Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { CurrentPrincipal, RequireMembership } from '../auth/auth.decorators.js';
import { CatalogueImportService, MAX_CATALOGUE_UPLOAD_BYTES } from './catalogue-import.service.js';

const targetSchema = z.enum([
  'sku', 'name', 'description', 'price', 'currency', 'stockQuantity',
  'category', 'brand', 'aliases', 'color', 'size', 'imageUrls', 'active', 'attributes', 'ignore',
]);
const mappingSchema = z.object({
  columns: z.array(z.object({
    source: z.string().trim().min(1).max(500),
    target: targetSchema,
    confidence: z.number().min(0).max(1).optional(),
  }).strict()).min(2).max(100),
  clearEmptyFields: z.array(targetSchema.exclude(['sku', 'name', 'active', 'ignore'])).max(12).optional(),
}).strict();

type MultipartFile = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
};

@ApiTags('catalogue-imports')
@Controller('api/catalogue/imports')
@RequireMembership('OWNER')
export class CatalogueImportController {
  constructor(@Inject(CatalogueImportService) private readonly imports: CatalogueImportService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_CATALOGUE_UPLOAD_BYTES, files: 1 } }))
  upload(@CurrentPrincipal() principal: AuthPrincipal, @UploadedFile() file: MultipartFile | undefined) {
    if (!file || !validFilePair(file.originalname, file.mimetype)) throw new BadRequestException('Invalid catalogue upload');
    return this.imports.upload(principal.tenantId!, principal.userId, {
      originalName: file.originalname,
      mediaType: file.mimetype,
      buffer: file.buffer,
    });
  }

  @Patch(':id/mapping')
  updateMapping(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: unknown,
  ) {
    const parsed = mappingSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid catalogue mapping');
    return this.imports.updateMapping(principal.tenantId!, principal.userId, id, parsed.data);
  }

  @Get(':id')
  status(@CurrentPrincipal() principal: AuthPrincipal, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.imports.status(principal.tenantId!, id);
  }

  @Get(':id/preview')
  preview(@CurrentPrincipal() principal: AuthPrincipal, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.imports.preview(principal.tenantId!, id);
  }

  @Post(':id/confirm')
  confirm(@CurrentPrincipal() principal: AuthPrincipal, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.imports.confirm(principal.tenantId!, principal.userId, id);
  }
}

function validFilePair(fileName: string, mediaType: string): boolean {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv')) return mediaType === 'text/csv' || mediaType === 'application/csv';
  if (lower.endsWith('.xlsx')) return mediaType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return false;
}
