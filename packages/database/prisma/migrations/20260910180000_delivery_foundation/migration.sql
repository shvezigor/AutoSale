CREATE TYPE "DeliveryProvider" AS ENUM ('NOVA_POSHTA', 'MEEST', 'UKRPOSHTA');
CREATE TYPE "DeliveryConnectionStatus" AS ENUM ('ACTIVE', 'NEEDS_ATTENTION', 'DISCONNECTED');
CREATE TYPE "ShipmentStatus" AS ENUM (
  'DRAFT', 'CREATING', 'CREATED', 'ACCEPTED', 'IN_TRANSIT',
  'DELIVERED', 'RETURNING', 'RETURNED', 'CANCELLED', 'FAILED'
);
CREATE TYPE "ShipmentAttemptStatus" AS ENUM (
  'PENDING', 'PROCESSING', 'SUCCEEDED', 'RETRYABLE', 'UNKNOWN', 'FAILED'
);
CREATE TYPE "ShipmentAttemptOperation" AS ENUM ('CREATE', 'STATUS_SYNC', 'CANCEL');
CREATE TYPE "ShipmentDestinationType" AS ENUM ('BRANCH', 'PARCEL_LOCKER', 'ADDRESS');
CREATE TYPE "ShipmentPayer" AS ENUM ('SENDER', 'RECIPIENT');

CREATE TABLE "delivery_connections" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "provider" "DeliveryProvider" NOT NULL,
  "status" "DeliveryConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
  "encrypted_credential" TEXT NOT NULL,
  "credential_generation_id" UUID NOT NULL,
  "account_label" TEXT,
  "connected_by_user_id" UUID,
  "last_verified_at" TIMESTAMP(3),
  "last_error_code" TEXT,
  "disconnected_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "delivery_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "delivery_sender_profiles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "connection_id" UUID NOT NULL,
  "sender_ref" TEXT NOT NULL,
  "contact_ref" TEXT NOT NULL,
  "contact_phone" TEXT NOT NULL,
  "origin_type" "ShipmentDestinationType" NOT NULL,
  "origin_city_ref" TEXT NOT NULL,
  "origin_location_ref" TEXT,
  "origin_address_ref" TEXT,
  "origin_building" TEXT,
  "origin_flat" TEXT,
  "origin_label" TEXT,
  "payer" "ShipmentPayer" NOT NULL DEFAULT 'SENDER',
  "default_weight_kg" DECIMAL(8,3) NOT NULL,
  "default_length_cm" DECIMAL(8,2) NOT NULL,
  "default_width_cm" DECIMAL(8,2) NOT NULL,
  "default_height_cm" DECIMAL(8,2) NOT NULL,
  "suggest_customer_notification" BOOLEAN NOT NULL DEFAULT true,
  "customer_notification_template" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "delivery_sender_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "delivery_sender_profiles_phone_check" CHECK ("contact_phone" ~ '^[+]380[0-9]{9}$'),
  CONSTRAINT "delivery_sender_profiles_dimensions_check" CHECK (
    "default_weight_kg" > 0 AND "default_length_cm" > 0
    AND "default_width_cm" > 0 AND "default_height_cm" > 0
  ),
  CONSTRAINT "delivery_sender_profiles_origin_check" CHECK (
    ("origin_type" IN ('BRANCH', 'PARCEL_LOCKER') AND "origin_location_ref" IS NOT NULL AND "origin_address_ref" IS NULL AND "origin_building" IS NULL)
    OR
    ("origin_type" = 'ADDRESS' AND "origin_location_ref" IS NULL AND "origin_address_ref" IS NOT NULL AND "origin_building" IS NOT NULL)
  )
);

CREATE TABLE "shipments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "connection_id" UUID NOT NULL,
  "created_by_user_id" UUID,
  "provider" "DeliveryProvider" NOT NULL,
  "status" "ShipmentStatus" NOT NULL DEFAULT 'DRAFT',
  "sender_snapshot" JSONB NOT NULL,
  "recipient_snapshot" JSONB NOT NULL,
  "destination_snapshot" JSONB NOT NULL,
  "parcels" JSONB NOT NULL,
  "payer" "ShipmentPayer" NOT NULL,
  "declared_value" DECIMAL(12,2) NOT NULL,
  "cod_amount" DECIMAL(12,2),
  "description" TEXT NOT NULL,
  "provider_document_id" TEXT,
  "tracking_number" TEXT,
  "cost" DECIMAL(12,2),
  "currency" VARCHAR(3) NOT NULL DEFAULT 'UAH',
  "version" INTEGER NOT NULL DEFAULT 1,
  "idempotency_key" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "last_provider_code" TEXT,
  "last_error_code" TEXT,
  "next_status_check_at" TIMESTAMP(3),
  "last_status_checked_at" TIMESTAMP(3),
  "provider_created_at" TIMESTAMP(3),
  "accepted_at" TIMESTAMP(3),
  "delivered_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "shipments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shipments_declared_value_check" CHECK ("declared_value" > 0),
  CONSTRAINT "shipments_cod_amount_check" CHECK ("cod_amount" IS NULL OR ("cod_amount" >= 0 AND "cod_amount" <= "declared_value")),
  CONSTRAINT "shipments_version_check" CHECK ("version" > 0)
);

