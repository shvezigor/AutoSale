import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AdminDashboard } from './admin-dashboard';

afterEach(cleanup);

describe('AdminDashboard privacy', () => {
  it('shows platform aggregates and actionable queue state without tenant content', () => {
    render(<AdminDashboard
      overview={{
        status: 'DEGRADED', attentionQueueCount: 1, updatedAt: '2026-10-02T12:00:00.000Z',
        metrics: { tenantCount: 3, activeTenantCount: 2, blockedTenantCount: 1, userCount: 5, orderCount: 9, newTenantCount30Days: 1 },
      }}
      operations={{
        status: 'DEGRADED', database: 'HEALTHY', updatedAt: '2026-10-02T12:00:00.000Z',
        queues: [
          { queue: 'instagram', status: 'ATTENTION', waiting: 3, active: 0, delayed: 0, failed: 1, completed: 8, workerCount: 0, oldestPendingAt: '2026-10-02T11:00:00.000Z', available: true },
          { queue: 'catalogue', status: 'HEALTHY', waiting: 0, active: 1, delayed: 0, failed: 0, completed: 4, workerCount: 1, oldestPendingAt: null, available: true },
        ],
      }}
    />);

    expect(screen.getByRole('heading', { name: 'Огляд платформи' })).toBeInTheDocument();
    expect(screen.getByText('3', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('Instagram')).toBeInTheDocument();
    expect(screen.getByText('Потребує уваги')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Переглянути клієнтів' })).toHaveAttribute('href', '/admin/tenants');
    expect(screen.getByRole('link', { name: 'Відкрити моніторинг' })).toHaveAttribute('href', '/admin/operations');
    expect(screen.queryByText(/телефон|адреса|повідомлення клієнта/i)).not.toBeInTheDocument();
  });
});
