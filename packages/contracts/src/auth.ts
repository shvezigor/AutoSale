import { z } from 'zod';

const normalizedEmailSchema = z.string().trim().email().transform((value) => value.toLowerCase());
const passwordSchema = z.string().min(12).max(128);

export const registerRequestSchema = z.object({
  email: normalizedEmailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1).max(120),
  tenantName: z.string().trim().min(1).max(160),
}).strict();

export const loginRequestSchema = z.object({
  email: normalizedEmailSchema,
  password: passwordSchema,
}).strict();

export const inviteMemberRequestSchema = z.object({ email: normalizedEmailSchema }).strict();

export const acceptInvitationRequestSchema = z.object({
  token: z.string().min(20),
  name: z.string().trim().min(1).max(120),
  password: passwordSchema,
}).strict();

export const adminTenantSummarySchema = z.object({
  tenantId: z.string().uuid(),
  tenantName: z.string(),
  status: z.enum(['ACTIVE', 'BLOCKED']),
  ownerEmail: normalizedEmailSchema.nullable(),
  userCount: z.number().int().nonnegative(),
  orderCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
}).strict();

export const publicSessionSchema = z.object({
  userId: z.string().uuid(),
  email: normalizedEmailSchema,
  name: z.string(),
  platformRole: z.enum(['USER', 'PLATFORM_ADMIN']),
  tenantId: z.string().uuid().nullable(),
  membershipRole: z.enum(['OWNER', 'MANAGER']).nullable(),
}).strict();

export interface AuthPrincipal {
  userId: string;
  email: string;
  name: string;
  platformRole: 'USER' | 'PLATFORM_ADMIN';
  tenantId: string | null;
  membershipRole: 'OWNER' | 'MANAGER' | null;
  sessionId: string;
}

export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type InviteMemberRequest = z.infer<typeof inviteMemberRequestSchema>;
export type AcceptInvitationRequest = z.infer<typeof acceptInvitationRequestSchema>;
export type AdminTenantSummary = z.infer<typeof adminTenantSummarySchema>;
export type PublicSession = z.infer<typeof publicSessionSchema>;
