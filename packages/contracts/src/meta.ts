import { z } from 'zod';

export const metaWebhookObjectSchema = z.enum(['instagram', 'page']);
export type MetaWebhookObject = z.infer<typeof metaWebhookObjectSchema>;

export const registerMetaEventSchema = z.object({
  tenantId: z.string().uuid(),
  externalEventId: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});

export type RegisterMetaEventInput = z.infer<typeof registerMetaEventSchema>;
