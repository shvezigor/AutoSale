import { cleanup, fireEvent, render as rtlRender, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mutatingFetch } = vi.hoisted(() => ({ mutatingFetch: vi.fn() }));
vi.mock('../auth/csrf-fetch', () => ({ mutatingFetch }));

import { CatalogueTable } from './catalogue-table';
import { ActivityProvider } from './activity-provider';
import { ToastProvider } from './toast-provider';
import { ConfirmProvider } from './confirm-provider';
import { I18nProvider } from '../i18n/i18n-provider';

function render(ui: React.ReactElement) { return rtlRender(<ToastProvider><ActivityProvider><ConfirmProvider>{ui}</ConfirmProvider></ActivityProvider></ToastProvider>); }
function renderEnglish(ui: React.ReactElement) { return rtlRender(<I18nProvider locale="en" authenticated><ToastProvider><ActivityProvider><ConfirmProvider>{ui}</ConfirmProvider></ActivityProvider></ToastProvider></I18nProvider>); }

const product = {
  id: 'b6c1a440-a39d-41d1-b9c2-ebdac84d4c48',
  sku: 'LUNA-01',
  name: 'Сукня Luna',
  description: null,
  price: 2499,
  currency: 'UAH',
  stockQuantity: 7,
  category: null,
  brand: null,
  aliases: ['luna'],
  color: null,
  size: null,
  imageUrls: [],
  attributes: {},
  active: true,
};

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));

afterEach(() => { cleanup(); replace.mockReset(); mutatingFetch.mockReset(); });

describe('CatalogueTable', () => {
  it('orders catalogue columns as number, SKU, name, price, stock and status and keeps numbering across pages', () => {
    render(<CatalogueTable session={{ membershipRole: 'OWNER' }} products={[product]} page={2} pageSize={25} total={26} />);

    const table = screen.getByRole('table', { name: 'Товари каталогу' });
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['№', 'Артикул', 'Назва', 'Ціна', 'Залишок', 'Статус', 'Дії']);
    expect(within(table).getByRole('cell', { name: '26' })).toBeInTheDocument();
    expect(document.querySelector('.catalogue-card-index')).toHaveTextContent('№ 26');
  });

  it('shows catalogue rows but no editing controls to a manager', () => {
    render(<CatalogueTable session={{ membershipRole: 'MANAGER' }} products={[product]} page={1} pageSize={25} total={1} />);

    expect(screen.getByText('LUNA-01')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Редагувати' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Додати товар' })).not.toBeInTheDocument();
  });

  it('lets an owner open the product editor and search the catalogue', () => {
    render(<CatalogueTable session={{ membershipRole: 'OWNER' }} products={[product]} page={1} pageSize={25} total={26} />);

    fireEvent.click(screen.getByRole('button', { name: 'Додати товар' }));
    expect(screen.getByRole('heading', { name: 'Новий товар' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Пошук товарів'), { target: { value: 'Luna' } });
    fireEvent.submit(screen.getByRole('search'));
    expect(replace).toHaveBeenCalledWith('/catalogue?search=Luna');
  });

  it('shows numbered pagination and lets the user change the rows per page', () => {
    render(<CatalogueTable session={{ membershipRole: 'MANAGER' }} products={[product]} page={2} pageSize={25} total={60} search="Luna" />);

    expect(screen.getByRole('navigation', { name: 'Сторінки каталогу' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Сторінка 2' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('26–50 із 60')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Сторінка 3' }));
    expect(replace).toHaveBeenCalledWith('/catalogue?search=Luna&page=3');

    fireEvent.change(screen.getByLabelText('Рядків на сторінці'), { target: { value: '50' } });
    expect(replace).toHaveBeenCalledWith('/catalogue?search=Luna&pageSize=50');
  });

  it('clears the catalogue only after the owner confirms', async () => {
    mutatingFetch.mockResolvedValue({ ok: true, json: async () => ({ deleted: 14 }) });
    render(<CatalogueTable session={{ membershipRole: 'OWNER' }} products={[product]} page={1} pageSize={25} total={14} />);

    fireEvent.click(screen.getByRole('button', { name: 'Очистити каталог' }));
    expect(screen.getByRole('dialog', { name: 'Очистити всі товари?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Скасувати' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/введіть/i)).not.toBeInTheDocument();
    expect(mutatingFetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Так, очистити' }));
    await screen.findByText('Каталог очищено');
    expect(mutatingFetch).toHaveBeenCalledWith('/api/catalogue', { method: 'DELETE' });
  });

  it('translates catalogue controls while preserving product data', () => {
    renderEnglish(<CatalogueTable session={{ membershipRole: 'OWNER' }} products={[product]} page={2} pageSize={25} total={60} />);

    expect(screen.getByRole('table', { name: 'Catalogue products' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add product' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(2);
    expect(screen.getAllByText('Сукня Luna')).toHaveLength(2);
    expect(screen.getByText('LUNA-01')).toBeInTheDocument();
    expect(screen.getByText('26–50 of 60')).toBeInTheDocument();
    expect(screen.getByLabelText('Rows per page')).toBeInTheDocument();
  });
});
