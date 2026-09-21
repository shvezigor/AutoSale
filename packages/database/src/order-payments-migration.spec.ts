import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('order payment facts migration', () => {
  const sql = readFileSync(resolve(process.cwd(), 'prisma/migrations/20260920220000_order_payment_facts/migration.sql'), 'utf8');

  it('creates an audited tenant-scoped payment table', () => {
    expect(sql).toContain('CREATE TYPE "PaymentMethod"');
    expect(sql).toContain('CREATE TABLE "order_payments"');
    expect(sql).toContain('CHECK ("amount" > 0)');
    expect(sql).toContain('CHECK (char_length("currency") = 3)');
    expect(sql).toContain('"cancellation_reason" TEXT');
    expect(sql).toContain('"cancellation_idempotency_key" UUID');
    expect(sql).toContain('"cancellation_request_hash" VARCHAR(64)');
  });

  it('guards idempotency and tenant-order ownership in the database', () => {
    expect(sql).toContain('UNIQUE INDEX "order_payments_tenant_id_idempotency_key_key"');
    expect(sql).toContain('UNIQUE INDEX "order_payments_tenant_id_cancellation_idempotency_key_key"');
    expect(sql).toContain('FOREIGN KEY ("tenant_id", "order_id") REFERENCES "orders"("tenant_id", "id")');
    expect(sql).toContain('INDEX "order_payments_tenant_id_order_id_received_at_idx"');
    expect(sql).toContain('INDEX "order_payments_tenant_id_order_id_cancelled_at_idx"');
  });
});
