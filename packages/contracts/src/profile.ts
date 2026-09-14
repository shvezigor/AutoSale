import { z } from 'zod';

export const userLocaleSchema = z.enum(['uk', 'en']);

const phoneSchema = z
  .string()
  .transform((value) => value.replace(/[\s()-]/g, ''))
  .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/));

export const updateProfileRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.union([phoneSchema, z.literal('').transform(() => null), z.null()]),
  locale: userLocaleSchema,
}).strict();

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(12).max(128),
  newPassword: z.string().min(12).max(128),
  confirmation: z.string().min(12).max(128),
}).strict().refine((value) => value.newPassword === value.confirmation, {
  path: ['confirmation'],
  message: 'PASSWORD_CONFIRMATION_MISMATCH',
});

export const profileResponseSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  phone: z.string().nullable(),
  locale: userLocaleSchema,
  avatarUrl: z.string().nullable(),
  membershipRole: z.enum(['OWNER', 'MANAGER']).nullable(),
  signInMethods: z.array(z.enum(['PASSWORD', 'GOOGLE'])),
  canChangePassword: z.boolean(),
  createdAt: z.string().datetime(),
  lastLoginAt: z.string().datetime().nullable(),
}).strict();

export type ProfileResponse = z.infer<typeof profileResponseSchema>;
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;
export type UserLocale = z.infer<typeof userLocaleSchema>;
