import { z } from 'zod';

export const conversionPlanIdSchema = z.enum(['start', 'growth', 'scale']);
export const conversionEventSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('pricing_view'), locale: z.enum(['uk', 'en']) }).strict(),
  z.object({ event: z.literal('registration_arrival'), locale: z.enum(['uk', 'en']) }).strict(),
  z.object({ event: z.literal('plan_interest'), locale: z.enum(['uk', 'en']), planId: conversionPlanIdSchema }).strict(),
]);
export type ConversionEvent = z.infer<typeof conversionEventSchema>;
export type ConversionPlanId = z.infer<typeof conversionPlanIdSchema>;

export interface AdminConversionReport {
  from: string;
  to: string;
  metrics: Array<{ metric: string; locale: string; planId: string; count: number | null }>;
  rates: { registrationToFirstOrder: number | null; firstOrderToPlanInterest: number | null };
  note: 'counts_not_unique_visitors';
}
