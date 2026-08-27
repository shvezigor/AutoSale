import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ForgotPasswordForm, LoginForm, RegisterForm } from './auth-form';

afterEach(cleanup);

describe('authentication forms', () => {
  it('submits login credentials and shows a safe error', async () => {
    const submit = vi.fn().mockResolvedValue({ ok: false });
    render(<LoginForm submit={submit} />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@example.com' } });
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Увійти' }));

    await waitFor(() => expect(submit).toHaveBeenCalledWith({ email: 'owner@example.com', password: 'wrong-password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Не вдалося увійти');
  });

  it('collects all required owner registration fields', async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true });
    render(<RegisterForm submit={submit} />);

    fireEvent.change(screen.getByLabelText('Ім’я'), { target: { value: 'Олена' } });
    fireEvent.change(screen.getByLabelText('Назва організації'), { target: { value: 'Крамниця' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@example.com' } });
    fireEvent.change(screen.getByLabelText(/Пароль/), { target: { value: 'correct horse battery' } });
    fireEvent.click(screen.getByRole('button', { name: 'Зареєструватися' }));

    await waitFor(() => expect(submit).toHaveBeenCalledWith({ name: 'Олена', tenantName: 'Крамниця', email: 'owner@example.com', password: 'correct horse battery' }));
    expect(await screen.findByText('Перевірте вашу електронну пошту')).toBeInTheDocument();
  });

  it('shows the development verification link returned by the API', async () => {
    render(<RegisterForm submit={vi.fn().mockResolvedValue({ ok: true, previewUrl: 'http://localhost/verify-email?token=test-token' })} />);
    fireEvent.change(screen.getByLabelText('Ім’я'), { target: { value: 'Олена' } });
    fireEvent.change(screen.getByLabelText('Назва організації'), { target: { value: 'Крамниця' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@example.com' } });
    fireEvent.change(screen.getByLabelText(/Пароль/), { target: { value: 'correct horse battery' } });
    fireEvent.click(screen.getByRole('button', { name: 'Зареєструватися' }));
    expect(await screen.findByRole('link', { name: 'Активувати тестовий акаунт' })).toHaveAttribute('href', 'http://localhost/verify-email?token=test-token');
  });

  it('uses a neutral success message for password recovery', async () => {
    render(<ForgotPasswordForm submit={vi.fn().mockResolvedValue({ ok: true })} />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Надіслати посилання' }));
    expect(await screen.findByText('Якщо акаунт існує, лист уже надіслано.')).toBeInTheDocument();
  });
});
