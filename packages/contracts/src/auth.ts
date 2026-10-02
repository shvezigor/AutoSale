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

export const instagramConnectionRequestSchema = z.object({
  externalAccountId: z.string().trim().regex(/^\d{5,64}$/),
  displayName: z.string().trim().min(1).max(160).nullable().optional(),
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

export const adminQueueNameSchema = z.enum(['instagram', 'catalogue', 'delivery', 'telegram', 'tenant-lifecycle']);

export const adminQueueSummarySchema = z.object({
  queue: adminQueueNameSchema,
  status: z.enum(['HEALTHY', 'IDLE', 'ATTENTION']),
  waiting: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  delayed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  workerCount: z.number().int().nonnegative(),
  oldestPendingAt: z.string().datetime().nullable(),
  available: z.boolean(),
}).strict();

export const adminOperationsSummarySchema = z.object({
  status: z.enum(['HEALTHY', 'DEGRADED']),
  database: z.literal('HEALTHY'),
  updatedAt: z.string().datetime(),
  queues: z.array(adminQueueSummarySchema),
}).strict();

export const adminPlatformOverviewSchema = z.object({
  status: z.enum(['HEALTHY', 'DEGRADED']),
  updatedAt: z.string().datetime(),
  attentionQueueCount: z.number().int().nonnegative(),
  metrics: z.object({
    tenantCount: z.number().int().nonnegative(),
    activeTenantCount: z.number().int().nonnegative(),
    blockedTenantCount: z.number().int().nonnegative(),
    userCount: z.number().int().nonnegative(),
    orderCount: z.number().int().nonnegative(),
    newTenantCount30Days: z.number().int().nonnegative(),
  }).strict(),
}).strict();

export const publicSessionSchema = z.object({
  userId: z.string().uuid(),
  email: normalizedEmailSchema,
  name: z.string(),
  platformRole: z.enum(['USER', 'PLATFORM_ADMIN']),
  tenantId: z.string().uuid().nullable(),
  membershipRole: z.enum(['OWNER', 'MANAGER']).nullable(),
  locale: z.enum(['uk', 'en']),
  avatarUrl: z.string().nullable(),
}).strict();

export interface AuthPrincipal {
  userId: string;
  email: string;
  name: string;
  platformRole: 'USER' | 'PLATFORM_ADMIN';
  tenantId: string | null;
  membershipRole: 'OWNER' | 'MANAGER' | null;
  locale: 'uk' | 'en';
  avatarUrl: string | null;
  sessionId: string;
}

export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type InviteMemberRequest = z.infer<typeof inviteMemberRequestSchema>;
export type AcceptInvitationRequest = z.infer<typeof acceptInvitationRequestSchema>;
export type AdminTenantSummary = z.infer<typeof adminTenantSummarySchema>;
export type AdminQueueName = z.infer<typeof adminQueueNameSchema>;
export type AdminQueueSummary = z.infer<typeof adminQueueSummarySchema>;
export type AdminOperationsSummary = z.infer<typeof adminOperationsSummarySchema>;
export type AdminPlatformOverview = z.infer<typeof adminPlatformOverviewSchema>;
export type PublicSession = z.infer<typeof publicSessionSchema>;
