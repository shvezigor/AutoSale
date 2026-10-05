import { replyStyleSchema, type ReplyStyle, type ReplyStylePatch } from '@autosale/contracts/reply-drafts';
import { assertTenantAcceptingMutations, type PrismaClient, withTenantTransaction } from '@autosale/database';
import { BadRequestException } from '@nestjs/common';

import { validationBadRequest } from '../common/validation-error.js';

const issueCodes = {
  companyName: 'INVALID_COMPANY_NAME',
  tone: 'INVALID_TONE',
  addressForm: 'INVALID_ADDRESS_FORM',
  guidance: 'INVALID_GUIDANCE',
  enabled: 'INVALID_ENABLED_FLAG',
} as const;

export class ReplyStyleService {
  constructor(private readonly prisma: PrismaClient) {}

  get(tenantId: string): Promise<ReplyStyle> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = await tx.tenantReplyStyle.findUnique({ where: { tenantId } });
      return replyStyleSchema.parse(existing ?? defaults(tenantId));
    });
  }

  update(tenantId: string, patch: ReplyStylePatch): Promise<ReplyStyle> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      await assertTenantAcceptingMutations(tx, tenantId, 'ACCOUNT_ADMINISTRATION');
      const existing = await tx.tenantReplyStyle.findUnique({ where: { tenantId } });
      const merged = replyStyleSchema.safeParse({ ...defaults(tenantId), ...existing, ...patch, tenantId });
      if (!merged.success) throw validationBadRequest(merged.error, issueCodes);
      if (merged.data.enabled && !merged.data.companyName.trim()) {
        throw new BadRequestException({
          statusCode: 400, code: 'VALIDATION_FAILED',
          issues: [{ field: 'companyName', code: 'INVALID_COMPANY_NAME' }],
        });
      }
      const { tenantId: ignoredTenantId, ...data } = merged.data;
      void ignoredTenantId;
      const saved = await tx.tenantReplyStyle.upsert({
        where: { tenantId },
        create: { tenantId, ...data },
        update: data,
      });
      return replyStyleSchema.parse(saved);
    });
  }
}

function defaults(tenantId: string): ReplyStyle {
  return { tenantId, enabled: false, companyName: '', tone: 'NEUTRAL', addressForm: 'FORMAL_YOU', guidance: '' };
}
