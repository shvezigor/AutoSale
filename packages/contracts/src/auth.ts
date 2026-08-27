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
  platformRole: 'USER' | 'PLATFORM_ADMIN';
  tenantId: string | null;
  membershipRole: 'OWNER' | 'MANAGER' | null;
  sessionId: string;
}

export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type PublicSession = z.infer<typeof publicSessionSchema>;
