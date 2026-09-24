import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/auth/session', () => ({
  getServerSession: vi.fn().mockResolvedValue({ locale: 'uk' }),
}));

import OnboardingPage from './page';

describe('OnboardingPage', () => {
  it('is explicit about the staged onboarding experience', async () => {
    render(await OnboardingPage());
    expect(screen.getByRole('heading', { name: 'Налаштуйте Sales AITO' })).toBeInTheDocument();
    expect(screen.getByText('Розділ у розробці')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Перейти до налаштувань' })).toHaveAttribute('href', '/settings');
  });
});
