import type { DashboardResponse } from '../../../../../packages/contracts/src/dashboard';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { createTranslator } from '../../i18n/translator';
import { DashboardActions } from './dashboard-actions';

describe('DashboardActions', () => {
  afterEach(cleanup);

  it('renders the bounded review queue with useful labels and direct order links', () => {
    render(<DashboardActions generatedAt="2026-09-17T12:00:00.000Z" integrations={integrations} issues={{ failedExports: 2, failedShipments: 1 }} locale="uk" queue={queue} t={createTranslator('uk')} />);

    expect(screen.getByRole('heading', { name: 'Черга на перевірку' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Анна.*Сукня Luna/i })).toHaveAttribute('href', `/orders/${queue[0]!.id}`);
    expect(screen.getByText('3 год тому')).toBeInTheDocument();
    expect(screen.getByText('72% впевненості')).toBeInTheDocument();
    expect(screen.getByText('Помилка AI')).toBeInTheDocument();
  });

  it('shows safe issue counts and routes to supported recovery views', () => {
    render(<DashboardActions generatedAt="2026-09-17T12:00:00.000Z" integrations={integrations} issues={{ failedExports: 2, failedShipments: 1 }} locale="uk" queue={[]} t={createTranslator('uk')} />);

    expect(screen.getByText('2', { selector: '[data-issue-count]' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Перевірити експорт' })).toHaveAttribute('href', '/settings?tab=data');
    expect(screen.getByRole('link', { name: 'Перевірити доставки' })).toHaveAttribute('href', '/orders?shipmentStatus=FAILED');
    expect(screen.getByText('Черга порожня — усі замовлення опрацьовано.')).toBeInTheDocument();
  });

  it('distinguishes integration states and preserves API-provided settings links', () => {
    render(<DashboardActions generatedAt="2026-09-17T12:00:00.000Z" integrations={integrations} issues={{ failedExports: 0, failedShipments: 0 }} locale="uk" queue={[]} t={createTranslator('uk')} />);

    expect(screen.getByRole('link', { name: /Instagram.*Активне/i })).toHaveAttribute('href', '/settings?tab=social');
    expect(screen.getByRole('link', { name: /Google Sheets.*Потрібна увага/i })).toHaveAttribute('href', '/settings?tab=data');
    expect(screen.getByRole('link', { name: /Meest.*Не налаштовано/i })).toHaveAttribute('href', '/settings?tab=delivery');
  });
});

const queue: DashboardResponse['queue'] = [
  { id: '1548d5ac-9086-4c19-a8e1-d25c93803376', participantName: 'Анна', productLabel: 'Сукня Luna', status: 'NEEDS_REVIEW', confidence: 0.72, createdAt: '2026-09-17T09:00:00.000Z' },
  { id: '2bdb4639-f24d-4e8f-9220-17a26f265ae4', participantName: null, productLabel: null, status: 'AI_FAILED', confidence: null, createdAt: '2026-09-16T10:00:00.000Z' },
];

const integrations: DashboardResponse['integrations'] = [
  { key: 'instagram', state: 'active', label: 'Instagram', detail: '@shop', href: '/settings?tab=social' },
  { key: 'google-sheets', state: 'attention', label: 'Google Sheets', detail: null, href: '/settings?tab=data' },
  { key: 'meest', state: 'not-configured', label: 'Meest', detail: null, href: '/settings?tab=delivery' },
];
