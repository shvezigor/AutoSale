import { z } from 'zod';

export const tenantLifecycleKindSchema = z.enum(['EXPORT', 'DELETE']);
export const tenantLifecycleStatusSchema = z.enum(['REQUESTED', 'EXPORTING', 'EXPORT_READY', 'FAILED', 'CANCELLED']);
export const tenantLifecycleReasonSchema = z.enum(['CONTROLLER_REQUEST', 'CONTRACT_TERMINATION', 'ADMINISTRATIVE_TEST']);
export const adminReauthPurposeSchema = z.enum(['TENANT_DELETE_REQUEST', 'TENANT_EXPORT_DOWNLOAD']);

export const adminReauthRequestSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  purpose: adminReauthPurposeSchema,
}).strict();

export const adminReauthResponseSchema = z.object({
  stepUpToken: z.string().min(1),
  expiresAt: z.string().datetime(),
}).strict();

export const lifecycleMutationRequestSchema = z.object({
  reasonCode: tenantLifecycleReasonSchema,
}).strict();

export const createTenantLifecycleRequestSchema = z.object({
  kind: tenantLifecycleKindSchema,
  reasonCode: tenantLifecycleReasonSchema,
  idempotencyKey: z.string().uuid(),
}).strict();

const optionalTimestamp = z.string().datetime().nullable();

export const tenantLifecycleRequestSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  kind: tenantLifecycleKindSchema,
  status: tenantLifecycleStatusSchema,
  reasonCode: tenantLifecycleReasonSchema,
  requestedAt: z.string().datetime(),
  ingestionFrozenAt: optionalTimestamp,
  exportSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  exportSizeBytes: z.number().int().nonnegative().nullable(),
  exportManifestVersion: z.number().int().positive().nullable(),
  exportReadyAt: optionalTimestamp,
  exportExpiresAt: optionalTimestamp,
  lastErrorCode: z.string().min(1).max(80).nullable(),
  cancelledAt: optionalTimestamp,
}).strict();

export const tenantLifecycleJobSchema = z.object({
  requestId: z.string().uuid(),
  tenantId: z.string().uuid(),
}).strict();

export const retentionDryRunJobSchema = z.object({
  runId: z.string().uuid(),
  tenantId: z.string().uuid(),
}).strict();

export const retentionDryRunSummaryEntrySchema = z.object({
  category: z.string().min(1).max(80),
  policyStatus: z.string().min(1).max(40),
  cutoff: optionalTimestamp,
  candidateCount: z.number().int().nonnegative().nullable(),
  oldestCandidateAt: optionalTimestamp,
  approximateBytes: z.number().int().nonnegative().nullable(),
}).strict();

export const retentionDryRunSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  status: z.string().min(1).max(40),
  summary: z.array(retentionDryRunSummaryEntrySchema).max(20).nullable(),
  lastErrorCode: z.string().min(1).max(80).nullable(),
  completedAt: optionalTimestamp,
  requestedAt: z.string().datetime(),
}).strict();

export type TenantLifecycleKind = z.infer<typeof tenantLifecycleKindSchema>;
export type TenantLifecycleStatus = z.infer<typeof tenantLifecycleStatusSchema>;
export type TenantLifecycleReason = z.infer<typeof tenantLifecycleReasonSchema>;
export type AdminReauthPurpose = z.infer<typeof adminReauthPurposeSchema>;
export type AdminReauthRequest = z.infer<typeof adminReauthRequestSchema>;
export type AdminReauthResponse = z.infer<typeof adminReauthResponseSchema>;
export type LifecycleMutationRequest = z.infer<typeof lifecycleMutationRequestSchema>;
export type CreateTenantLifecycleRequest = z.infer<typeof createTenantLifecycleRequestSchema>;
export type TenantLifecycleRequest = z.infer<typeof tenantLifecycleRequestSchema>;
export type TenantLifecycleJob = z.infer<typeof tenantLifecycleJobSchema>;
export type RetentionDryRunJob = z.infer<typeof retentionDryRunJobSchema>;
export type RetentionDryRunSummaryEntry = z.infer<typeof retentionDryRunSummaryEntrySchema>;
export type RetentionDryRun = z.infer<typeof retentionDryRunSchema>;

export type TenantMutationSurface =
  | 'META_INBOUND'
  | 'TELEGRAM_INBOUND'
  | 'ORDER_RECOGNITION'
  | 'CONVERSATION_REPLY'
  | 'ORDER_MUTATION'
  | 'COMMERCIAL_TERMS'
  | 'PAYMENT'
  | 'PROCUREMENT'
  | 'CATALOGUE'
  | 'DELIVERY'
  | 'SUPPLIER_SEND'
  | 'SHEETS_EXPORT'
  | 'NOTIFICATION_SEND'
  | 'ACCOUNT_ADMINISTRATION';
