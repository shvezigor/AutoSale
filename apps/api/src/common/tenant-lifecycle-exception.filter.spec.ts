import { TenantLifecycleFrozenError } from '@autosale/database';
import { describe, expect, it, vi } from 'vitest';

import { TenantLifecycleExceptionFilter } from './tenant-lifecycle-exception.filter.js';

describe('TenantLifecycleExceptionFilter', () => {
  it('returns a bounded conflict response without tenant or customer data', () => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const host = { switchToHttp: () => ({ getResponse: () => ({ status }) }) };

    new TenantLifecycleExceptionFilter().catch(
      new TenantLifecycleFrozenError('CATALOGUE'),
      host as never,
    );

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      statusCode: 409,
      code: 'TENANT_LIFECYCLE_FROZEN',
      message: 'TENANT_LIFECYCLE_FROZEN',
    });
    expect(JSON.stringify(json.mock.calls)).not.toContain('tenantId');
  });
});
