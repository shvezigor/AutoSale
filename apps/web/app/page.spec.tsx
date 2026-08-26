import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import HomePage from './page';

describe('HomePage', () => {
  it('links the manager to the conversation inbox', () => {
    render(<HomePage />);

    expect(screen.getByRole('link', { name: 'Відкрити діалоги' })).toHaveAttribute(
      'href',
      '/conversations',
    );
  });
});
