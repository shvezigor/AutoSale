import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CatalogueTable } from './catalogue-table';

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

afterEach(() => { cleanup(); replace.mockReset(); });

describe('CatalogueTable', () => {
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
});
