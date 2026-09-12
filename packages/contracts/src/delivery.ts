import { z } from 'zod';

export const deliveryProviderSchema = z.enum(['NOVA_POSHTA', 'MEEST', 'UKRPOSHTA']);
export const deliveryConnectionStatusSchema = z.enum([
  'ACTIVE',
  'NEEDS_ATTENTION',
  'DISCONNECTED',
]);
export const shipmentStatusSchema = z.enum([
  'DRAFT',
  'CREATING',
  'CREATED',
  'ACCEPTED',
  'IN_TRANSIT',
  'DELIVERED',
  'RETURNING',
  'RETURNED',
  'CANCELLED',
  'FAILED',
]);
export const shipmentPayerSchema = z.enum(['SENDER', 'RECIPIENT']);
export const shipmentDestinationTypeSchema = z.enum(['BRANCH', 'PARCEL_LOCKER', 'ADDRESS']);
export const deliveryLocationTypeSchema = z.enum(['CITY', 'BRANCH', 'PARCEL_LOCKER']);

const phoneSchema = z.string().regex(/^\+380\d{9}$/);
const positiveMoneySchema = z.number().finite().positive().max(10_000_000);
const nullableCodSchema = z.number().finite().nonnegative().max(10_000_000).nullable();
const parcelSchema = z.object({
  weightKg: z.number().finite().positive().max(1_000),
  lengthCm: z.number().finite().positive().max(300),
  widthCm: z.number().finite().positive().max(300),
  heightCm: z.number().finite().positive().max(300),
}).strict();

const pickupDestinationSchema = z.object({
  type: z.enum(['BRANCH', 'PARCEL_LOCKER']),
  cityRef: z.string().trim().min(1).max(128),
  locationRef: z.string().trim().min(1).max(128),
  label: z.string().trim().min(1).max(240),
}).strict();

const addressDestinationSchema = z.object({
  type: z.literal('ADDRESS'),
  cityRef: z.string().trim().min(1).max(128),
  addressRef: z.string().trim().min(1).max(128),
  building: z.string().trim().min(1).max(32),
  flat: z.string().trim().max(32).nullable(),
}).strict();

export const shipmentDestinationSchema = z.discriminatedUnion('type', [
  pickupDestinationSchema,
  addressDestinationSchema,
]);

export const deliveryConnectionInputSchema = z.object({
  apiKey: z.string().trim().min(8).max(512),
}).strict();

export const meestConnectionInputSchema = z.object({
  login: z.string().trim().min(1).max(128),
  password: z.string().min(1).max(256),
  clientUid: z.string().uuid(),
}).strict();

export const ukrposhtaConnectionInputSchema = z.object({
  environment: z.enum(['SANDBOX', 'PRODUCTION']),
  ecomBearer: z.string().trim().min(8).max(2_048),
  counterpartyToken: z.string().trim().min(8).max(2_048),
  trackingBearer: z.string().trim().min(8).max(2_048),
  counterpartyUuid: z.string().uuid(),
}).strict();

export const ukrposhtaConnectionSummarySchema = z.object({
  provider: z.literal('UKRPOSHTA'),
  status: deliveryConnectionStatusSchema,
  accountLabel: z.string().trim().min(1).max(240).nullable(),
  lastVerifiedAt: z.string().datetime().nullable(),
  lastErrorCode: z.string().trim().min(1).max(120).nullable(),
  environment: z.enum(['SANDBOX', 'PRODUCTION']).nullable(),
}).strict();

export const meestSenderProfileInputSchema = z.object({
  senderName: z.string().trim().min(2).max(120),
  senderPhone: phoneSchema,
  origin: pickupDestinationSchema,
  payer: shipmentPayerSchema,
  defaultParcel: parcelSchema,
  suggestCustomerNotification: z.boolean(),
  customerNotificationTemplate: z.string().trim().min(1).max(1_000),
}).strict();

export const deliveryLocationQuerySchema = z.object({
  provider: z.enum(['NOVA_POSHTA', 'MEEST']),
  type: deliveryLocationTypeSchema,
  query: z.string().trim().min(2).max(120),
  cityRef: z.string().trim().min(1).max(128).optional(),
}).strict().superRefine((input, context) => {
  if (input.type !== 'CITY' && !input.cityRef) {
    context.addIssue({ code: 'custom', path: ['cityRef'], message: 'City reference is required' });
  }
});

export const deliverySenderProfileInputSchema = z.object({
  senderRef: z.string().trim().min(1).max(128),
  contactRef: z.string().trim().min(1).max(128),
  contactPhone: phoneSchema,
  origin: shipmentDestinationSchema,
  payer: shipmentPayerSchema,
  defaultParcel: parcelSchema,
  suggestCustomerNotification: z.boolean(),
  customerNotificationTemplate: z.string().trim().min(1).max(1_000),
}).strict();

