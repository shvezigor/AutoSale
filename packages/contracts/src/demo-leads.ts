import { z } from 'zod';

export const demoLeadInputSchema = z.object({
  name: z.string().trim().min(2).max(100),
  company: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(254).optional().or(z.literal('')),
  phone: z.string().trim().min(7).max(32).optional().or(z.literal('')),
  orderVolume: z.enum(['UNDER_50', '50_TO_300', '301_TO_1500', 'OVER_1500']),
  note: z.string().trim().max(1_000).optional().or(z.literal('')),
  locale: z.enum(['uk', 'en']),
  privacyConsent: z.literal(true),
}).strict().refine((value) => Boolean(value.email || value.phone), {
  message: 'Provide an email or phone number',
  path: ['email'],
});

export type DemoLeadInput = z.infer<typeof demoLeadInputSchema>;
