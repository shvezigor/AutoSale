import type { DashboardResponse } from '../../../../../packages/contracts/src/dashboard';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { createTranslator } from '../../i18n/translator';
import { DashboardCharts } from './dashboard-charts';

describe('DashboardCharts', () => {
  afterEach(cleanup);

  it('exposes every daily status value to keyboard and assistive technology', () => {
    render(<DashboardCharts dailyOrders={dailyOrders} funnel={configuredFunnel} locale="uk" t={createTranslator('uk')} />);

    expect(screen.getByRole('heading', { name: 'Динаміка замовлень' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '15 вересня: підтверджено — 3' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '15 вересня: потребує перевірки — 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '16 вересня: обробка або помилка — 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '16 вересня: скасовано — 1' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Дані динаміки замовлень' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Усі замовлення' })).toHaveAttribute('href', '/orders');
  });

  it('renders ordered funnel counts, conversion rates, and configured export', () => {
    render(<DashboardCharts dailyOrders={dailyOrders} funnel={configuredFunnel} locale="uk" t={createTranslator('uk')} />);

    const stages = screen.getAllByTestId('funnel-stage');
    expect(stages.map((stage) => stage.getAttribute('data-stage'))).toEqual(['created', 'confirmed', 'exported', 'shipmentStarted']);
    expect(screen.getByText('18', { selector: '[data-funnel-value]' })).toBeInTheDocument();
    expect(screen.getByText('67%', { selector: '[data-funnel-rate]' })).toBeInTheDocument();
    expect(screen.getByText('50%', { selector: '[data-funnel-rate]' })).toBeInTheDocument();
  });

  it('marks export as unavailable when Google Sheets is not configured', () => {
    render(<DashboardCharts dailyOrders={[]} funnel={{ ...configuredFunnel, exported: null, exportConfigured: false }} locale="uk" t={createTranslator('uk')} />);

    expect(screen.getByText('Експорт не налаштовано')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Налаштувати експорт' })).toHaveAttribute('href', '/settings?tab=data');
    expect(screen.getByText('За цей період замовлень ще немає.')).toBeInTheDocument();
  });
});

const dailyOrders: DashboardResponse['dailyOrders'] = [
  { date: '2026-09-15', confirmed: 3, needsReview: 2, processingOrFailed: 0, cancelled: 0 },
  { date: '2026-09-16', confirmed: 1, needsReview: 0, processingOrFailed: 2, cancelled: 1 },
];

const configuredFunnel: DashboardResponse['funnel'] = {
  created: 18,
  confirmed: 12,
  exported: 9,
  shipmentStarted: 6,
  exportConfigured: true,
};
