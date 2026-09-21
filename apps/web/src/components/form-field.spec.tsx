import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { FieldError, FormField } from './form-field';

afterEach(cleanup);

describe('FormField', () => {
  it('connects an invalid control to its label and field error', () => {
    render(
      <FormField id="email" label="Email" error="Введіть email" required>
        <input />
      </FormField>,
    );

    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('id', 'email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'email-error');
    expect(screen.getByText('Введіть email')).toHaveAttribute('id', 'email-error');
  });

  it('preserves an existing description and references both hint and error', () => {
    const { rerender } = render(
      <FormField id="phone" label="Телефон" hint="Міжнародний формат" error="Некоректний номер">
        <input aria-describedby="external-description" />
      </FormField>,
    );

    expect(screen.getByLabelText('Телефон')).toHaveAttribute(
      'aria-describedby',
      'external-description phone-hint phone-error',
    );
    expect(screen.getByText('Міжнародний формат')).toHaveAttribute('id', 'phone-hint');

    rerender(
      <FormField id="phone" label="Телефон" hint="Міжнародний формат" error={null}>
        <input aria-describedby="external-description" />
      </FormField>,
    );

    expect(screen.getByLabelText('Телефон')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Телефон')).toHaveAttribute(
      'aria-describedby',
      'external-description phone-hint',
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('FieldError', () => {
  it('renders a stable announced message only when one exists', () => {
    const { rerender } = render(<FieldError id="name-error" message="Вкажіть ім’я" />);

    expect(screen.getByRole('alert')).toHaveAttribute('id', 'name-error');
    expect(screen.getByRole('alert')).toHaveTextContent('Вкажіть ім’я');

    rerender(<FieldError id="name-error" message={null} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('field validation styles', () => {
  it('uses the shared danger token and a mobile-safe error layout', () => {
    const stylesheet = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8');

    expect(stylesheet).toMatch(/\.form-field__error\s*\{[^}]*color:\s*var\(--danger\)/);
    expect(stylesheet).toMatch(/\[aria-invalid="true"\][^{]*\{[^}]*border-color:\s*var\(--danger\)/);
    expect(stylesheet).toMatch(/\.form-field__error\s*\{[^}]*overflow-wrap:\s*anywhere/);
  });
});
