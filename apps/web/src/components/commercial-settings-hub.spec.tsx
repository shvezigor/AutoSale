import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CommercialSettingsSummary } from '../../../../packages/contracts/src/commercial';
import * as commercialSettingsApi from '../api/commercial-settings';
import { ValidationApiError } from '../api/validation-errors';
import { I18nProvider } from '../i18n/i18n-provider';
import { ConfirmProvider } from './confirm-provider';
import { CommercialSettingsHub } from './commercial-settings-hub';

vi.mock('../api/commercial-settings', () => ({
  createLegalEntity: vi.fn(), updateLegalEntity: vi.fn(), deleteLegalEntity: vi.fn(), createBankAccount: vi.fn(), updateBankAccount: vi.fn(), deleteBankAccount: vi.fn(), getBankAccountDetail: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const initial: CommercialSettingsSummary = {
  legalEntities: [{ id: 'entity-1', displayName: 'AutoSale', legalName: 'ТОВ Авто Сейл', type: 'COMPANY', registrationId: '12345678', active: true, isDefault: true }],
  bankAccounts: [{ id: 'account-1', legalEntityId: 'entity-1', label: 'Основний', maskedIban: 'UA12••••••••3456', bankName: 'Тест Банк', currency: 'UAH', active: true, isDefault: true }],
};

function renderHub(role: 'OWNER' | 'MANAGER' = 'OWNER') {
  return render(<I18nProvider locale="uk" authenticated={false}><ConfirmProvider><CommercialSettingsHub initial={initial} role={role} /></ConfirmProvider></I18nProvider>);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CommercialSettingsHub', () => {
  it('starts closed and opens one commercial section at a time', () => {
    renderHub();
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
    renderHub('MANAGER');
    fireEvent.click(screen.getByRole('button', { name: /Юридичні особи/ }));
    expect(screen.queryByRole('button', { name: 'Редагувати' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Коротка назва')).not.toBeInTheDocument();
  });

  it('uses the shared primary and secondary button variants', () => {
    renderHub();

    fireEvent.click(screen.getByRole('button', { name: /Юридичні особи/ }));

    expect(screen.getByRole('button', { name: 'Редагувати' })).toHaveClass('secondary-button');
    expect(screen.getByRole('button', { name: 'Додати' })).toHaveClass('primary-button');
  });

  it('explains an invalid IBAN before sending bank account data', () => {
    renderHub();

    fireEvent.click(screen.getByRole('button', { name: /Банківські рахунки/ }));
    fireEvent.change(screen.getByLabelText('Назва рахунку'), { target: { value: 'Основний UAH' } });
    fireEvent.change(screen.getByLabelText('IBAN'), { target: { value: 'U345345345345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Додати' }));

    expect(screen.getByLabelText('IBAN')).toHaveFocus();
    expect(screen.getByText('Введіть коректний IBAN: для України — UA та ще 27 символів.')).toHaveAttribute('id', 'bank-account-iban-error');
    expect(commercialSettingsApi.createBankAccount).not.toHaveBeenCalled();
  });

  it('shows every missing legal entity field below its control', () => {
    renderHub();
    fireEvent.click(screen.getByRole('button', { name: /Юридичні особи/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Додати' }));
    expect(screen.getByLabelText('Коротка назва')).toHaveFocus();
    expect(screen.getByText('Заповніть це поле.', { selector: '#legal-entity-display-name-error' })).toBeInTheDocument();
    expect(screen.getByText('Заповніть це поле.', { selector: '#legal-entity-legal-name-error' })).toBeInTheDocument();
    expect(commercialSettingsApi.createLegalEntity).not.toHaveBeenCalled();
  });

  it('maps a safe server currency issue to the bank account field', async () => {
    vi.mocked(commercialSettingsApi.createBankAccount).mockRejectedValueOnce(new ValidationApiError({
      statusCode: 400, code: 'VALIDATION_FAILED', issues: [{ field: 'currency', code: 'INVALID_CURRENCY' }],
    }));
    renderHub();
    fireEvent.click(screen.getByRole('button', { name: /Банківські рахунки/ }));
    fireEvent.change(screen.getByLabelText('Назва рахунку'), { target: { value: 'Тестовий рахунок' } });
    fireEvent.change(screen.getByLabelText('IBAN'), { target: { value: 'UA123456789012345678901234567' } });
    fireEvent.click(screen.getByRole('button', { name: 'Додати' }));
    await waitFor(() => expect(screen.getByText('Введіть трилітерний код валюти.')).toHaveAttribute('id', 'bank-account-currency-error'));
    expect(screen.getByLabelText('Валюта')).toHaveFocus();
  });

  it('deletes a bank account after explicit confirmation and removes its row', async () => {
    vi.mocked(commercialSettingsApi.deleteBankAccount).mockResolvedValueOnce(undefined);
    renderHub();
    fireEvent.click(screen.getByRole('button', { name: /Банківські рахунки/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Видалити рахунок Основний' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Основний');
    fireEvent.click(screen.getByRole('button', { name: 'Видалити' }));

    await waitFor(() => expect(commercialSettingsApi.deleteBankAccount).toHaveBeenCalledWith('account-1'));
    await waitFor(() => expect(screen.queryByText(/UA12/)).not.toBeInTheDocument());
  });

  it('deletes an unused legal entity after explicit confirmation', async () => {
    vi.mocked(commercialSettingsApi.deleteLegalEntity).mockResolvedValueOnce(undefined);
    renderHub();
    fireEvent.click(screen.getByRole('button', { name: /Юридичні особи/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Видалити юридичну особу AutoSale' }));
    fireEvent.click(screen.getByRole('button', { name: 'Видалити' }));

    await waitFor(() => expect(commercialSettingsApi.deleteLegalEntity).toHaveBeenCalledWith('entity-1'));
    await waitFor(() => expect(screen.queryByText('ТОВ Авто Сейл')).not.toBeInTheDocument());
  });

  it('does not offer destructive actions to a manager', () => {
    renderHub('MANAGER');
    fireEvent.click(screen.getByRole('button', { name: /Банківські рахунки/ }));
    expect(screen.queryByRole('button', { name: /Видалити рахунок/ })).not.toBeInTheDocument();
  });
});
