import { z } from 'zod';

export const registerMetaEventSchema = z.object({
  tenantId: z.string().uuid(),
  externalEventId: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});

export type RegisterMetaEventInput = z.infer<typeof registerMetaEventSchema>;