CREATE TABLE "shipment_attempts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "shipment_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "operation" "ShipmentAttemptOperation" NOT NULL,
  "status" "ShipmentAttemptStatus" NOT NULL DEFAULT 'PENDING',
  "idempotency_key" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_attempt_at" TIMESTAMP(3),
  "lease_id" UUID,
  "lease_expires_at" TIMESTAMP(3),
  "last_error_code" TEXT,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "shipment_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shipment_attempts_version_check" CHECK ("version" > 0),
  CONSTRAINT "shipment_attempts_attempts_check" CHECK ("attempts" >= 0)
);

CREATE TABLE "shipment_status_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "shipment_id" UUID NOT NULL,
  "status" "ShipmentStatus",
  "provider_code" TEXT NOT NULL,
  "provider_occurred_at" TIMESTAMP(3),
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shipment_status_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "delivery_connections_credential_generation_id_key" ON "delivery_connections"("credential_generation_id");
CREATE UNIQUE INDEX "delivery_connections_tenant_id_id_key" ON "delivery_connections"("tenant_id", "id");
CREATE UNIQUE INDEX "delivery_connections_tenant_id_provider_key" ON "delivery_connections"("tenant_id", "provider");
CREATE INDEX "delivery_connections_tenant_id_status_idx" ON "delivery_connections"("tenant_id", "status");
CREATE UNIQUE INDEX "delivery_sender_profiles_tenant_id_connection_id_key" ON "delivery_sender_profiles"("tenant_id", "connection_id");
CREATE INDEX "delivery_sender_profiles_tenant_id_idx" ON "delivery_sender_profiles"("tenant_id");
CREATE UNIQUE INDEX "shipments_tenant_id_id_key" ON "shipments"("tenant_id", "id");
CREATE UNIQUE INDEX "shipments_tenant_id_idempotency_key_key" ON "shipments"("tenant_id", "idempotency_key");
CREATE UNIQUE INDEX "shipments_tenant_id_provider_provider_document_id_key" ON "shipments"("tenant_id", "provider", "provider_document_id");
CREATE INDEX "shipments_tenant_id_order_id_created_at_idx" ON "shipments"("tenant_id", "order_id", "created_at" DESC);
CREATE INDEX "shipments_status_next_status_check_at_idx" ON "shipments"("status", "next_status_check_at");
CREATE UNIQUE INDEX "shipments_one_active_per_order" ON "shipments"("tenant_id", "order_id")
  WHERE "status" IN ('DRAFT', 'CREATING', 'CREATED', 'ACCEPTED', 'IN_TRANSIT', 'RETURNING');
CREATE UNIQUE INDEX "shipment_attempts_tenant_id_id_key" ON "shipment_attempts"("tenant_id", "id");
CREATE UNIQUE INDEX "shipment_attempts_tenant_id_idempotency_key_key" ON "shipment_attempts"("tenant_id", "idempotency_key");
CREATE UNIQUE INDEX "shipment_attempts_tenant_id_shipment_id_operation_version_key"
  ON "shipment_attempts"("tenant_id", "shipment_id", "operation", "version");
CREATE INDEX "shipment_attempts_status_next_attempt_at_idx" ON "shipment_attempts"("status", "next_attempt_at");
CREATE INDEX "shipment_attempts_lease_expires_at_idx" ON "shipment_attempts"("lease_expires_at");
CREATE UNIQUE INDEX "shipment_status_events_tenant_id_id_key" ON "shipment_status_events"("tenant_id", "id");
CREATE INDEX "shipment_status_events_tenant_id_shipment_id_occurred_at_idx"
  ON "shipment_status_events"("tenant_id", "shipment_id", "occurred_at" DESC);

ALTER TABLE "delivery_connections" ADD CONSTRAINT "delivery_connections_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "delivery_connections" ADD CONSTRAINT "delivery_connections_connected_by_user_id_fkey"
  FOREIGN KEY ("connected_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "delivery_sender_profiles" ADD CONSTRAINT "delivery_sender_profiles_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "delivery_sender_profiles" ADD CONSTRAINT "delivery_sender_profiles_tenant_id_connection_id_fkey"
  FOREIGN KEY ("tenant_id", "connection_id") REFERENCES "delivery_connections"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "shipments" ADD CONSTRAINT "shipments_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_tenant_id_order_id_fkey"
  FOREIGN KEY ("tenant_id", "order_id") REFERENCES "orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_tenant_id_connection_id_fkey"
  FOREIGN KEY ("tenant_id", "connection_id") REFERENCES "delivery_connections"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "shipment_attempts" ADD CONSTRAINT "shipment_attempts_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shipment_attempts" ADD CONSTRAINT "shipment_attempts_tenant_id_shipment_id_fkey"
  FOREIGN KEY ("tenant_id", "shipment_id") REFERENCES "shipments"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "shipment_status_events" ADD CONSTRAINT "shipment_status_events_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shipment_status_events" ADD CONSTRAINT "shipment_status_events_tenant_id_shipment_id_fkey"
  FOREIGN KEY ("tenant_id", "shipment_id") REFERENCES "shipments"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
