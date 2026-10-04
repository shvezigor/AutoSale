import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const guardedSources = [
  ['src/conversations/conversations.service.ts', ['ORDER_RECOGNITION', 'CONVERSATION_REPLY']],
  ['src/orders/orders.service.ts', ['ORDER_MUTATION', 'SHEETS_EXPORT']],
  ['src/orders/commercial-terms.service.ts', ['COMMERCIAL_TERMS']],
  ['src/orders/payments.service.ts', ['PAYMENT']],
  ['../../packages/database/src/procurement-store.ts', ['PROCUREMENT']],
  ['src/catalogue/catalogue.service.ts', ['CATALOGUE']],
  ['src/catalogue-import/catalogue-import.service.ts', ['CATALOGUE']],
  ['src/catalogue-sources/catalogue-sources.service.ts', ['CATALOGUE']],
  ['src/delivery/delivery.service.ts', ['DELIVERY']],
  ['src/delivery/meest-connection.service.ts', ['DELIVERY']],
  ['src/delivery/ukrposhta-connection.service.ts', ['DELIVERY']],
  ['src/integrations/telegram.service.ts', ['NOTIFICATION_SEND', 'SUPPLIER_SEND']],
  ['src/settings/google-sheets-settings.service.ts', ['SHEETS_EXPORT']],
  ['src/integrations/google-oauth.service.ts', ['SHEETS_EXPORT']],
  ['src/integrations/google-credential-cleanup.service.ts', ['SHEETS_EXPORT']],
  ['src/integrations/instagram-oauth.service.ts', ['META_INBOUND']],
  ['src/integrations/tiktok-oauth.service.ts', ['META_INBOUND']],
  ['src/tiktok/tiktok-event.service.ts', ['META_INBOUND']],
  ['src/team/team.service.ts', ['ACCOUNT_ADMINISTRATION']],
  ['src/settings/order-settings.service.ts', ['ORDER_MUTATION']],
  ['src/commercial-settings/commercial-settings.service.ts', ['COMMERCIAL_TERMS']],
] as const;

describe('authenticated tenant lifecycle mutation contract', () => {
  for (const [path, surfaces] of guardedSources) {
    it(`${path} re-checks its lifecycle surfaces`, async () => {
      const source = await readFile(resolve(process.cwd(), path), 'utf8');
      for (const surface of surfaces) {
        expect(source).toContain(`assertTenantAcceptingMutations`);
        expect(source).toContain(`'${surface}'`);
      }
    });
  }
});
