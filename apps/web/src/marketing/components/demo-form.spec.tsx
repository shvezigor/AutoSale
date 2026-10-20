import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DemoForm } from './demo-form';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('DemoForm', () => {
  it('shows all invalid fields, focuses the first and preserves typed values', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<DemoForm locale="uk" />);
    fireEvent.change(screen.getByLabelText('Ім’я'), { target: { value: 'А' } });
    fireEvent.change(screen.getByLabelText('Компанія або магазин'), { target: { value: 'Б' } });
    fireEvent.click(screen.getByRole('button', { name: 'Замовити демо' }));
    expect(screen.getByLabelText('Ім’я')).toHaveFocus();
    expect(screen.getByText('Введіть щонайменше 2 символи.', { selector: '#demo-name-error' })).toBeInTheDocument();
    expect(screen.getByText('Введіть щонайменше 2 символи.', { selector: '#demo-company-error' })).toBeInTheDocument();
    expect(screen.getByText('Оберіть кількість замовлень.', { selector: '#demo-orderVolume-error' })).toBeInTheDocument();
    expect(screen.getByText('Потрібна згода на обробку даних.', { selector: '#demo-privacyConsent-error' })).toBeInTheDocument();
    expect(screen.getByLabelText('Ім’я')).toHaveValue('А');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps a service outage at form level without discarding values', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    render(<DemoForm locale="en" />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Alice' } });
    fireEvent.change(screen.getByLabelText('Company or store'), { target: { value: 'Fictional Shop' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'alice@example.test' } });
    fireEvent.change(screen.getByLabelText('Monthly orders'), { target: { value: 'UNDER_50' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Book a demo' }));
    expect(await screen.findByText(/temporarily unavailable/)).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Alice');
  });

  it('explains a rate limit in Ukrainian while preserving fields for a later retry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    render(<DemoForm locale="uk" />);
    fireEvent.change(screen.getByLabelText('Ім’я'), { target: { value: 'Олена' } });
    fireEvent.change(screen.getByLabelText('Компанія або магазин'), { target: { value: 'Вигаданий магазин' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'olena@example.test' } });
    fireEvent.change(screen.getByLabelText('Замовлень на місяць'), { target: { value: 'UNDER_50' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Замовити демо' }));
    expect(await screen.findByText(/Забагато запитів/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toContainElement(screen.getByText(/Забагато запитів/));
    expect(screen.getByLabelText('Ім’я')).toHaveValue('Олена');
    expect(screen.getByLabelText('Email')).toHaveValue('olena@example.test');
  });

  it('submits an empty screen-reader-hidden bot field without showing it to a user', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(<DemoForm locale="en" />);
    expect(screen.queryByRole('textbox', { name: /website/i })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Alice' } });
    fireEvent.change(screen.getByLabelText('Company or store'), { target: { value: 'Fictional Shop' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'alice@example.test' } });
    fireEvent.change(screen.getByLabelText('Monthly orders'), { target: { value: 'UNDER_50' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Book a demo' }));
    await screen.findByText('Request received');
    const payload = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(payload.companyWebsite).toBe('');
  });
});
