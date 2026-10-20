import { z } from 'zod';

export const adminDemoLeadStatusSchema = z.enum(['NEW', 'CONTACTED', 'QUALIFIED', 'CLOSED']);
export const adminDemoLeadNotificationStatusSchema = z.enum(['PENDING', 'SENT', 'FAILED']);
export const adminDemoLeadListQuerySchema = z.object({
  status: adminDemoLeadStatusSchema.optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().positive().optional(),
}).strict();
export const adminDemoLeadStatusInputSchema = z.object({
  status: adminDemoLeadStatusSchema,
  expectedVersion: z.number().int().nonnegative(),
}).strict();
export const adminDemoLeadSummarySchema = z.object({
  id: z.uuid(), company: z.string(), maskedContact: z.string(), status: adminDemoLeadStatusSchema,
  notificationStatus: adminDemoLeadNotificationStatusSchema, createdAt: z.iso.datetime(), version: z.number().int(),
}).strict();
export const adminDemoLeadListSchema = z.object({
  items: z.array(adminDemoLeadSummarySchema), nextCursor: z.uuid().nullable(),
}).strict();
export const adminDemoLeadDetailSchema = z.object({
  id: z.uuid(), name: z.string(), company: z.string(), email: z.string().nullable(), phone: z.string().nullable(),
  orderVolume: z.string(), note: z.string().nullable(), locale: z.enum(['uk', 'en']), consentVersion: z.string(),
  consentedAt: z.iso.datetime(), status: adminDemoLeadStatusSchema, notificationStatus: adminDemoLeadNotificationStatusSchema,
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), version: z.number().int(), lastOperatorActionAt: z.iso.datetime().nullable(),
}).strict();

export type AdminDemoLeadStatus = z.infer<typeof adminDemoLeadStatusSchema>;
export type AdminDemoLeadSummary = z.infer<typeof adminDemoLeadSummarySchema>;
export type AdminDemoLeadList = z.infer<typeof adminDemoLeadListSchema>;
export type AdminDemoLeadDetail = z.infer<typeof adminDemoLeadDetailSchema>;
