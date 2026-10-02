import { createHmac, timingSafeEqual } from 'node:crypto';

import type { AdminReauthPurpose } from '@autosale/contracts';
import type { PrismaClient } from '@autosale/database';
import { UnauthorizedException } from '@nestjs/common';

import type { CryptoService } from '../auth/crypto.service.js';

type StepUpPayload = {
  userId: string;
  sessionId: string;
  purpose: AdminReauthPurpose;
  expiresAt: number;
};

export class AdminStepUpService {
  static readonly TTL_MS = 5 * 60_000;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly crypto: CryptoService,
    private readonly pepper: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async issue(
    userId: string,
    sessionId: string,
    password: string,
    purpose: AdminReauthPurpose,
  ): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true, platformRole: true, status: true },
    });
    if (!user || user.platformRole !== 'PLATFORM_ADMIN' || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('ADMIN_REAUTH_FAILED');
    }
    if (!user.passwordHash) throw new UnauthorizedException('ADMIN_REAUTH_UNAVAILABLE');
    if (!await this.crypto.verifyPassword(user.passwordHash, password)) {
      throw new UnauthorizedException('ADMIN_REAUTH_FAILED');
    }

    return this.issueToken({ userId, sessionId, purpose, expiresAt: this.now().getTime() + AdminStepUpService.TTL_MS });
  }

  verify(token: string, userId: string, sessionId: string, purpose: AdminReauthPurpose): boolean {
    const payload = this.readToken(token);
    return payload !== null
      && payload.userId === userId
      && payload.sessionId === sessionId
      && payload.purpose === purpose
      && payload.expiresAt >= this.now().getTime();
  }

  expiresAt(token: string): string | null {
    const payload = this.readToken(token);
    return payload ? new Date(payload.expiresAt).toISOString() : null;
  }

  private issueToken(payload: StepUpPayload): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = this.sign(body);
    return `${body}.${signature}`;
  }

  private readToken(token: string): StepUpPayload | null {
    try {
      const [body, suppliedSignature, extra] = token.split('.');
      if (!body || !suppliedSignature || extra !== undefined) return null;
      const expected = Buffer.from(this.sign(body), 'base64url');
      const supplied = Buffer.from(suppliedSignature, 'base64url');
      if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
      const value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<StepUpPayload>;
      if (typeof value.userId !== 'string' || typeof value.sessionId !== 'string'
        || value.purpose !== 'TENANT_DELETE_REQUEST' || typeof value.expiresAt !== 'number') return null;
      return value as StepUpPayload;
    } catch {
      return null;
    }
  }

  private sign(body: string): string {
    return createHmac('sha256', this.pepper).update(body).digest('base64url');
  }
}
