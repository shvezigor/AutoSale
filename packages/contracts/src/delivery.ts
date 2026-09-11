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

export const deliveryLocationQuerySchema = z.object({
  provider: z.literal('NOVA_POSHTA'),
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

export type DeliveryProvider = z.infer<typeof deliveryProviderSchema>;
export type DeliveryConnectionStatus = z.infer<typeof deliveryConnectionStatusSchema>;
export type ShipmentStatus = z.infer<typeof shipmentStatusSchema>;
export type ShipmentPayer = z.infer<typeof shipmentPayerSchema>;
export type ShipmentDestinationType = z.infer<typeof shipmentDestinationTypeSchema>;
export type DeliveryLocationType = z.infer<typeof deliveryLocationTypeSchema>;
export type DeliveryLocationQuery = z.infer<typeof deliveryLocationQuerySchema>;
export type ShipmentDestination = z.infer<typeof shipmentDestinationSchema>;
export type DeliveryConnectionInput = z.infer<typeof deliveryConnectionInputSchema>;
export type DeliverySenderProfileInput = z.infer<typeof deliverySenderProfileInputSchema>;
export type ShipmentDraftInput = z.infer<typeof shipmentDraftInputSchema>;
export type ShipmentCreateJob = z.infer<typeof shipmentCreateJobSchema>;
export type ShipmentStatusJob = z.infer<typeof shipmentStatusJobSchema>;

export interface DeliveryConnectionSummary {
  provider: DeliveryProvider;
  status: DeliveryConnectionStatus;
  accountLabel: string | null;
  lastVerifiedAt: string | null;
  lastErrorCode: string | null;
  senderProfile: DeliverySenderProfileInput | null;
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
