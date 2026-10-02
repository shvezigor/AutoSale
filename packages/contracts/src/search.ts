import { z } from 'zod';

const localHrefSchema = z.string().regex(/^\/(?!\/)/);
const orderStatusSchema = z.enum(['AI_PROCESSING', 'AI_FAILED', 'NEEDS_REVIEW', 'AUTO_APPROVED', 'APPROVED', 'CANCELLED']);

export const workspaceSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(100),
  limit: z.coerce.number().int().min(1).max(10).default(5),
}).strict();

export const workspaceSearchCustomerSchema = z.object({
  key: z.string().min(1).max(240),
  name: z.string().min(1).max(500),
  context: z.string().max(500).nullable(),
  href: localHrefSchema,
}).strict();

export const workspaceSearchOrderSchema = z.object({
  id: z.string().uuid(),
  publicNumber: z.string().min(1).max(120),
  customerName: z.string().max(500).nullable(),
  productSummary: z.string().max(500).nullable(),
  status: orderStatusSchema,
  href: localHrefSchema,
}).strict();

export const workspaceSearchProductSchema = z.object({
  id: z.string().uuid(),
  sku: z.string().min(1).max(120),
  name: z.string().min(1).max(500),
  price: z.number().finite().nonnegative().nullable(),
  currency: z.string().length(3).nullable(),
  stockQuantity: z.number().int().nullable(),
  href: localHrefSchema,
}).strict();

export const workspaceSearchResponseSchema = z.object({
  query: z.string().min(2).max(100),
  customers: z.array(workspaceSearchCustomerSchema).max(10),
  orders: z.array(workspaceSearchOrderSchema).max(10),
  products: z.array(workspaceSearchProductSchema).max(10),
}).strict();

export type WorkspaceSearchQuery = z.infer<typeof workspaceSearchQuerySchema>;
export type WorkspaceSearchResponse = z.infer<typeof workspaceSearchResponseSchema>;
export type WorkspaceSearchCustomer = z.infer<typeof workspaceSearchCustomerSchema>;
export type WorkspaceSearchOrder = z.infer<typeof workspaceSearchOrderSchema>;
export type WorkspaceSearchProduct = z.infer<typeof workspaceSearchProductSchema>;
