import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CommercialSettingsSummary } from '../../../../packages/contracts/src/commercial';
import * as commercialSettingsApi from '../api/commercial-settings';
import { I18nProvider } from '../i18n/i18n-provider';
import { CommercialSettingsHub } from './commercial-settings-hub';

vi.mock('../api/commercial-settings', () => ({
  createLegalEntity: vi.fn(), updateLegalEntity: vi.fn(), createBankAccount: vi.fn(), updateBankAccount: vi.fn(), getBankAccountDetail: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const initial: CommercialSettingsSummary = {
  legalEntities: [{ id: 'entity-1', displayName: 'AutoSale', legalName: 'ТОВ Авто Сейл', type: 'COMPANY', registrationId: '12345678', active: true, isDefault: true }],
  bankAccounts: [{ id: 'account-1', legalEntityId: 'entity-1', label: 'Основний', maskedIban: 'UA12••••••••3456', bankName: 'Тест Банк', currency: 'UAH', active: true, isDefault: true }],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CommercialSettingsHub', () => {
  it('starts closed and opens one commercial section at a time', () => {
    render(<I18nProvider locale="uk" authenticated={false}><CommercialSettingsHub initial={initial} role="OWNER" /></I18nProvider>);
    const entities = screen.getByRole('button', { name: /Юридичні особи/ });
    const accounts = screen.getByRole('button', { name: /Банківські рахунки/ });
    expect(entities).toHaveAttribute('aria-expanded', 'false');
    expect(accounts).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('ТОВ Авто Сейл')).not.toBeInTheDocument();
    fireEvent.click(entities);
    expect(entities).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/ТОВ Авто Сейл/)).toBeInTheDocument();
    fireEvent.click(accounts);
    expect(entities).toHaveAttribute('aria-expanded', 'false');
    expect(accounts).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/UA12/)).toBeInTheDocument();
  });

  it('keeps manager view read-only', () => {
    render(<I18nProvider locale="uk" authenticated={false}><CommercialSettingsHub initial={initial} role="MANAGER" /></I18nProvider>);
    fireEvent.click(screen.getByRole('button', { name: /Юридичні особи/ }));
    expect(screen.queryByRole('button', { name: 'Редагувати' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Коротка назва')).not.toBeInTheDocument();
  });

  it('uses the shared primary and secondary button variants', () => {
    render(<I18nProvider locale="uk" authenticated={false}><CommercialSettingsHub initial={initial} role="OWNER" /></I18nProvider>);

    fireEvent.click(screen.getByRole('button', { name: /Юридичні особи/ }));

    expect(screen.getByRole('button', { name: 'Редагувати' })).toHaveClass('secondary-button');
    expect(screen.getByRole('button', { name: 'Додати' })).toHaveClass('primary-button');
  });

  it('explains an invalid IBAN before sending bank account data', () => {
    render(<I18nProvider locale="uk" authenticated={false}><CommercialSettingsHub initial={initial} role="OWNER" /></I18nProvider>);

    fireEvent.click(screen.getByRole('button', { name: /Банківські рахунки/ }));
    fireEvent.change(screen.getByLabelText('Назва рахунку'), { target: { value: 'Основний UAH' } });
    fireEvent.change(screen.getByLabelText('IBAN'), { target: { value: 'U345345345345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Додати' }));

    expect(screen.getByText('Введіть коректний IBAN: для України — UA та ще 27 символів.')).toBeInTheDocument();
    expect(commercialSettingsApi.createBankAccount).not.toHaveBeenCalled();
  });
});
