import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InboxShell } from './inbox-shell';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(cleanup);

describe('InboxShell role navigation', () => {
  it('shows team and settings only to the tenant owner', () => {
    render(<InboxShell conversations={[]} session={{ name: 'Олена', email: 'owner@example.com', membershipRole: 'OWNER' } as never}><div /></InboxShell>);
    expect(screen.getByRole('link', { name: 'Команда' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Налаштування' })).toBeInTheDocument();
  });

  it('keeps manager navigation focused on business data', () => {
    render(<InboxShell conversations={[]} session={{ name: 'Іван', email: 'manager@example.com', membershipRole: 'MANAGER' } as never}><div /></InboxShell>);
    expect(screen.queryByRole('link', { name: 'Команда' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Налаштування' })).not.toBeInTheDocument();
    expect(screen.getByText('Іван')).toBeInTheDocument();
  });
});
