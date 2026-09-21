import { z } from 'zod';

export const validationIssueSchema = z.object({
  field: z.string().min(1).max(120).regex(/^[A-Za-z0-9_.[\]-]+$/),
  code: z.string().min(1).max(80).regex(/^[A-Z][A-Z0-9_]*$/),
}).strict();

export const validationFailureSchema = z.object({
  statusCode: z.literal(400),
  code: z.literal('VALIDATION_FAILED'),
  issues: z.array(validationIssueSchema).min(1).max(32),
}).strict();

export type ValidationIssue = z.infer<typeof validationIssueSchema>;
export type ValidationFailure = z.infer<typeof validationFailureSchema>;