export const shipmentDraftInputSchema = z.object({
  provider: z.literal('NOVA_POSHTA'),
  recipient: z.object({
    name: z.string().trim().min(2).max(120),
    phone: phoneSchema,
  }).strict(),
  destination: shipmentDestinationSchema,
  parcels: z.array(parcelSchema).length(1),
  payer: shipmentPayerSchema,
  declaredValue: positiveMoneySchema,
  codAmount: nullableCodSchema,
  description: z.string().trim().min(1).max(100),
}).strict().superRefine((draft, context) => {
  if (draft.codAmount !== null && draft.codAmount > draft.declaredValue) {
    context.addIssue({
      code: 'custom',
      path: ['codAmount'],
      message: 'COD amount cannot exceed declared value',
    });
  }
});

export const shipmentCreateJobSchema = z.object({
  shipmentId: z.string().uuid(),
}).strict();

export const shipmentStatusJobSchema = z.object({
  shipmentId: z.string().uuid(),
}).strict();

export const shipmentCustomerMessageInputSchema = z.object({
  text: z.string().trim().min(1).max(1_000),
}).strict();

export type DeliveryProvider = z.infer<typeof deliveryProviderSchema>;
export type DeliveryConnectionStatus = z.infer<typeof deliveryConnectionStatusSchema>;
export type ShipmentStatus = z.infer<typeof shipmentStatusSchema>;
export type ShipmentPayer = z.infer<typeof shipmentPayerSchema>;
export type ShipmentDestinationType = z.infer<typeof shipmentDestinationTypeSchema>;
export type DeliveryLocationType = z.infer<typeof deliveryLocationTypeSchema>;
export type DeliveryLocationQuery = z.infer<typeof deliveryLocationQuerySchema>;
export type ShipmentDestination = z.infer<typeof shipmentDestinationSchema>;
export type DeliveryConnectionInput = z.infer<typeof deliveryConnectionInputSchema>;
export type MeestConnectionInput = z.infer<typeof meestConnectionInputSchema>;
export type UkrposhtaConnectionInput = z.infer<typeof ukrposhtaConnectionInputSchema>;
export type MeestSenderProfileInput = z.infer<typeof meestSenderProfileInputSchema>;
export type DeliverySenderProfileInput = z.infer<typeof deliverySenderProfileInputSchema>;
export type ShipmentDraftInput = z.infer<typeof shipmentDraftInputSchema>;
export type ShipmentCreateJob = z.infer<typeof shipmentCreateJobSchema>;
export type ShipmentStatusJob = z.infer<typeof shipmentStatusJobSchema>;
export type ShipmentCustomerMessageInput = z.infer<typeof shipmentCustomerMessageInputSchema>;

export interface ShipmentCustomerMessagePreview {
  text: string;
  suggested: boolean;
  alreadySubmitted: boolean;
  deliveryStatus: 'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'UNKNOWN' | null;
  deliveryErrorCode: string | null;
}

export interface DeliveryConnectionSummary {
  provider: DeliveryProvider;
  status: DeliveryConnectionStatus;
  accountLabel: string | null;
  lastVerifiedAt: string | null;
  lastErrorCode: string | null;
  senderProfile: DeliverySenderProfileInput | null;
}

export interface MeestConnectionSummary extends Omit<DeliveryConnectionSummary, 'provider' | 'senderProfile'> {
  provider: 'MEEST';
  senderProfile: MeestSenderProfileInput | null;
}

export interface UkrposhtaConnectionSummary {
  provider: 'UKRPOSHTA';
  status: DeliveryConnectionStatus;
  accountLabel: string | null;
  lastVerifiedAt: string | null;
  lastErrorCode: string | null;
  environment: 'SANDBOX' | 'PRODUCTION' | null;
}

export interface DeliveryLocation {
  ref: string;
  provider: DeliveryProvider;
  type: DeliveryLocationType;
  label: string;
  cityRef?: string;
  number?: string;
}

export interface ShipmentQuote {
  currency: 'UAH';
  cost: number;
  estimatedDeliveryDate: string | null;
}

export interface ShipmentStatusEventSummary {
  status: ShipmentStatus | null;
  providerCode: string;
  occurredAt: string;
}

export interface ShipmentSummary {
  id: string;
  orderId: string;
  provider: DeliveryProvider;
  status: ShipmentStatus;
  trackingNumber: string | null;
  cost: number | null;
  currency: 'UAH';
  createdAt: string;
  providerCreatedAt: string | null;
  acceptedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  lastStatusCheckedAt: string | null;
  lastErrorCode: string | null;
  history: ShipmentStatusEventSummary[];
}

export type ShipmentBlockedReason = 'ORDER_NOT_APPROVED' | 'PROCUREMENT_INCOMPLETE' | 'CONNECTION_REQUIRED' | 'SENDER_PROFILE_REQUIRED';

export interface ShipmentDraftPrefill {
  provider: 'NOVA_POSHTA';
  recipient: { name: string | null; phone: string | null };
  cityHint: string | null;
  locationHint: string | null;
  parcels: Array<{ weightKg: number; lengthCm: number; widthCm: number; heightCm: number }>;
  payer: ShipmentPayer;
  declaredValue: number;
  codAmount: number | null;
  description: string;
}

export interface ShipmentOverview {
  shipment: ShipmentSummary | null;
  canCreateShipment: boolean;
  blockedReason: ShipmentBlockedReason | null;
  draft: ShipmentDraftPrefill | ShipmentDraftInput | null;
}
