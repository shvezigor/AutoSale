import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticatedApiFetch, getServerSession } = vi.hoisted(() => ({
  authenticatedApiFetch: vi.fn(),
  getServerSession: vi.fn(),
}));

vi.mock('../../../src/auth/session', () => ({ authenticatedApiFetch, getServerSession }));

import OnboardingPage from './page';

const ownerSession = {
  userId: '3e6855ae-48a2-4d4d-8c39-5bf7d10f1a03',
  email: 'owner@example.com',
  name: 'Олена',
  platformRole: 'USER',
  tenantId: '1f713392-fdbc-4e3c-9824-db207934bff4',
  membershipRole: 'OWNER',
  locale: 'uk',
};

beforeEach(() => {
  getServerSession.mockResolvedValue(ownerSession);
});

afterEach(() => {
  cleanup();
  authenticatedApiFetch.mockReset();
  getServerSession.mockReset();
});

describe('OnboardingPage', () => {
  it('derives progress from real settings and links to the first incomplete core step', async () => {
    mockOnboardingResponses({ catalogueReady: true, instagramReady: false, supplierReady: true });

    render(await OnboardingPage());

    expect(screen.getByRole('heading', { name: 'Запустіть Sales AITO' })).toBeInTheDocument();
    expect(screen.getByText('2 із 3 обов’язкових кроків готові')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Продовжити налаштування' })).toHaveAttribute('href', '/settings?tab=social');

    const catalogue = screen.getByTestId('onboarding-step-catalogue');
    expect(within(catalogue).getByText('Готово')).toBeInTheDocument();
    expect(within(catalogue).getByRole('link', { name: 'Переглянути' })).toHaveAttribute('href', '/settings?tab=data&action=pick-catalogue');

    const channel = screen.getByTestId('onboarding-step-channel');
    expect(within(channel).getByText('Потрібно налаштувати')).toBeInTheDocument();
    expect(within(channel).getByRole('link', { name: 'Налаштувати' })).toHaveAttribute('href', '/settings?tab=social');

    const supplier = screen.getByTestId('onboarding-step-suppliers');
    expect(within(supplier).getByText('Готово')).toBeInTheDocument();
    expect(within(supplier).getByRole('link', { name: 'Переглянути' })).toHaveAttribute('href', '/settings?tab=suppliers');
  });

  it('keeps optional integrations outside core completion and exposes every exact settings destination', async () => {
    mockOnboardingResponses({ catalogueReady: true, instagramReady: true });

    render(await OnboardingPage());

    expect(screen.getByText('3 із 3 обов’язкових кроків готові')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Перейти до замовлень' })).toHaveAttribute('href', '/orders');
    expect(screen.getAllByText('Необов’язково')).toHaveLength(4);
    expect(within(screen.getByTestId('onboarding-step-delivery')).getByRole('link', { name: 'Налаштувати' })).toHaveAttribute('href', '/settings?tab=delivery');
    expect(within(screen.getByTestId('onboarding-step-notifications')).getByRole('link', { name: 'Налаштувати' })).toHaveAttribute('href', '/settings?tab=notifications');
    expect(within(screen.getByTestId('onboarding-step-payments')).getByRole('link', { name: 'Налаштувати' })).toHaveAttribute('href', '/settings?tab=payments');
  });

  it('renders the full checklist in English', async () => {
    getServerSession.mockResolvedValue({ ...ownerSession, locale: 'en' });
    mockOnboardingResponses({ catalogueReady: false, instagramReady: false });

    render(await OnboardingPage());

    expect(screen.getByRole('heading', { name: 'Launch Sales AITO' })).toBeInTheDocument();
    expect(screen.getByText('1 of 3 required steps ready')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Required for launch' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Add when needed' })).toBeInTheDocument();
  });
});

function mockOnboardingResponses({
  catalogueReady,
  instagramReady,
  supplierReady = false,
}: {
  catalogueReady: boolean;
  instagramReady: boolean;
  supplierReady?: boolean;
}) {
  const destinationId = 'f4d8d792-34d1-4e93-a436-662919cd204c';
  const payloads = [
    catalogueReady ? [{ id: 'source-1', status: 'ACTIVE' }] : [],
    { status: instagramReady ? 'ACTIVE' : 'NOT_CONNECTED' },
    { intentDetectionMode: 'AI_SUGGESTION', approvalMode: 'ON_LOW_CONFIDENCE' },
    { enabled: true, connections: [] },
    { enabled: true, connection: null },
    { enabled: true, connection: null },
    { businessConnected: supplierReady, selectedDestinationId: supplierReady ? destinationId : null, autoDispatch: false, destinations: supplierReady ? [{ id: destinationId }] : [] },
    { available: true, botUsername: 'SalesAitoBot', personal: { connected: false, displayName: null, username: null, linkedAt: null } },
    [],
    [],
  ];
  for (const payload of payloads) authenticatedApiFetch.mockResolvedValueOnce({ ok: true, json: async () => payload });
}
