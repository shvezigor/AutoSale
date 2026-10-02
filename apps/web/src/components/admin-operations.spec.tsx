import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AdminOperations } from './admin-operations';

afterEach(cleanup);

describe('AdminOperations', () => {
  it('shows service and queue health using counts only', () => {
    render(<AdminOperations summary={{
      status: 'DEGRADED', database: 'HEALTHY', updatedAt: '2026-10-02T12:00:00.000Z',
      queues: [
        { queue: 'instagram', status: 'ATTENTION', waiting: 3, active: 0, delayed: 1, failed: 2, completed: 8, workerCount: 0, oldestPendingAt: '2026-10-02T11:00:00.000Z', available: true },
        { queue: 'telegram', status: 'IDLE', waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0, workerCount: 0, oldestPendingAt: null, available: false },
      ],
    }} />);

    expect(screen.getByRole('heading', { name: 'Операції та черги' })).toBeInTheDocument();
    expect(screen.getByText('API')).toBeInTheDocument();
    expect(screen.getByText('PostgreSQL')).toBeInTheDocument();
    expect(screen.getByText('Instagram')).toBeInTheDocument();
    expect(screen.getByText('Недоступно')).toBeInTheDocument();
    expect(screen.queryByText(/redis:\/\/|customerPhone|\+380000/i)).not.toBeInTheDocument();
  });

  it('marks PostgreSQL as needing attention when the safe probe fails', () => {
    render(<AdminOperations summary={{ status: 'DEGRADED', database: 'ATTENTION', updatedAt: '2026-10-02T12:00:00.000Z', queues: [] }} />);
    expect(screen.getByLabelText('PostgreSQL')).toHaveTextContent('Потрібна увага');
  });
});
